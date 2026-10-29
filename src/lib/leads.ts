import { registrarAuditoria } from "./auditoria";
import { URL_ATIVAR_CONTA } from "@/config/contato";
import { pool } from "./db";
import { ETAPAS_PARADAS } from "./etapas";
import { POR_PAGINA, type FiltrosLeads, type Ordem } from "./filtrosLeads";
import type { Papel } from "./papeis";
import { Parametros } from "./sql";

/**
 * ÚNICO ponto de acesso aos leads (teste7d_inscricoes). Toda consulta passa
 * por `leadsVisiveis`, que aplica a regra da seção 7 no SQL:
 *   - admin e suporte: todos os leads;
 *   - vendas: só os leads em que é o responsável (painel_lead_responsavel);
 *   - leitura: nenhum lead individual (lança SemAcessoALeads).
 * Lead fora do escopo simplesmente não existe pra quem consulta (a tela e
 * a API respondem 404).
 *
 * Colunas sempre listadas uma a uma (nunca i.*): o painel_app só enxerga as
 * colunas liberadas em db/grants/painel_app.sql. O token de retomada só é
 * lido em `linkDeAtivacao`.
 */

export interface QuemConsulta {
  id: string;
  papel: Papel;
}

export class SemAcessoALeads extends Error {}

const ORIGEM = `teste7d_inscricoes i
  LEFT JOIN painel_lead_responsavel r ON r.lead_id = i.id
  LEFT JOIN painel_usuarios ru ON ru.id = r.usuario_id`;

/** Condição SQL com os leads que `usuario` pode ver. */
export function leadsVisiveis(usuario: QuemConsulta, p: Parametros): string {
  switch (usuario.papel) {
    case "admin":
    case "suporte":
      return "TRUE";
    case "vendas":
      return `r.usuario_id = ${p.add(usuario.id)}`;
    default:
      throw new SemAcessoALeads();
  }
}

export function podeVerLeads(papel: Papel): boolean {
  return papel === "admin" || papel === "suporte" || papel === "vendas";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEM_RESPONSAVEL = "(r.usuario_id IS NULL OR ru.ativo = false)";
const PARADO_DESDE = "greatest(i.created_at, i.etapa2_concluida_em, i.ultima_retomada_em)";
/** Semana corrente (segunda a domingo) no fuso de São Paulo. */
const INICIO_SEMANA = "(date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')";

// ── Lista ──

export interface ItemLista {
  id: string;
  nome: string;
  status: string;
  utm_content: string | null;
  lp_variant: string | null;
  created_at: Date;
  reuniao_em: Date | null;
  parado_desde: Date;
  responsavel_nome: string | null;
}

export interface PaginaDeLeads {
  itens: ItemLista[];
  total: number;
  pagina: number;
  paginas: number;
  /** Algum lead visível tem data de reunião? (Hoje nenhum fluxo preenche.) */
  temDadosDeReuniao: boolean;
}

const ORDENACAO: Record<Ordem, string> = {
  cadastro: "i.created_at",
  // ICU: ordem alfabética de verdade, sem depender da collation padrão do
  // banco (no Postgres local ela põe "Úrsula" depois de "Zeca").
  nome: 'i.nome COLLATE "und-x-icu"',
  etapa: `array_position(ARRAY['inscrito','ativacao_preenchida','agendado','realizado','nao_compareceu'], i.status)`,
  criativo: "i.utm_content",
  versao: "i.lp_variant",
  responsavel: 'coalesce(ru.nome, ru.email) COLLATE "und-x-icu"',
  reuniao: "i.reuniao_em",
  parado: PARADO_DESDE,
};

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function condicoes(usuario: QuemConsulta, f: FiltrosLeads, p: Parametros): string[] {
  const where = [leadsVisiveis(usuario, p)];

  if (f.status) where.push(`i.status = ${p.add(f.status)}`);
  if (f.criativo) where.push(`i.utm_content = ${p.add(f.criativo)}`);
  if (f.campanha) where.push(`i.utm_campaign = ${p.add(f.campanha)}`);
  if (f.versao) where.push(`i.lp_variant = ${p.add(f.versao)}`);
  if (f.de) where.push(`i.created_at >= (${p.add(f.de)}::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`);
  if (f.ate) where.push(`i.created_at < ((${p.add(f.ate)}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`);
  if (f.responsavel === "sem") where.push(SEM_RESPONSAVEL);
  else if (f.responsavel) where.push(`r.usuario_id = ${p.add(f.responsavel)}`);

  if (f.q) {
    const termo = p.add(`%${escaparLike(f.q)}%`);
    const busca = [`i.nome ILIKE ${termo}`, `i.email ILIKE ${termo}`];
    const digitos = f.q.replace(/\D/g, "");
    if (digitos.length >= 3) busca.push(`i.whatsapp LIKE ${p.add(`%${digitos}%`)}`);
    where.push(`(${busca.join(" OR ")})`);
  }

  switch (f.visao) {
    case "parados":
      where.push(`i.status IN (${ETAPAS_PARADAS.map((e) => p.add(e)).join(", ")})`);
      break;
    case "agendados_semana":
      where.push(`i.reuniao_em >= ${INICIO_SEMANA} AND i.reuniao_em < ${INICIO_SEMANA} + interval '7 days'`);
      break;
    case "sem_reuniao":
      where.push("i.reuniao_em IS NULL AND i.agendado_em IS NULL AND i.status NOT IN ('realizado', 'nao_compareceu')");
      break;
    case "sem_responsavel":
      // lerFiltros só deixa esta visão chegar aqui para admin; conferido de novo.
      if (usuario.papel !== "admin") throw new SemAcessoALeads();
      where.push(SEM_RESPONSAVEL);
      break;
  }
  return where;
}

export async function listarLeads(usuario: QuemConsulta, f: FiltrosLeads): Promise<PaginaDeLeads> {
  const p = new Parametros();
  const where = condicoes(usuario, f, p).join(" AND ");

  const pr = new Parametros();
  const [contagem, reuniao] = await Promise.all([
    pool().query<{ total: string }>(`SELECT count(*) AS total FROM ${ORIGEM} WHERE ${where}`, p.valores),
    pool().query<{ existe: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, pr)} AND i.reuniao_em IS NOT NULL) AS existe`,
      pr.valores,
    ),
  ]);
  const total = Number(contagem.rows[0].total);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(f.pagina, paginas);

  const direcao = f.dir === "asc" ? "ASC" : "DESC";
  const { rows } = await pool().query<ItemLista>(
    `SELECT i.id, i.nome, i.status, i.utm_content, i.lp_variant, i.created_at, i.reuniao_em,
            ${PARADO_DESDE} AS parado_desde,
            CASE WHEN ru.ativo THEN coalesce(ru.nome, ru.email) END AS responsavel_nome
       FROM ${ORIGEM}
      WHERE ${where}
      ORDER BY ${ORDENACAO[f.ordem]} ${direcao} NULLS LAST, i.created_at DESC, i.id
      LIMIT ${p.add(POR_PAGINA)} OFFSET ${p.add((pagina - 1) * POR_PAGINA)}`,
    p.valores,
  );

  return { itens: rows, total, pagina, paginas, temDadosDeReuniao: reuniao.rows[0].existe };
}

export interface OpcoesDeFiltro {
  criativos: string[];
  campanhas: string[];
  responsaveis: { id: string; nome: string }[];
}

/** Valores para os seletores de filtro, tirados só dos leads visíveis. */
export async function opcoesDeFiltro(usuario: QuemConsulta): Promise<OpcoesDeFiltro> {
  const p = new Parametros();
  const escopo = leadsVisiveis(usuario, p);
  const distintos = async (coluna: string) =>
    (
      await pool().query<{ v: string }>(
        `SELECT DISTINCT ${coluna} AS v FROM ${ORIGEM} WHERE ${escopo} AND ${coluna} IS NOT NULL ORDER BY 1 LIMIT 500`,
        p.valores,
      )
    ).rows.map((r) => r.v);

  const [criativos, campanhas] = await Promise.all([distintos("i.utm_content"), distintos("i.utm_campaign")]);
  const responsaveis =
    usuario.papel === "vendas"
      ? []
      : (
          await pool().query<{ id: string; nome: string }>(
            `SELECT id, coalesce(nome, email) AS nome FROM painel_usuarios
              WHERE ativo AND (papel IN ('admin', 'vendas') OR id IN (SELECT usuario_id FROM painel_lead_responsavel))
              ORDER BY lower(coalesce(nome, email))`,
          )
        ).rows;
  return { criativos, campanhas, responsaveis };
}

// ── Ficha ──

export interface Ficha {
  id: string;
  created_at: Date;
  nome: string;
  email: string;
  whatsapp: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  lp_variant: string | null;
  negocio_nome_oferta: string | null;
  cidade_bairro: string | null;
  atende_todo_brasil: boolean | null;
  acao_desejada: string | null;
  acao_desejada_outro: string | null;
  experiencia_anuncios: string | null;
  acesso_redes: string | null;
  conta_anuncios: string | null;
  cartao_pagamento: string | null;
  arquivo_logo: string | null;
  reuniao_computador: string | null;
  observacoes: string | null;
  etapa2_concluida_em: Date | null;
  agendado_em: Date | null;
  reuniao_em: Date | null;
  realizada_em: Date | null;
  status: string;
  ultima_retomada_em: Date | null;
  responsavel_nome: string | null;
}

/** Colunas da ficha. Fora de propósito: ip_hash, user_agent, fbclid e o token. */
const COLUNAS_FICHA = `i.id, i.created_at, i.nome, i.email, i.whatsapp,
  i.utm_source, i.utm_medium, i.utm_campaign, i.utm_content, i.utm_term, i.lp_variant,
  i.negocio_nome_oferta, i.cidade_bairro, i.atende_todo_brasil, i.acao_desejada, i.acao_desejada_outro,
  i.experiencia_anuncios, i.acesso_redes, i.conta_anuncios, i.cartao_pagamento, i.arquivo_logo,
  i.reuniao_computador, i.observacoes, i.etapa2_concluida_em,
  i.agendado_em, i.reuniao_em, i.realizada_em, i.status, i.ultima_retomada_em,
  CASE WHEN ru.ativo THEN coalesce(ru.nome, ru.email) END AS responsavel_nome`;

/**
 * Ficha de um lead, ou null se ele não existe OU não é visível para
 * `usuario` (as duas situações são indistinguíveis de propósito).
 * Grava `ver_lead` na auditoria quando encontra.
 */
export async function abrirFicha(usuario: QuemConsulta, id: string, via: "tela" | "api"): Promise<Ficha | null> {
  if (!UUID.test(id)) return null;
  const p = new Parametros();
  const { rows } = await pool().query<Ficha>(
    `SELECT ${COLUNAS_FICHA} FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, p)} AND i.id = ${p.add(id)}`,
    p.valores,
  );
  const ficha = rows[0] ?? null;
  if (ficha) await registrarAuditoria({ usuarioId: usuario.id, acao: "ver_lead", leadId: id, detalhe: { via } });
  return ficha;
}

/**
 * Link de ativação (com o token de retomada) de um lead visível, ou null.
 * Único lugar que lê token_retomada. Grava `copiar_link` na auditoria
 * (sem o token).
 */
export async function linkDeAtivacao(usuario: QuemConsulta, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  const p = new Parametros();
  const { rows } = await pool().query<{ token_retomada: string | null }>(
    `SELECT i.token_retomada FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, p)} AND i.id = ${p.add(id)}`,
    p.valores,
  );
  const token = rows[0]?.token_retomada;
  if (!token) return null;
  await registrarAuditoria({ usuarioId: usuario.id, acao: "copiar_link", leadId: id });
  return `${URL_ATIVAR_CONTA}?t=${encodeURIComponent(token)}`;
}
