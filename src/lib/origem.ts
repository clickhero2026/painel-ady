import { pool } from "./db";
import { AMOSTRA_MINIMA, type FiltrosFunil, type VisaoOrigem } from "./filtrosFunil";
import {
  AGENDOU,
  ATIVOU,
  CAMPAIGN,
  celula,
  condicoes,
  mascararOrigem,
  MEDIUM,
  MINIMO_LEITURA,
  ORIGEM_MASCARADA,
  ordenarLinhas,
  SEM_ORIGEM,
  SOURCE,
  taxa,
} from "./funil";
import type { Papel } from "./papeis";
import { completarOcultas, celulasOcultas } from "./perfil";
import { Parametros } from "./sql";

/**
 * Bloco de origem do funil: mesmos cortes e definições de funil.ts, agrupando
 * pela origem normalizada (source / medium / campaign). Só agregados. Sem
 * os leads cadastrados à mão no painel (LEAD_MANUAL, em funil.ts).
 *
 * Papel "leitura": a ocultação é feita UMA vez, na combinação completa
 * (source + medium + campaign), e as visões agregadas somam só o que ficou
 * visível. Assim, comparar duas visões não revela nada: o que foi oculto está
 * em "outras origens", igual em todas. Uma célula agregada com alguma parte
 * oculta fica oculta. Dentro de cada linha, ativações e agendamentos seguem
 * a mesma regra do perfil (1 a 4 pessoas, ou diferença de 1 a 4).
 */

export const POR_PAGINA = 25;
export const TOPO_DO_GRAFICO = 8;

export interface TaxasOrigem {
  /** ativações / cadastros */
  ativacao: number | null;
  /** agendamentos / ativações */
  agendamento: number | null;
  /** agendamentos / cadastros */
  geral: number | null;
}

/** null = oculto para o papel. */
export interface ContagemOrigem {
  cadastros: number | null;
  ativacoes: number | null;
  agendamentos: number | null;
  taxas: TaxasOrigem;
}

export interface LinhaOrigem extends ContagemOrigem {
  /** Valores da linha, unidos: base da ordenação por nome e chave da tabela. */
  grupo: string;
  /** Campos fora da visão ficam null. */
  source: string | null;
  medium: string | null;
  campaign: string | null;
  cadastros: number;
  amostraPequena: boolean;
  /** Cortes que o clique na linha aplica; null = valor que não vira filtro. */
  filtro: { origem?: string; midia?: string; campanha?: string } | null;
}

export interface OrigemDosLeads {
  visao: VisaoOrigem;
  /** Linhas da página atual. */
  linhas: LinhaOrigem[];
  pagina: { atual: number; total: number; linhasNoTotal: number; porPagina: number };
  /** Só "leitura": a soma das linhas ocultas. */
  outras: ContagemOrigem | null;
  total: ContagemOrigem;
  /** Sem nenhum dos três campos. null nos números = oculto. */
  semOrigem: { cadastros: number | null; percentual: number | null };
  participacao: { source: string; cadastros: number; percentual: number | null }[];
  /** Linhas abaixo disto foram ocultadas; null = nada oculto. */
  ocultaAbaixoDe: number | null;
  /** Sem nenhum cadastro no recorte. */
  vazio: boolean;
}

interface Fina {
  source: string;
  medium: string;
  campaign: string;
  cadastros: number;
  ativacoes: number | null;
  agendamentos: number | null;
}

const minimoDoPapel = (papel: Papel) => (papel === "leitura" ? MINIMO_LEITURA : 0);

/** Contagens por combinação normalizada, já sem valores com dado pessoal. */
async function combinacoes(f: FiltrosFunil): Promise<(Fina & { ativacoes: number; agendamentos: number })[]> {
  const p = new Parametros();
  const { rows } = await pool().query<Fina & { ativacoes: number; agendamentos: number }>(
    `SELECT ${SOURCE} AS source, ${MEDIUM} AS medium, ${CAMPAIGN} AS campaign,
            count(*)::int AS cadastros,
            (count(*) FILTER (WHERE ${ATIVOU}))::int AS ativacoes,
            (count(*) FILTER (WHERE ${AGENDOU}))::int AS agendamentos
       FROM teste7d_inscricoes i
      WHERE ${condicoes(f, p, "excluir")}
      GROUP BY 1, 2, 3`,
    p.valores,
  );
  const juntas = new Map<string, Fina & { ativacoes: number; agendamentos: number }>();
  for (const l of rows) {
    const c = { ...l, source: mascararOrigem(l.source), medium: mascararOrigem(l.medium), campaign: mascararOrigem(l.campaign) };
    const chave = JSON.stringify([c.source, c.medium, c.campaign]);
    const ja = juntas.get(chave);
    if (ja) {
      ja.cadastros += c.cadastros;
      ja.ativacoes += c.ativacoes;
      ja.agendamentos += c.agendamentos;
    } else juntas.set(chave, c);
  }
  return [...juntas.values()];
}

function comTaxas(c: { cadastros: number | null; ativacoes: number | null; agendamentos: number | null }): ContagemOrigem {
  return {
    ...c,
    taxas: {
      ativacao: taxa(c.ativacoes, c.cadastros),
      agendamento: taxa(c.agendamentos, c.ativacoes),
      geral: taxa(c.agendamentos, c.cadastros),
    },
  };
}

const pequeno = (n: number, minimo: number) => n > 0 && n < minimo;

/** Decide o que "leitura" vê: linhas visíveis, a soma das ocultas e as células ocultas de cada uma. */
function proteger(finas: (Fina & { ativacoes: number; agendamentos: number })[], minimo: number) {
  if (minimo === 0) return { visiveis: finas as Fina[], outras: null };

  const ocultas = celulasOcultas(
    finas.map((l) => l.cadastros),
    minimo,
  );
  const visiveis = finas.filter((_, k) => !ocultas[k]);
  const resto = finas.filter((_, k) => ocultas[k]);
  const soma = (col: "cadastros" | "ativacoes" | "agendamentos") => resto.reduce((s, l) => s + l[col], 0);
  const partes = resto.length
    ? [...visiveis, { cadastros: soma("cadastros"), ativacoes: soma("ativacoes"), agendamentos: soma("agendamentos") }]
    : visiveis;

  // Cada coluna soma um total que aparece na tela (o KPI): daí o complemento.
  const ativOculta = completarOcultas(
    partes.map((l) => l.ativacoes),
    partes.map((l) => pequeno(l.ativacoes, minimo) || pequeno(l.cadastros - l.ativacoes, minimo)),
    minimo,
  );
  const agendOculta = completarOcultas(
    partes.map((l) => l.agendamentos),
    partes.map((l) => pequeno(l.agendamentos, minimo) || pequeno(l.ativacoes - l.agendamentos, minimo)),
    minimo,
  );
  const protegidas = partes.map((l, k) => ({
    ...l,
    ativacoes: ativOculta[k] ? null : l.ativacoes,
    agendamentos: agendOculta[k] ? null : l.agendamentos,
  }));
  const ultima = protegidas.at(-1);
  return {
    visiveis: (resto.length ? protegidas.slice(0, -1) : protegidas) as Fina[],
    outras:
      resto.length && ultima
        ? { cadastros: ultima.cadastros >= minimo ? ultima.cadastros : null, ativacoes: ultima.ativacoes, agendamentos: ultima.agendamentos }
        : null,
  };
}

const CAMPOS_DA_VISAO: Record<VisaoOrigem, readonly ("source" | "medium" | "campaign")[]> = {
  completa: ["source", "medium", "campaign"],
  source: ["source"],
  source_medium: ["source", "medium"],
  campaign: ["campaign"],
};

const CORTE_DO_CAMPO = { source: "origem", medium: "midia", campaign: "campanha" } as const;

const somaOuOculto = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);

/** Soma as combinações visíveis nas linhas da visão. */
function agregar(finas: Fina[], visao: VisaoOrigem): LinhaOrigem[] {
  const campos = CAMPOS_DA_VISAO[visao];
  const grupos = new Map<string, Fina>();
  for (const l of finas) {
    const chave = JSON.stringify(campos.map((c) => l[c]));
    const g = grupos.get(chave);
    if (g) {
      g.cadastros += l.cadastros;
      g.ativacoes = somaOuOculto(g.ativacoes, l.ativacoes);
      g.agendamentos = somaOuOculto(g.agendamentos, l.agendamentos);
    } else grupos.set(chave, { ...l });
  }
  return [...grupos.values()].map((g) => {
    const mascarada = campos.some((c) => g[c] === ORIGEM_MASCARADA);
    return {
      ...comTaxas(g),
      cadastros: g.cadastros,
      grupo: campos.map((c) => g[c]).join(" / "),
      source: campos.includes("source") ? g.source : null,
      medium: campos.includes("medium") ? g.medium : null,
      campaign: campos.includes("campaign") ? g.campaign : null,
      amostraPequena: g.cadastros < AMOSTRA_MINIMA,
      filtro: mascarada ? null : Object.fromEntries(campos.map((c) => [CORTE_DO_CAMPO[c], g[c]])),
    };
  });
}

/** Todas as linhas da visão, ordenadas, e o resto do bloco (sem paginar). */
async function calcular(f: FiltrosFunil, papel: Papel) {
  const minimo = minimoDoPapel(papel);
  const finas = await combinacoes(f);
  const { visiveis, outras } = proteger(finas, minimo);

  const soma = (col: "cadastros" | "ativacoes" | "agendamentos") => finas.reduce((s, l) => s + l[col], 0);
  const cadastros = soma("cadastros");
  const totalVisivel = cadastros === 0 || cadastros >= minimo;
  const ativacoes = soma("ativacoes");
  const agendamentos = soma("agendamentos");
  const total = comTaxas({
    cadastros: totalVisivel ? cadastros : null,
    ativacoes: pequeno(ativacoes, minimo) || !totalVisivel ? null : ativacoes,
    agendamentos: pequeno(agendamentos, minimo) || !totalVisivel ? null : agendamentos,
  });

  const linhas = ordenarLinhas(agregar(visiveis, f.vo), f.oo, f.odo);
  const fracao = (n: number) => taxa(n, totalVisivel ? cadastros : null);

  const semNada = finas.find((l) => l.source === SEM_ORIGEM && l.medium === SEM_ORIGEM && l.campaign === SEM_ORIGEM);
  const semVisivel = visiveis.find((l) => l.source === SEM_ORIGEM && l.medium === SEM_ORIGEM && l.campaign === SEM_ORIGEM);
  const semOrigem = !semNada
    ? { cadastros: 0, percentual: 0 }
    : semVisivel
      ? { cadastros: semVisivel.cadastros, percentual: fracao(semVisivel.cadastros) }
      : { cadastros: null, percentual: null };

  const participacao = agregar(visiveis, "source")
    .map((l) => ({ source: l.source!, cadastros: l.cadastros, percentual: fracao(l.cadastros) }))
    .sort((a, b) => b.cadastros - a.cadastros || a.source.localeCompare(b.source, "pt-BR"));

  return {
    linhas,
    outras: outras ? comTaxas(outras) : null,
    total,
    semOrigem,
    participacao,
    ocultaAbaixoDe: minimo > 0 ? minimo : null,
    vazio: cadastros === 0,
  };
}

/** O bloco de origem do recorte, já protegido para o papel e com a página pedida. */
export async function origemDosLeads(f: FiltrosFunil, papel: Papel): Promise<OrigemDosLeads> {
  const { linhas, ...resto } = await calcular(f, papel);
  const total = Math.max(1, Math.ceil(linhas.length / POR_PAGINA));
  const atual = Math.min(f.po, total);
  return {
    ...resto,
    visao: f.vo,
    linhas: linhas.slice((atual - 1) * POR_PAGINA, atual * POR_PAGINA),
    pagina: { atual, total, linhasNoTotal: linhas.length, porPagina: POR_PAGINA },
  };
}

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);

/** CSV (";", vírgula decimal, BOM) de todas as linhas da visão, sem paginar. Valores de UTM protegidos contra fórmula. */
export async function csvOrigem(f: FiltrosFunil, papel: Papel): Promise<{ csv: string; linhas: number }> {
  const { linhas } = await calcular(f, papel);
  const cabecalho = [
    "source",
    "medium",
    "campaign",
    "cadastros",
    "ativacoes",
    "taxa_ativacao_%",
    "agendamentos",
    "taxa_agendamento_%",
    "taxa_cadastro_agendamento_%",
    "amostra_pequena",
  ];
  const corpo = linhas.map((l) =>
    [
      l.source,
      l.medium,
      l.campaign,
      l.cadastros,
      l.ativacoes,
      pct(l.taxas.ativacao),
      l.agendamentos,
      pct(l.taxas.agendamento),
      pct(l.taxas.geral),
      l.amostraPequena ? "sim" : "nao",
    ]
      .map(celula)
      .join(";"),
  );
  return { csv: `﻿${[cabecalho.join(";"), ...corpo].join("\r\n")}\r\n`, linhas: linhas.length };
}
