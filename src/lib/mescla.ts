import { ETAPA_PERDIDO, LINHA_DO_FUNIL, type EtapaComercial } from "@/config/pipeline";
import { TRAVA_ATRIBUICAO } from "./atribuicao";
import { registrarAuditoria } from "./auditoria";
import { pool, transacao, type Consulta } from "./db";
import { NAO_MESCLADO } from "./escopo";
import { CAMPAIGN, mascararOrigem, MEDIUM, SOURCE } from "./funil";
import {
  condicaoDeBusca,
  ETAPA_ATUAL,
  leadsVisiveis,
  NOME_RESPONSAVEL,
  ORIGEM,
  RESPONSAVEL_VALIDO,
  UUID,
  type QuemConsulta,
} from "./leads";
import type { Papel } from "./papeis";
import { Parametros } from "./sql";

/**
 * Mescla de cadastros duplicados (só admin; quem chama já checou o papel,
 * e as funções conferem de novo).
 *
 * - Nada é apagado: o duplicado vira uma linha em painel_lead_mescla e, por
 *   NAO_MESCLADO (escopo.ts), some de todas as listas e contagens.
 * - O principal mantém a própria etapa e a própria origem. Se ele não tem
 *   responsável (válido) e o duplicado tem, herda o do duplicado.
 * - Nunca mesclar um lead com ele mesmo, nem usar como duplicado ou como
 *   principal um cadastro que já é duplicado de outro.
 * - Encadeamento: se o duplicado era principal de outros, esses passam a
 *   apontar para o novo principal (um principal nunca é duplicado).
 * - Desfazer: apaga a linha e devolve ao cadastro os duplicados que tinham
 *   sido reapontados na mescla dele (se ainda estiverem no mesmo
 *   principal). O responsável herdado não é desfeito (fica na auditoria).
 * - Uma mescla por vez (trava de transação), com auditoria na mesma
 *   transação.
 */

export function podeMesclar(papel: Papel): boolean {
  return papel === "admin";
}

export class ErroMescla extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "nao_encontrado" | "invalido" | "sem_permissao",
  ) {
    super(mensagem);
  }
}

const TRAVA_MESCLA = 7_310_003;

// ── Normalização para a sugestão de duplicados ──

/** WhatsApp normalizado: DDD + 8 últimos dígitos (ignora o 55 e o nono dígito). */
export const WHATSAPP_NORMALIZADO = "(substr(i.whatsapp, 3, 2) || right(i.whatsapp, 8))";
/** Nome normalizado: minúsculas, sem acentos, só letras e números, espaços colapsados. */
export const NOME_NORMALIZADO = `btrim(regexp_replace(translate(lower(i.nome),
  'áàâãäåéèêëíìîïóòôõöúùûüçñý', 'aaaaaaeeeeiiiiooooouuuucny'), '[^a-z0-9]+', ' ', 'g'))`;

// ── Resumo de um cadastro (lado a lado, candidatos, mesclados) ──

export interface ResumoDoCadastro {
  id: string;
  nome: string;
  email: string;
  whatsapp: string;
  status: string;
  etapa_comercial: EtapaComercial;
  responsavel_nome: string | null;
  source: string;
  medium: string;
  campaign: string;
  created_at: Date;
}

const COLUNAS_DO_RESUMO = `i.id, i.nome, i.email, i.whatsapp, i.status, ${ETAPA_ATUAL} AS etapa_comercial,
  ${NOME_RESPONSAVEL} AS responsavel_nome, ${SOURCE} AS source, ${MEDIUM} AS medium, ${CAMPAIGN} AS campaign, i.created_at`;

function protegerResumo<T extends ResumoDoCadastro>(r: T): T {
  return { ...r, source: mascararOrigem(r.source), medium: mascararOrigem(r.medium), campaign: mascararOrigem(r.campaign) };
}

function exigirAdmin(usuario: QuemConsulta) {
  if (!podeMesclar(usuario.papel)) throw new ErroMescla("Só admin pode mesclar cadastros.", "sem_permissao");
}

// ── Qual é o principal ──

const ORDEM_STATUS: Record<string, number> = { inscrito: 0, ativacao_preenchida: 1, agendado: 2, nao_compareceu: 2.5, realizado: 3 };

/** Quanto o cadastro já avançou: etapa comercial, depois situação do teste. Perdido conta logo acima de "não contatado". */
function avanco(r: Pick<ResumoDoCadastro, "etapa_comercial" | "status">): [number, number] {
  const etapa = r.etapa_comercial === ETAPA_PERDIDO ? 0.5 : (LINHA_DO_FUNIL as readonly string[]).indexOf(r.etapa_comercial);
  return [etapa, ORDEM_STATUS[r.status] ?? 0];
}

/** Sugestão de principal: o mais avançado; empate, o cadastro mais antigo. */
export function sugerirPrincipal(a: ResumoDoCadastro, b: ResumoDoCadastro): string {
  const [ea, sa] = avanco(a);
  const [eb, sb] = avanco(b);
  if (ea !== eb) return ea > eb ? a.id : b.id;
  if (sa !== sb) return sa > sb ? a.id : b.id;
  return new Date(a.created_at).getTime() <= new Date(b.created_at).getTime() ? a.id : b.id;
}

// ── Busca e comparação ──

/** Leads (não mesclados, fora o próprio) que batem com a busca, para escolher com quem mesclar. */
export async function candidatosParaMescla(usuario: QuemConsulta, leadId: string, q: string): Promise<ResumoDoCadastro[]> {
  exigirAdmin(usuario);
  const busca = q.trim();
  if (!UUID.test(leadId) || busca.length < 2) return [];
  const p = new Parametros();
  const { rows } = await pool().query<ResumoDoCadastro>(
    `SELECT ${COLUNAS_DO_RESUMO} FROM ${ORIGEM}
      WHERE ${leadsVisiveis(usuario, p)} AND i.id <> ${p.add(leadId)} AND ${condicaoDeBusca(busca.slice(0, 100), p)}
      ORDER BY i.created_at DESC LIMIT 10`,
    p.valores,
  );
  return rows.map(protegerResumo);
}

async function resumos(db: Consulta, usuario: QuemConsulta, ids: string[]): Promise<ResumoDoCadastro[]> {
  const p = new Parametros();
  const { rows } = await db.query<ResumoDoCadastro>(
    `SELECT ${COLUNAS_DO_RESUMO} FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, p)} AND i.id = ANY(${p.add(ids)}::uuid[])`,
    p.valores,
  );
  return rows.map(protegerResumo);
}

export interface Comparacao {
  a: ResumoDoCadastro;
  b: ResumoDoCadastro;
  sugerido: string;
}

/** Os dois cadastros lado a lado, com a sugestão de principal; null se algum não existe ou já foi mesclado. */
export async function compararParaMescla(usuario: QuemConsulta, leadId: string, outroId: string): Promise<Comparacao | null> {
  exigirAdmin(usuario);
  if (!UUID.test(leadId) || !UUID.test(outroId) || leadId.toLowerCase() === outroId.toLowerCase()) return null;
  const lidos = await resumos(pool(), usuario, [leadId, outroId]);
  const a = lidos.find((r) => r.id === leadId.toLowerCase());
  const b = lidos.find((r) => r.id === outroId.toLowerCase());
  if (!a || !b) return null;
  return { a, b, sugerido: sugerirPrincipal(a, b) };
}

// ── Mesclar e desfazer ──

export interface ResultadoMescla {
  principal: string;
  duplicado: string;
  /** Duplicados do duplicado que passaram a apontar para o principal. */
  reapontados: string[];
  herdouResponsavel: { id: string; nome: string } | null;
}

export async function mesclar(usuario: QuemConsulta, principalId: string, duplicadoId: string): Promise<ResultadoMescla> {
  exigirAdmin(usuario);
  if (!UUID.test(principalId) || !UUID.test(duplicadoId)) throw new ErroMescla("Lead não encontrado.", "nao_encontrado");
  const principal = principalId.toLowerCase();
  const duplicado = duplicadoId.toLowerCase();
  if (principal === duplicado) throw new ErroMescla("Não dá para mesclar um lead com ele mesmo.", "invalido");

  return transacao(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [TRAVA_MESCLA]);
    const { rows } = await db.query<{ id: string; mesclado: boolean }>(
      `SELECT i.id, NOT ${NAO_MESCLADO} AS mesclado FROM teste7d_inscricoes i WHERE i.id = ANY($1::uuid[])`,
      [[principal, duplicado]],
    );
    const p = rows.find((r) => r.id === principal);
    const d = rows.find((r) => r.id === duplicado);
    if (!p || !d) throw new ErroMescla("Lead não encontrado. Atualize a página.", "nao_encontrado");
    if (d.mesclado) throw new ErroMescla("Este cadastro já foi mesclado em outro. Atualize a página.", "invalido");
    if (p.mesclado) {
      throw new ErroMescla("O cadastro escolhido como principal já foi mesclado em outro; mescle com o principal dele.", "invalido");
    }

    const { rows: reapontados } = await db.query<{ duplicado_id: string }>(
      "UPDATE painel_lead_mescla SET principal_id = $1 WHERE principal_id = $2 RETURNING duplicado_id",
      [principal, duplicado],
    );
    await db.query(
      "INSERT INTO painel_lead_mescla (duplicado_id, principal_id, mesclado_por, mesclado_em) VALUES ($1, $2, $3, now())",
      [duplicado, principal, usuario.id],
    );

    const herdouResponsavel = await herdarResponsavel(db, usuario, principal, duplicado);
    const ids = reapontados.map((r) => r.duplicado_id);
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        acao: "mesclar_leads",
        leadId: duplicado,
        detalhe: { principal, duplicado, reapontados: ids, herdou_responsavel: herdouResponsavel },
      },
      db,
    );
    return { principal, duplicado, reapontados: ids, herdouResponsavel };
  });
}

/** Principal sem responsável válido herda o responsável válido do duplicado (mesma trava da atribuição). */
async function herdarResponsavel(db: Consulta, usuario: QuemConsulta, principal: string, duplicado: string) {
  await db.query("SELECT pg_advisory_xact_lock($1)", [TRAVA_ATRIBUICAO]);
  const { rows } = await db.query<{ id: string; valido: boolean; usuario_id: string | null; nome: string | null }>(
    `SELECT i.id, coalesce(${RESPONSAVEL_VALIDO}, false) AS valido, r.usuario_id, coalesce(ru.nome, ru.email) AS nome
       FROM teste7d_inscricoes i
       LEFT JOIN painel_lead_responsavel r ON r.lead_id = i.id
       LEFT JOIN painel_usuarios ru ON ru.id = r.usuario_id
      WHERE i.id = ANY($1::uuid[])`,
    [[principal, duplicado]],
  );
  const p = rows.find((r) => r.id === principal)!;
  const d = rows.find((r) => r.id === duplicado)!;
  if (p.valido || !d.valido || !d.usuario_id) return null;

  await db.query(
    `INSERT INTO painel_lead_responsavel (lead_id, usuario_id, atribuido_por, atribuido_em) VALUES ($1, $2, $3, now())
     ON CONFLICT (lead_id) DO UPDATE
       SET usuario_id = EXCLUDED.usuario_id, atribuido_por = EXCLUDED.atribuido_por, atribuido_em = EXCLUDED.atribuido_em`,
    [principal, d.usuario_id, usuario.id],
  );
  const novo = { id: d.usuario_id, nome: d.nome ?? "" };
  await registrarAuditoria(
    {
      usuarioId: usuario.id,
      acao: "atribuir_lead",
      leadId: principal,
      detalhe: {
        anterior: p.usuario_id ? { id: p.usuario_id, nome: p.nome } : null,
        novo,
        lote: false,
        motivo: "mescla",
        duplicado,
      },
    },
    db,
  );
  return novo;
}

export async function desfazerMescla(usuario: QuemConsulta, duplicadoId: string): Promise<{ principal: string; devolvidos: string[] }> {
  exigirAdmin(usuario);
  if (!UUID.test(duplicadoId)) throw new ErroMescla("Lead não encontrado.", "nao_encontrado");
  const duplicado = duplicadoId.toLowerCase();

  return transacao(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [TRAVA_MESCLA]);
    const { rows } = await db.query<{ principal_id: string }>(
      "DELETE FROM painel_lead_mescla WHERE duplicado_id = $1 RETURNING principal_id",
      [duplicado],
    );
    if (!rows[0]) {
      const existe = await db.query("SELECT 1 FROM teste7d_inscricoes WHERE id = $1", [duplicado]);
      if (existe.rows.length === 0) throw new ErroMescla("Lead não encontrado.", "nao_encontrado");
      throw new ErroMescla("Este cadastro não está mesclado (a mescla pode já ter sido desfeita). Atualize a página.", "invalido");
    }
    const principal = rows[0].principal_id;

    // Quem tinha sido reapontado na mescla deste cadastro volta para ele.
    const { rows: log } = await db.query<{ reapontados: string[] | null }>(
      `SELECT ARRAY(SELECT jsonb_array_elements_text(detalhe->'reapontados')) AS reapontados
         FROM painel_auditoria WHERE acao = 'mesclar_leads' AND lead_id = $1
        ORDER BY id DESC LIMIT 1`,
      [duplicado],
    );
    const antes = log[0]?.reapontados ?? [];
    const { rows: devolvidos } = antes.length
      ? await db.query<{ duplicado_id: string }>(
          `UPDATE painel_lead_mescla SET principal_id = $1
            WHERE duplicado_id = ANY($2::uuid[]) AND principal_id = $3
            RETURNING duplicado_id`,
          [duplicado, antes, principal],
        )
      : { rows: [] };
    const ids = devolvidos.map((r) => r.duplicado_id);
    await registrarAuditoria(
      { usuarioId: usuario.id, acao: "desfazer_mescla", leadId: duplicado, detalhe: { principal, duplicado, devolvidos: ids } },
      db,
    );
    return { principal, devolvidos: ids };
  });
}

// ── Cadastros mesclados num principal ──

export interface CadastroMesclado extends ResumoDoCadastro {
  mesclado_em: Date;
  mesclado_por: string | null;
}

/**
 * Cadastros mesclados no principal `principalId`, se `usuario` pode ver o
 * principal (quem vê o principal vê os dados dos cadastros mesclados nele).
 */
export async function cadastrosMescladosEm(usuario: QuemConsulta, principalId: string): Promise<CadastroMesclado[]> {
  if (!UUID.test(principalId)) return [];
  const p = new Parametros();
  const visivel = await pool().query(
    `SELECT 1 FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, p)} AND i.id = ${p.add(principalId)}`,
    p.valores,
  );
  if (visivel.rows.length === 0) return [];
  const { rows } = await pool().query<CadastroMesclado>(
    `SELECT ${COLUNAS_DO_RESUMO}, m.mesclado_em, coalesce(mu.nome, mu.email) AS mesclado_por
       FROM painel_lead_mescla m
       JOIN ${ORIGEM} ON i.id = m.duplicado_id
       LEFT JOIN painel_usuarios mu ON mu.id = m.mesclado_por
      WHERE m.principal_id = $1
      ORDER BY m.mesclado_em DESC`,
    [principalId],
  );
  return rows.map(protegerResumo);
}

// ── Sugestão de duplicados ──

export type Criterio = "whatsapp" | "nome" | "whatsapp_e_nome";

export interface GrupoDeDuplicados {
  criterio: Criterio;
  leads: ResumoDoCadastro[];
}

export const MAX_GRUPOS = 100;

/**
 * Grupos de leads (não mesclados) com o mesmo WhatsApp normalizado ou o
 * mesmo nome normalizado. Só sugere: nunca mescla nada sozinho.
 */
export async function possiveisDuplicados(usuario: QuemConsulta): Promise<GrupoDeDuplicados[]> {
  exigirAdmin(usuario);
  const { rows } = await pool().query<{ criterio: "whatsapp" | "nome"; ids: string[] }>(
    `WITH base AS (
       SELECT i.id, i.created_at, ${WHATSAPP_NORMALIZADO} AS w, ${NOME_NORMALIZADO} AS n
         FROM teste7d_inscricoes i WHERE ${NAO_MESCLADO}
     )
     SELECT 'whatsapp' AS criterio, array_agg(id ORDER BY created_at, id)::text[] AS ids, max(created_at) AS recente
       FROM base GROUP BY w HAVING count(*) > 1
     UNION ALL
     SELECT 'nome', array_agg(id ORDER BY created_at, id)::text[], max(created_at)
       FROM base WHERE n <> '' GROUP BY n HAVING count(*) > 1
     ORDER BY recente DESC
     LIMIT ${MAX_GRUPOS * 2}`,
  );
  // O mesmo conjunto pelos dois critérios vira um grupo só.
  const grupos = new Map<string, { criterio: Criterio; ids: string[] }>();
  for (const r of rows) {
    const chave = [...r.ids].sort().join(",");
    const ja = grupos.get(chave);
    if (ja) ja.criterio = "whatsapp_e_nome";
    else grupos.set(chave, { criterio: r.criterio, ids: r.ids });
  }
  const lista = [...grupos.values()].slice(0, MAX_GRUPOS);
  const todos = await resumos(pool(), usuario, [...new Set(lista.flatMap((g) => g.ids))]);
  const porId = new Map(todos.map((r) => [r.id, r]));
  return lista.map((g) => ({ criterio: g.criterio, leads: g.ids.map((id) => porId.get(id)).filter((r) => r !== undefined) }));
}

export interface DuplicadoSugerido extends ResumoDoCadastro {
  criterio: Criterio;
}

/** Leads (não mesclados) com o mesmo WhatsApp ou nome normalizado de `leadId`. Só admin. */
export async function duplicadosSugeridosPara(usuario: QuemConsulta, leadId: string): Promise<DuplicadoSugerido[]> {
  exigirAdmin(usuario);
  if (!UUID.test(leadId)) return [];
  const p = new Parametros();
  const { rows } = await pool().query<DuplicadoSugerido>(
    `WITH alvo AS (SELECT ${WHATSAPP_NORMALIZADO} AS w, ${NOME_NORMALIZADO} AS n FROM teste7d_inscricoes i WHERE i.id = ${p.add(leadId)})
     SELECT ${COLUNAS_DO_RESUMO},
            CASE WHEN ${WHATSAPP_NORMALIZADO} = alvo.w AND ${NOME_NORMALIZADO} = alvo.n THEN 'whatsapp_e_nome'
                 WHEN ${WHATSAPP_NORMALIZADO} = alvo.w THEN 'whatsapp' ELSE 'nome' END AS criterio
       FROM ${ORIGEM}, alvo
      WHERE ${leadsVisiveis(usuario, p)} AND i.id <> ${p.add(leadId)}
        AND (${WHATSAPP_NORMALIZADO} = alvo.w OR (alvo.n <> '' AND ${NOME_NORMALIZADO} = alvo.n))
      ORDER BY i.created_at
      LIMIT 20`,
    p.valores,
  );
  return rows.map(protegerResumo);
}
