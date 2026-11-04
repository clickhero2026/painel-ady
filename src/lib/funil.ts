import { pool } from "./db";
import { NAO_MESCLADO } from "./escopo";
import { hojeEmSaoPaulo, somarDias, type FiltrosFunil, type OrdemTabela } from "./filtrosFunil";
import type { Papel } from "./papeis";
import { FUSO_SQL, Parametros } from "./sql";

/**
 * ÚNICO módulo de consultas dos indicadores do funil. Toda a tela (e a API
 * e o CSV) sai daqui, com estas definições:
 *   - Cadastro: linha em teste7d_inscricoes, created_at no período;
 *   - Ativação completa: etapa2_concluida_em não nulo;
 *   - Agendou: agendado_em não nulo (vem do navegador da pessoa, pode faltar);
 *   - Reunião realizada: status = 'realizado' ou realizada_em não nulo;
 *   - Não compareceu: status = 'nao_compareceu'.
 * Corte por coorte: o período filtra só a data do CADASTRO; as etapas
 * seguintes contam mesmo que tenham acontecido depois do período. Datas e
 * dias no fuso de São Paulo.
 *
 * Reunião sem dados: hoje nenhum fluxo grava o resultado da reunião. Num
 * recorte (o total ou cada linha das tabelas) sem nenhum resultado de
 * reunião — realizada_em, status 'realizado' ou 'nao_compareceu' — os
 * números de reunião voltam null ("sem dados"), nunca zero.
 *
 * Só agregados: nenhuma coluna de dado pessoal é lida aqui. Os cortes são
 * globais (não dependem do papel nem do responsável pelo lead). Cadastros
 * mesclados em outro ficam fora de tudo (`condicoes` aplica NAO_MESCLADO).
 * Leads cadastrados à mão no painel (LEAD_MANUAL) ficam fora daqui, do
 * perfil e da origem; o funil comercial os inclui (parâmetro `manuais`).
 */

/** Etapas, como condição SQL sobre `teste7d_inscricoes i` (usadas também pelo perfil). */
/** Papel "leitura": linhas e células com menos cadastros que isto ficam ocultas (perfil e origem). */
export const MINIMO_LEITURA = 5;

export const ATIVOU = "i.etapa2_concluida_em IS NOT NULL";
export const AGENDOU = "i.agendado_em IS NOT NULL";
const REALIZADA = "(i.status = 'realizado' OR i.realizada_em IS NOT NULL)";
const NAO_COMPARECEU = "i.status = 'nao_compareceu'";
const RESULTADO_DE_REUNIAO = `(${REALIZADA} OR ${NAO_COMPARECEU})`;

const CONTAGENS = `count(*)::int AS cadastros,
  (count(*) FILTER (WHERE ${ATIVOU}))::int AS ativacoes,
  (count(*) FILTER (WHERE ${AGENDOU}))::int AS agendamentos,
  (count(*) FILTER (WHERE ${REALIZADA}))::int AS realizadas,
  (count(*) FILTER (WHERE ${NAO_COMPARECEU}))::int AS nao_compareceu,
  (count(*) FILTER (WHERE ${RESULTADO_DE_REUNIAO}))::int AS com_resultado`;

const mediana = (fim: string, inicio: string) =>
  `percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${fim} - ${inicio})::float8)`;

const DIA_SP = `(i.created_at AT TIME ZONE '${FUSO_SQL}')::date`;

// ── Normalização da origem (utm_source, utm_medium, utm_campaign) ──

/** Rótulo de quem não tem o campo: nulo ou vazio nunca é descartado. */
export const SEM_ORIGEM = "(sem origem)";
/** Tamanho máximo do valor de origem (o site já corta em 255). */
export const MAX_ORIGEM = 255;
/** Espaços explícitos: `\\s` do Postgres depende do locale do banco. */
const ESPACOS = String.raw`[\s\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+`;

/**
 * ÚNICA definição de origem normalizada: minúsculas, sem espaços nas pontas,
 * espaços internos colapsados; nulo ou vazio vira "(sem origem)". Fica em
 * SQL e é aplicada também ao valor do filtro, então a linha da tabela e o
 * corte nunca divergem (nem em letras acentuadas, que dependem do locale).
 */
export function origemNormalizada(expressao: string): string {
  return `left(coalesce(nullif(btrim(regexp_replace(lower(${expressao}), '${ESPACOS}', ' ', 'g')), ''), '${SEM_ORIGEM}'), ${MAX_ORIGEM})`;
}

export const SOURCE = origemNormalizada("i.utm_source");
export const MEDIUM = origemNormalizada("i.utm_medium");
export const CAMPAIGN = origemNormalizada("i.utm_campaign");

/** O que aparece no lugar de um valor de UTM que traz dado pessoal. */
export const ORIGEM_MASCARADA = "(valor com dado pessoal)";

const PARECE_PESSOAL = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // e-mail
  /(?<!\d)(?:55)?\d{2}9?\d{8}(?!\d)/, // telefone do Brasil (ids de anúncio do Meta têm 15+ dígitos)
  /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/, // token de retomada
];

/** UTM vem de qualquer link: e-mail, telefone ou token nele não sai do servidor. */
export function mascararOrigem(valor: string): string {
  return PARECE_PESSOAL.some((r) => r.test(valor)) ? ORIGEM_MASCARADA : valor;
}

// ── Leads cadastrados à mão no painel ──

/** utm_source gravado pelo cadastro manual (leadManual.ts), já normalizado. */
export const ORIGEM_MANUAL = "manual";
/**
 * Lead cadastrado à mão no painel (origem normalizada = "manual"). Não veio
 * de anúncio: fica FORA dos indicadores de marketing (funil, criativo,
 * campanha, versão, origem, perfil e as opções de criativo e campanha) e
 * DENTRO do que é operação (lista, pipeline, ficha, contadores do menu e
 * funil comercial).
 */
export const LEAD_MANUAL = `${SOURCE} = '${ORIGEM_MANUAL}'`;

/**
 * Os leads manuais entram no recorte? Sem padrão de propósito: cada consulta
 * diz o que quer. Indicadores de marketing: "excluir"; funil comercial: "incluir".
 */
export type Manuais = "incluir" | "excluir";

/** Condições SQL dos cortes (todas sobre `teste7d_inscricoes i`). */
export function condicoes(f: FiltrosFunil, p: Parametros, manuais: Manuais): string {
  // Cadastro mesclado em outro não conta em lugar nenhum (escopo.ts).
  const where = [NAO_MESCLADO];
  if (manuais === "excluir") where.push(`NOT (${LEAD_MANUAL})`);
  // Limites do dia em São Paulo, convertidos pra instante: usa o índice de created_at.
  if (f.de) where.push(`i.created_at >= (${p.add(f.de)}::date::timestamp AT TIME ZONE '${FUSO_SQL}')`);
  if (f.ate) where.push(`i.created_at < ((${p.add(f.ate)}::date + 1)::timestamp AT TIME ZONE '${FUSO_SQL}')`);
  if (f.criativo) where.push(`i.utm_content = ${p.add(f.criativo)}`);
  if (f.campanha) where.push(`${CAMPAIGN} = ${origemNormalizada(`${p.add(f.campanha)}::text`)}`);
  if (f.origem) where.push(`${SOURCE} = ${origemNormalizada(`${p.add(f.origem)}::text`)}`);
  if (f.midia) where.push(`${MEDIUM} = ${origemNormalizada(`${p.add(f.midia)}::text`)}`);
  if (f.versao) where.push(`i.lp_variant = ${p.add(f.versao)}`);
  return where.join(" AND ");
}

// ── Tipos do resultado ──

export interface Contagens {
  cadastros: number;
  ativacoes: number;
  agendamentos: number;
  /** null = sem dados de reunião no recorte. */
  realizadas: number | null;
  naoCompareceu: number | null;
}

export interface Taxas {
  /** ativações / cadastros */
  ativacao: number | null;
  /** agendamentos / ativações */
  agendamento: number | null;
  /** realizadas / agendamentos */
  realizada: number | null;
  /** agendamentos / cadastros */
  geral: number | null;
}

export interface Resumo extends Contagens {
  taxas: Taxas;
  /** Medianas em segundos; null quando não há nenhum par de datas. */
  medianas: { ativacao: number | null; agendamento: number | null; realizada: number | null };
}

export interface LinhaComparativa extends Contagens {
  /** Criativo ou versão; null = cadastro sem esse dado. */
  grupo: string | null;
  taxas: Taxas;
}

export interface DiaDaSerie {
  dia: string;
  cadastros: number;
}

export interface PassoDaAtivacao {
  id: string;
  pergunta: string;
  /** Cadastros que chegaram a esta pergunta (responderam todas as anteriores). */
  chegaram: number;
  /** Pararam aqui: esta é a primeira pergunta sem resposta. */
  pararam: number;
}

export interface IndicadoresFunil {
  resumo: Resumo;
  serie: DiaDaSerie[];
  porCriativo: LinhaComparativa[];
  porVersao: LinhaComparativa[];
  abandono: { passos: PassoDaAtivacao[]; concluiram: number };
}

// ── Contas ──

interface LinhaContagem {
  cadastros: number;
  ativacoes: number;
  agendamentos: number;
  realizadas: number;
  nao_compareceu: number;
  com_resultado: number;
}

function contagens(l: LinhaContagem): Contagens {
  const temReuniao = l.com_resultado > 0;
  return {
    cadastros: l.cadastros,
    ativacoes: l.ativacoes,
    agendamentos: l.agendamentos,
    realizadas: temReuniao ? l.realizadas : null,
    naoCompareceu: temReuniao ? l.nao_compareceu : null,
  };
}

export function taxa(parte: number | null, todo: number | null): number | null {
  return parte === null || todo === null || todo === 0 ? null : parte / todo;
}

function taxas(c: Contagens): Taxas {
  return {
    ativacao: taxa(c.ativacoes, c.cadastros),
    agendamento: taxa(c.agendamentos, c.ativacoes),
    realizada: taxa(c.realizadas, c.agendamentos),
    geral: taxa(c.agendamentos, c.cadastros),
  };
}

async function resumo(f: FiltrosFunil): Promise<Resumo> {
  const p = new Parametros();
  const { rows } = await pool().query<
    LinhaContagem & { m_ativacao: number | null; m_agendamento: number | null; m_realizada: number | null }
  >(
    `SELECT ${CONTAGENS},
            ${mediana("i.etapa2_concluida_em", "i.created_at")} AS m_ativacao,
            ${mediana("i.agendado_em", "i.etapa2_concluida_em")} AS m_agendamento,
            ${mediana("i.realizada_em", "i.agendado_em")} AS m_realizada
       FROM teste7d_inscricoes i
      WHERE ${condicoes(f, p, "excluir")}`,
    p.valores,
  );
  const l = rows[0];
  const c = contagens(l);
  return {
    ...c,
    taxas: taxas(c),
    medianas: {
      ativacao: l.m_ativacao,
      agendamento: l.m_agendamento,
      realizada: c.realizadas === null ? null : l.m_realizada,
    },
  };
}

async function comparativo(f: FiltrosFunil, coluna: "i.utm_content" | "i.lp_variant"): Promise<LinhaComparativa[]> {
  const p = new Parametros();
  const { rows } = await pool().query<LinhaContagem & { grupo: string | null }>(
    `SELECT ${coluna} AS grupo, ${CONTAGENS}
       FROM teste7d_inscricoes i
      WHERE ${condicoes(f, p, "excluir")}
      GROUP BY ${coluna}`,
    p.valores,
  );
  return rows.map((l) => {
    const c = contagens(l);
    return { grupo: l.grupo, ...c, taxas: taxas(c) };
  });
}

const MAX_DIAS_DA_SERIE = 366;

/** Cadastros por dia (São Paulo), com os dias sem cadastro preenchidos com zero. */
async function serie(f: FiltrosFunil, agora: Date): Promise<DiaDaSerie[]> {
  const p = new Parametros();
  const { rows } = await pool().query<{ dia: string; cadastros: number }>(
    `SELECT to_char(${DIA_SP}, 'YYYY-MM-DD') AS dia, count(*)::int AS cadastros
       FROM teste7d_inscricoes i
      WHERE ${condicoes(f, p, "excluir")}
      GROUP BY 1
      ORDER BY 1`,
    p.valores,
  );
  if (rows.length === 0 && (!f.de || !f.ate)) return [];
  const porDia = new Map(rows.map((r) => [r.dia, r.cadastros]));
  // Intervalo enorme (ex. "de 2000-01-01"): começa no primeiro cadastro.
  let inicio = f.de ?? rows[0].dia;
  if (rows.length && somarDias(inicio, MAX_DIAS_DA_SERIE) < rows[0].dia) inicio = rows[0].dia;
  const fim = f.ate ?? [rows.at(-1)!.dia, hojeEmSaoPaulo(agora)].sort().at(-1)!;
  const dias: DiaDaSerie[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push({ dia: d, cadastros: porDia.get(d) ?? 0 });
  return dias;
}

// ── Abandono na ativação ──

/**
 * Telas da ativação, na ordem do site (clickhero2026/site-ady,
 * src/lib/teste7dEtapa2.ts, commit 0c65fe1), e quando cada uma conta como
 * respondida (mesma regra de `telaRespondida` de lá).
 *
 * O site salva a cada "Continuar": um PATCH com os campos do bloco da tela
 * atual. Então a resposta de cada pergunta chega ao banco assim que a
 * pessoa avança dela, e a primeira tela sem resposta é onde ela parou (é
 * também onde a retomada a leva). Não há horário por pergunta.
 */
export const preenchido = (coluna: string) => `nullif(btrim(i.${coluna}), '') IS NOT NULL`;

export const TELAS_DA_ATIVACAO: readonly { id: string; pergunta: string; respondida: string }[] = [
  { id: "negocio", pergunta: "Nome do negócio e o que vende", respondida: preenchido("negocio_nome_oferta") },
  {
    id: "cidade",
    pergunta: "Cidade e bairro que atende",
    respondida: `(${preenchido("cidade_bairro")} OR i.atende_todo_brasil IS TRUE)`,
  },
  {
    id: "acao",
    pergunta: "O que a pessoa deve fazer ao ver o anúncio",
    respondida: `(${preenchido("acao_desejada")} AND (i.acao_desejada <> 'outro' OR ${preenchido("acao_desejada_outro")}))`,
  },
  { id: "experiencia", pergunta: "Experiência com anúncios", respondida: preenchido("experiencia_anuncios") },
  { id: "acesso", pergunta: "Perfil no Instagram e página no Facebook", respondida: preenchido("acesso_redes") },
  { id: "conta", pergunta: "Conta de anúncios", respondida: preenchido("conta_anuncios") },
  { id: "cartao", pergunta: "Cartão para pagar os anúncios", respondida: preenchido("cartao_pagamento") },
  { id: "logo", pergunta: "Arquivo da logo", respondida: preenchido("arquivo_logo") },
  { id: "reuniao", pergunta: "Reunião pelo computador", respondida: preenchido("reuniao_computador") },
  // Opcional: quem chega aqui e não conclui parou na última tela.
  { id: "observacoes", pergunta: "Observações (opcional, última tela)", respondida: "FALSE" },
];

const PAROU_EM = `CASE
  WHEN ${ATIVOU} THEN 'concluiu'
  ${TELAS_DA_ATIVACAO.map((t) => `WHEN NOT ${t.respondida} THEN '${t.id}'`).join("\n  ")}
END`;

async function abandono(f: FiltrosFunil): Promise<IndicadoresFunil["abandono"]> {
  const p = new Parametros();
  const { rows } = await pool().query<{ parou: string; n: number }>(
    `SELECT ${PAROU_EM} AS parou, count(*)::int AS n
       FROM teste7d_inscricoes i
      WHERE ${condicoes(f, p, "excluir")}
      GROUP BY 1`,
    p.valores,
  );
  const n = new Map(rows.map((r) => [r.parou, r.n]));
  let chegaram = rows.reduce((s, r) => s + r.n, 0);
  const passos = TELAS_DA_ATIVACAO.map((t) => {
    const pararam = n.get(t.id) ?? 0;
    const passo = { id: t.id, pergunta: t.pergunta, chegaram, pararam };
    chegaram -= pararam;
    return passo;
  });
  return { passos, concluiram: n.get("concluiu") ?? 0 };
}

// ── Ordenação das tabelas ──

/** O que uma linha precisa ter para ser ordenada (comparativo e origem). */
export interface LinhaOrdenavel {
  grupo: string | null;
  cadastros: number | null;
  ativacoes: number | null;
  agendamentos: number | null;
  realizadas?: number | null;
  taxas: { ativacao: number | null; agendamento: number | null; geral: number | null };
}

function valorDaOrdem(l: LinhaOrdenavel, ordem: OrdemTabela): string | number | null {
  switch (ordem) {
    case "grupo":
      return l.grupo;
    case "cadastros":
    case "ativacoes":
    case "agendamentos":
      return l[ordem];
    case "realizadas":
      return l.realizadas ?? null;
    case "taxa_ativacao":
      return l.taxas.ativacao;
    case "taxa_agendamento":
      return l.taxas.agendamento;
    case "taxa_geral":
      return l.taxas.geral;
  }
}

/** Ordena as linhas; "sem dados" e grupo vazio sempre por último, empate pelo nome. */
export function ordenarLinhas<T extends LinhaOrdenavel>(linhas: T[], ordem: OrdemTabela, dir: "asc" | "desc"): T[] {
  const sinal = dir === "asc" ? 1 : -1;
  const nome = (l: T) => l.grupo ?? "";
  return [...linhas].sort((a, b) => {
    const va = valorDaOrdem(a, ordem);
    const vb = valorDaOrdem(b, ordem);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else if (va !== vb) {
      return (typeof va === "number" ? va - (vb as number) : va.localeCompare(vb as string, "pt-BR")) * sinal;
    }
    if (a.grupo === null || b.grupo === null) return a.grupo === b.grupo ? 0 : a.grupo === null ? 1 : -1;
    return nome(a).localeCompare(nome(b), "pt-BR");
  });
}

// ── Entrada única ──

export async function indicadoresDoFunil(f: FiltrosFunil, agora = new Date()): Promise<IndicadoresFunil> {
  const [r, s, criativos, versoes, a] = await Promise.all([
    resumo(f),
    serie(f, agora),
    comparativo(f, "i.utm_content"),
    comparativo(f, "i.lp_variant"),
    abandono(f),
  ]);
  return {
    resumo: r,
    serie: s,
    porCriativo: ordenarLinhas(criativos, f.oc, f.dc),
    porVersao: ordenarLinhas(versoes, f.ov, f.dv),
    abandono: a,
  };
}

export interface OpcoesDoFunil {
  criativos: string[];
  campanhas: string[];
  origens: string[];
  midias: string[];
}

/**
 * Valores existentes de cada corte (de todos os cadastros; criativo e
 * campanha sem os leads manuais). Campanha, origem
 * e mídia já normalizadas. Para "leitura", valor de poucos cadastros não
 * aparece na lista: o nome de uma origem rara não sai por aqui.
 */
export async function opcoesDoFunil(papel: Papel): Promise<OpcoesDoFunil> {
  const minimo = papel === "leitura" ? MINIMO_LEITURA : 1;
  const distintos = async (expressao: string, semManuais: boolean) =>
    (
      await pool().query<{ v: string }>(
        `SELECT ${expressao} AS v FROM teste7d_inscricoes i
          WHERE ${NAO_MESCLADO}${semManuais ? ` AND NOT (${LEAD_MANUAL})` : ""}
          GROUP BY 1 HAVING count(*) >= ${minimo} ORDER BY 1 LIMIT 500`,
      )
    ).rows
      .map((r) => r.v)
      .filter((v) => mascararOrigem(v) === v);
  const [criativos, campanhas, origens, midias] = await Promise.all([
    (
      await pool().query<{ v: string }>(
        `SELECT DISTINCT i.utm_content AS v FROM teste7d_inscricoes i
          WHERE i.utm_content IS NOT NULL AND ${NAO_MESCLADO} AND NOT (${LEAD_MANUAL}) ORDER BY 1 LIMIT 500`,
      )
    ).rows.map((r) => r.v),
    // Criativo e campanha: sem os leads manuais (não vieram de anúncio).
    distintos(CAMPAIGN, true),
    // Origem e mídia: com eles, para dar para recortar o funil comercial por "manual".
    distintos(SOURCE, false),
    distintos(MEDIUM, false),
  ]);
  return { criativos, campanhas, origens, midias };
}

// ── CSV da tabela comparativa ──

/** Célula de CSV: aspas quando preciso e sem fórmula (utm vem de qualquer link). */
export function celula(v: string | number | null): string {
  if (v === null) return "";
  let t = typeof v === "number" ? String(v).replace(".", ",") : v;
  if (/^[=+\-@\t\r＝＋－＠]/.test(t)) t = `'${t}`;
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const SEM_DADOS = "sem dados";
const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);

/**
 * CSV (separador ";", vírgula decimal, BOM) com as duas tabelas
 * comparativas. Taxa sem denominador fica vazia; reunião sem dados, "sem dados".
 */
export function csvComparativo(ind: IndicadoresFunil, amostraMinima: number): string {
  const cabecalho = [
    "corte",
    "grupo",
    "cadastros",
    "ativacoes",
    "taxa_ativacao_%",
    "agendamentos",
    "taxa_agendamento_%",
    "taxa_cadastro_agendamento_%",
    "realizadas",
    "nao_compareceu",
    "taxa_realizada_%",
    "amostra_pequena",
  ];
  const linhas = [cabecalho.join(";")];
  for (const [corte, lista, vazio] of [
    ["criativo", ind.porCriativo, "(sem criativo)"],
    ["versao_titulo", ind.porVersao, "(sem versão)"],
  ] as const) {
    for (const l of lista) {
      linhas.push(
        [
          corte,
          l.grupo ?? vazio,
          l.cadastros,
          l.ativacoes,
          pct(l.taxas.ativacao),
          l.agendamentos,
          pct(l.taxas.agendamento),
          pct(l.taxas.geral),
          l.realizadas ?? SEM_DADOS,
          l.naoCompareceu ?? SEM_DADOS,
          l.realizadas === null ? SEM_DADOS : pct(l.taxas.realizada),
          l.cadastros < amostraMinima ? "sim" : "nao",
        ]
          .map(celula)
          .join(";"),
      );
    }
  }
  return `﻿${linhas.join("\r\n")}\r\n`;
}
