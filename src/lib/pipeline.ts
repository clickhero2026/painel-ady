import {
  CARTOES_POR_COLUNA,
  DIAS_PADRAO_FINAIS,
  ETAPA_PERDIDO,
  ETAPAS_COMERCIAIS,
  ETAPAS_FINAIS,
  MAX_TEXTO_MOTIVO,
  motivoDePerda,
  rotuloEtapaComercial,
  type EtapaComercial,
} from "@/config/pipeline";
import { registrarAuditoria } from "./auditoria";
import { pool, transacao, type Consulta } from "./db";
import { POR_PAGINA_PIPELINE, type FiltrosPipeline, type OrdemPipeline } from "./filtrosPipeline";
import { CAMPAIGN, mascararOrigem, origemNormalizada, SOURCE } from "./funil";
import { formatarDataHora } from "./formatos";
import {
  condicaoDeBusca,
  condicoesDePeriodo,
  ETAPA_ATUAL,
  leadsVisiveis,
  NA_ETAPA_DESDE,
  NOME_RESPONSAVEL,
  ORDEM_ETAPA_COMERCIAL,
  ORIGEM,
  SEM_RESPONSAVEL,
  UUID,
  type QuemConsulta,
} from "./leads";
import type { Papel } from "./papeis";
import { Parametros } from "./sql";

/**
 * Pipeline comercial: etapa atual de cada lead (painel_lead_etapa), o
 * histórico das mudanças (painel_lead_etapa_historico, só INSERT), o quadro
 * e a lista. Tudo passa por `leadsVisiveis` (vendas só os seus, ninguém vê
 * os mesclados em outro).
 *
 * A etapa comercial é independente da situação do teste: nada aqui escreve
 * em teste7d_inscricoes.
 */

// ── Quem pode ──

/** Mudar etapa: admin em qualquer lead; vendas só nos seus; suporte só vê. */
export function podeMudarEtapa(papel: Papel): boolean {
  return papel === "admin" || papel === "vendas";
}

// ── Mudança de etapa ──

export class ErroEtapa extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "nao_encontrado" | "conflito" | "invalido" | "sem_permissao",
  ) {
    super(mensagem);
  }
}

export interface PedidoDeEtapa {
  /** A etapa que a pessoa via na tela quando escolheu a nova. */
  esperada: EtapaComercial;
  etapa: EtapaComercial;
  motivo?: string | null;
  motivoTexto?: string | null;
}

interface MudancaValida {
  etapa: EtapaComercial;
  motivo: string | null;
  motivoTexto: string | null;
}

/** Confere o pedido (sem banco). Lança ErroEtapa "invalido" com a mensagem para a tela. */
export function validarPedido(pedido: PedidoDeEtapa): MudancaValida {
  if (pedido.etapa === pedido.esperada) throw new ErroEtapa("O lead já está nesta etapa.", "invalido");
  if (pedido.etapa !== ETAPA_PERDIDO) return { etapa: pedido.etapa, motivo: null, motivoTexto: null };

  const motivo = pedido.motivo ? motivoDePerda(pedido.motivo) : undefined;
  if (!motivo) throw new ErroEtapa("Escolha o motivo da perda.", "invalido");
  const texto = pedido.motivoTexto?.trim() || null;
  if (motivo.exigeTexto && !texto) throw new ErroEtapa(`Com o motivo “${motivo.rotulo}”, escreva qual foi o motivo.`, "invalido");
  if (texto && texto.length > MAX_TEXTO_MOTIVO) {
    throw new ErroEtapa(`O texto do motivo pode ter até ${MAX_TEXTO_MOTIVO} caracteres.`, "invalido");
  }
  return { etapa: pedido.etapa, motivo: motivo.chave, motivoTexto: texto };
}

/** Chave das travas de transação por lead (pg_advisory_xact_lock(chave, hashtext(lead))). */
const TRAVA_ETAPA = 7_310_002;

interface EtapaLida {
  etapa: EtapaComercial;
  atualizado_em: Date | null;
  por: string | null;
}

async function etapaVisivel(db: Consulta, usuario: QuemConsulta, leadId: string): Promise<EtapaLida | null> {
  const p = new Parametros();
  const { rows } = await db.query<EtapaLida>(
    `SELECT ${ETAPA_ATUAL} AS etapa, e.atualizado_em, coalesce(eu.nome, eu.email) AS por
       FROM ${ORIGEM}
       LEFT JOIN painel_usuarios eu ON eu.id = e.atualizado_por
      WHERE ${leadsVisiveis(usuario, p)} AND i.id = ${p.add(leadId)}`,
    p.valores,
  );
  return rows[0] ?? null;
}

/**
 * Muda a etapa comercial de um lead visível para `usuario`. Condicional:
 * só grava se a etapa atual ainda for `esperada` (senão, ErroEtapa
 * "conflito" com a etapa de agora e quem mudou). Grava a etapa, uma linha
 * no histórico e `mudar_etapa` na auditoria, na mesma transação.
 */
export async function mudarEtapa(usuario: QuemConsulta, leadId: string, pedido: PedidoDeEtapa): Promise<void> {
  if (!podeMudarEtapa(usuario.papel)) throw new ErroEtapa("Você não tem permissão para mudar a etapa.", "sem_permissao");
  if (!UUID.test(leadId)) throw new ErroEtapa("Lead não encontrado.", "nao_encontrado");
  const m = validarPedido(pedido);

  await transacao(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [TRAVA_ETAPA, leadId]);
    const atual = await etapaVisivel(db, usuario, leadId);
    if (!atual) throw new ErroEtapa("Lead não encontrado.", "nao_encontrado");
    if (atual.etapa !== pedido.esperada) {
      const quem = atual.por ? ` por ${atual.por}` : "";
      const quando = atual.atualizado_em ? ` em ${formatarDataHora(atual.atualizado_em)}` : "";
      throw new ErroEtapa(
        `Não foi gravado: a etapa deste lead já tinha mudado para “${rotuloEtapaComercial(atual.etapa)}”${quem}${quando}. ` +
          "A tela foi atualizada; confira e tente de novo, se ainda precisar.",
        "conflito",
      );
    }
    if (atual.etapa === m.etapa) throw new ErroEtapa("O lead já está nesta etapa.", "invalido");

    await db.query(
      `INSERT INTO painel_lead_etapa (lead_id, etapa, motivo_perda, motivo_perda_texto, atualizado_em, atualizado_por)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (lead_id) DO UPDATE
         SET etapa = EXCLUDED.etapa, motivo_perda = EXCLUDED.motivo_perda,
             motivo_perda_texto = EXCLUDED.motivo_perda_texto,
             atualizado_em = EXCLUDED.atualizado_em, atualizado_por = EXCLUDED.atualizado_por`,
      [leadId, m.etapa, m.motivo, m.motivoTexto, usuario.id],
    );
    await db.query(
      `INSERT INTO painel_lead_etapa_historico (lead_id, etapa_de, etapa_para, motivo_perda, motivo_perda_texto, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leadId, atual.etapa, m.etapa, m.motivo, m.motivoTexto, usuario.id],
    );
    // O texto livre do motivo fica só no histórico (pode ter dado pessoal); aqui vai a chave.
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        acao: "mudar_etapa",
        leadId,
        detalhe: { de: atual.etapa, para: m.etapa, motivo: m.motivo, com_texto: m.motivoTexto !== null },
      },
      db,
    );
  });
}

// ── Histórico ──

export interface MudancaNoHistorico {
  id: string;
  lead_id: string;
  etapa_de: EtapaComercial;
  etapa_para: EtapaComercial;
  motivo_perda: string | null;
  motivo_perda_texto: string | null;
  usuario_nome: string | null;
  criado_em: Date;
}

/**
 * Histórico (mais recente primeiro) dos leads `ids`. Quem chama já
 * conferiu que pode ver esses leads (a ficha passa o lead e os cadastros
 * mesclados nele).
 */
export async function historicoDeEtapas(ids: string[]): Promise<MudancaNoHistorico[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool().query<MudancaNoHistorico>(
    `SELECT h.id::text AS id, h.lead_id, h.etapa_de, h.etapa_para, h.motivo_perda, h.motivo_perda_texto,
            coalesce(u.nome, u.email) AS usuario_nome, h.criado_em
       FROM painel_lead_etapa_historico h
       LEFT JOIN painel_usuarios u ON u.id = h.usuario_id
      WHERE h.lead_id = ANY($1::uuid[])
      ORDER BY h.criado_em DESC, h.id DESC`,
    [ids],
  );
  return rows;
}

export interface EtapaDoLead {
  etapa: EtapaComercial;
  desde: Date;
  motivo_perda: string | null;
  motivo_perda_texto: string | null;
  historico: MudancaNoHistorico[];
}

/** Etapa atual e histórico de um lead visível (API), ou null. */
export async function etapaDoLead(usuario: QuemConsulta, leadId: string): Promise<EtapaDoLead | null> {
  if (!UUID.test(leadId)) return null;
  const p = new Parametros();
  const { rows } = await pool().query<Omit<EtapaDoLead, "historico">>(
    `SELECT ${ETAPA_ATUAL} AS etapa, ${NA_ETAPA_DESDE} AS desde, e.motivo_perda, e.motivo_perda_texto
       FROM ${ORIGEM}
      WHERE ${leadsVisiveis(usuario, p)} AND i.id = ${p.add(leadId)}`,
    p.valores,
  );
  if (!rows[0]) return null;
  return { ...rows[0], historico: await historicoDeEtapas([leadId]) };
}

// ── Quadro e lista ──

export interface CartaoDoPipeline {
  id: string;
  nome: string;
  etapa: EtapaComercial;
  na_etapa_desde: Date;
  created_at: Date;
  /** Origem normalizada (igual à do funil), já sem valores com dado pessoal. */
  source: string;
  campaign: string;
  /** Só para admin e suporte (vendas vê só os seus). */
  responsavel_nome: string | null;
  motivo_perda: string | null;
}

export interface ColunaDoPipeline {
  etapa: EtapaComercial;
  total: number;
  cartoes: CartaoDoPipeline[];
  /** Fechado e Perdido sem "tudo": só os últimos 30 dias. */
  recortada: boolean;
}

function condicoesDoPipeline(usuario: QuemConsulta, f: FiltrosPipeline, p: Parametros, comEtapa: boolean): string[] {
  const where = [leadsVisiveis(usuario, p), ...condicoesDePeriodo(f.de, f.ate, p)];
  if (f.responsavel === "sem") where.push(SEM_RESPONSAVEL);
  else if (f.responsavel) where.push(`r.usuario_id = ${p.add(f.responsavel)}`);
  if (f.origem) where.push(`${SOURCE} = ${origemNormalizada(`${p.add(f.origem)}::text`)}`);
  if (f.campanha) where.push(`${CAMPAIGN} = ${origemNormalizada(`${p.add(f.campanha)}::text`)}`);
  if (f.q) where.push(condicaoDeBusca(f.q, p));
  if (comEtapa && f.etapa) where.push(`${ETAPA_ATUAL} = ${p.add(f.etapa)}`);
  if (!f.tudo) {
    // Fechado e Perdido: só quem entrou na etapa nos últimos 30 dias.
    where.push(
      `(${ETAPA_ATUAL} NOT IN (${ETAPAS_FINAIS.map((e) => p.add(e)).join(", ")})
        OR ${NA_ETAPA_DESDE} >= now() - make_interval(days => ${p.add(DIAS_PADRAO_FINAIS)}))`,
    );
  }
  return where;
}

const COLUNAS_DO_CARTAO = `i.id, i.nome, ${ETAPA_ATUAL} AS etapa, ${NA_ETAPA_DESDE} AS na_etapa_desde, i.created_at,
  ${SOURCE} AS source, ${CAMPAIGN} AS campaign, ${NOME_RESPONSAVEL} AS responsavel_nome, e.motivo_perda`;

function protegerCartao(c: CartaoDoPipeline, papel: Papel): CartaoDoPipeline {
  return {
    ...c,
    source: mascararOrigem(c.source),
    campaign: mascararOrigem(c.campaign),
    responsavel_nome: papel === "vendas" ? null : c.responsavel_nome,
  };
}

/** Quadro: uma coluna por etapa, com o total e até `f.limites[etapa]` cartões. */
export async function quadroDoPipeline(usuario: QuemConsulta, f: FiltrosPipeline): Promise<ColunaDoPipeline[]> {
  const p = new Parametros();
  const where = condicoesDoPipeline(usuario, f, p, false).join(" AND ");
  const limites = p.add(ETAPAS_COMERCIAIS.map((e) => f.limites[e] ?? CARTOES_POR_COLUNA));
  const etapas = p.add([...ETAPAS_COMERCIAIS]);
  const finais = p.add([...ETAPAS_FINAIS]);
  const { rows } = await pool().query<CartaoDoPipeline & { rn: number; total: number }>(
    `SELECT * FROM (
       SELECT ${COLUNAS_DO_CARTAO},
              row_number() OVER (
                PARTITION BY ${ETAPA_ATUAL}
                -- Abertas: há mais tempo na etapa primeiro. Fechado e Perdido: os mais recentes.
                ORDER BY CASE WHEN ${ETAPA_ATUAL} = ANY(${finais}::text[]) THEN -extract(epoch FROM ${NA_ETAPA_DESDE})
                              ELSE extract(epoch FROM ${NA_ETAPA_DESDE}) END, i.id
              )::int AS rn,
              (count(*) OVER (PARTITION BY ${ETAPA_ATUAL}))::int AS total
         FROM ${ORIGEM}
        WHERE ${where}
     ) x
     WHERE x.rn <= (${limites}::int[])[array_position(${etapas}::text[], x.etapa)]
     ORDER BY x.etapa, x.rn`,
    p.valores,
  );
  return ETAPAS_COMERCIAIS.map((etapa) => {
    const daEtapa = rows.filter((r) => r.etapa === etapa);
    return {
      etapa,
      total: daEtapa[0]?.total ?? 0,
      cartoes: daEtapa.map((linha) => {
        const { rn, total, ...c } = linha;
        void rn;
        void total;
        return protegerCartao(c, usuario.papel);
      }),
      recortada: !f.tudo && ETAPAS_FINAIS.includes(etapa),
    };
  });
}

const ORDEM_DA_LISTA: Record<OrdemPipeline, string> = {
  nome: 'i.nome COLLATE "und-x-icu"',
  etapa: ORDEM_ETAPA_COMERCIAL,
  na_etapa: NA_ETAPA_DESDE,
  cadastro: "i.created_at",
  responsavel: `${NOME_RESPONSAVEL} COLLATE "und-x-icu"`,
  origem: `${SOURCE} || ' / ' || ${CAMPAIGN}`,
};

export interface ListaDoPipeline {
  itens: CartaoDoPipeline[];
  total: number;
  pagina: number;
  paginas: number;
}

/** Lista: mesma informação do quadro, com filtro de etapa, ordem e página. */
export async function listaDoPipeline(usuario: QuemConsulta, f: FiltrosPipeline): Promise<ListaDoPipeline> {
  const p = new Parametros();
  const where = condicoesDoPipeline(usuario, f, p, true).join(" AND ");
  const { rows: contagem } = await pool().query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${ORIGEM} WHERE ${where}`,
    p.valores,
  );
  const total = contagem[0].total;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_PIPELINE));
  const pagina = Math.min(f.pagina, paginas);
  // "Na etapa desde" crescente = há mais tempo na etapa primeiro.
  const dir = f.dir === "asc" ? "ASC" : "DESC";
  const { rows } = await pool().query<CartaoDoPipeline>(
    `SELECT ${COLUNAS_DO_CARTAO}
       FROM ${ORIGEM}
      WHERE ${where}
      ORDER BY ${ORDEM_DA_LISTA[f.ordem]} ${dir} NULLS LAST, i.created_at DESC, i.id
      LIMIT ${p.add(POR_PAGINA_PIPELINE)} OFFSET ${p.add((pagina - 1) * POR_PAGINA_PIPELINE)}`,
    p.valores,
  );
  return { itens: rows.map((c) => protegerCartao(c, usuario.papel)), total, pagina, paginas };
}

export interface OpcoesDoPipeline {
  origens: string[];
  campanhas: string[];
}

/** Origens e campanhas (normalizadas) dos leads visíveis, sem valores com dado pessoal. */
export async function opcoesDoPipeline(usuario: QuemConsulta): Promise<OpcoesDoPipeline> {
  const distintos = async (expressao: string) => {
    const p = new Parametros();
    const { rows } = await pool().query<{ v: string }>(
      `SELECT DISTINCT ${expressao} AS v FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, p)} ORDER BY 1 LIMIT 500`,
      p.valores,
    );
    return rows.map((r) => r.v).filter((v) => mascararOrigem(v) === v);
  };
  const [origens, campanhas] = await Promise.all([distintos(SOURCE), distintos(CAMPAIGN)]);
  return { origens, campanhas };
}
