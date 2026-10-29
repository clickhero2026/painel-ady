import * as z from "zod";
import { VERSOES } from "./filtrosLeads";

/**
 * Cortes da tela de funil, lidos da URL. Valor inválido é descartado (nunca
 * vira erro nem entra no SQL cru). Arquivo puro (sem banco).
 *
 * Período: sem `de`/`ate`, vale o atalho `periodo` (padrão: 30 dias, até
 * hoje em São Paulo). "tudo" tira os limites de data.
 */

export const PERIODOS = ["7d", "30d", "90d", "tudo"] as const;
export type Periodo = (typeof PERIODOS)[number];

export const ROTULO_PERIODO: Record<Periodo, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  tudo: "Tudo",
};

const DIAS_DO_PERIODO: Record<Exclude<Periodo, "tudo">, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Ordenação das tabelas comparativas. */
export const ORDENS_TABELA = [
  "grupo",
  "cadastros",
  "ativacoes",
  "taxa_ativacao",
  "agendamentos",
  "taxa_agendamento",
  "taxa_geral",
  "realizadas",
] as const;
export type OrdemTabela = (typeof ORDENS_TABELA)[number];

export interface FiltrosFunil {
  /** Atalho escolhido; "personalizado" quando `de` ou `ate` vieram na URL. */
  periodo: Periodo | "personalizado";
  /** Datas de São Paulo (AAAA-MM-DD), inclusivas. Ausentes = sem limite. */
  de?: string;
  ate?: string;
  criativo?: string;
  campanha?: string;
  origem?: string;
  midia?: string;
  versao?: (typeof VERSOES)[number];
  /** Ordem da tabela por criativo e da tabela por versão. */
  oc: OrdemTabela;
  dc: "asc" | "desc";
  ov: OrdemTabela;
  dv: "asc" | "desc";
}

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)));
const texto = z.string().trim().min(1).max(200);
const direcao = z.enum(["asc", "desc"]);

const campos = {
  periodo: z.enum(PERIODOS),
  de: data,
  ate: data,
  criativo: texto,
  campanha: texto,
  origem: texto,
  midia: texto,
  versao: z.enum(VERSOES),
  oc: z.enum(ORDENS_TABELA),
  dc: direcao,
  ov: z.enum(ORDENS_TABELA),
  dv: direcao,
};

type Entrada = Record<string, string | string[] | undefined> | URLSearchParams;

function valor(entrada: Entrada, chave: string): string | undefined {
  const v = entrada instanceof URLSearchParams ? (entrada.get(chave) ?? undefined) : entrada[chave];
  return Array.isArray(v) ? v[0] : v;
}

const hojeSp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** Data de hoje em São Paulo (AAAA-MM-DD). */
export function hojeEmSaoPaulo(agora = new Date()): string {
  return hojeSp.format(agora);
}

/** `dia` (AAAA-MM-DD) mais `n` dias, sem passar por fuso. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function lerFiltrosFunil(entrada: Entrada, agora = new Date()): FiltrosFunil {
  const lido: Record<string, unknown> = {};
  for (const [chave, esquema] of Object.entries(campos)) {
    const bruto = valor(entrada, chave);
    if (bruto === undefined || bruto === "") continue;
    const r = esquema.safeParse(bruto);
    if (r.success) lido[chave] = r.data;
  }

  let { de, ate } = lido as { de?: string; ate?: string };
  let periodo: FiltrosFunil["periodo"];
  if (de || ate) {
    periodo = "personalizado";
    // Datas trocadas: vale o intervalo que a pessoa quis dizer.
    if (de && ate && de > ate) [de, ate] = [ate, de];
  } else {
    periodo = (lido.periodo as Periodo | undefined) ?? "30d";
    if (periodo !== "tudo") {
      ate = hojeEmSaoPaulo(agora);
      de = somarDias(ate, -(DIAS_DO_PERIODO[periodo] - 1));
    }
  }

  return {
    periodo,
    de,
    ate,
    criativo: lido.criativo as string | undefined,
    campanha: lido.campanha as string | undefined,
    origem: lido.origem as string | undefined,
    midia: lido.midia as string | undefined,
    versao: lido.versao as FiltrosFunil["versao"],
    oc: (lido.oc as OrdemTabela) ?? "cadastros",
    dc: (lido.dc as "asc" | "desc") ?? (lido.oc ? "asc" : "desc"),
    ov: (lido.ov as OrdemTabela) ?? "grupo",
    dv: (lido.dv as "asc" | "desc") ?? "asc",
  };
}

/**
 * Query string da tela mudando só o que vier em `mudar`. Com período de
 * atalho, as datas calculadas não vão pra URL (o link continua "30 dias"
 * amanhã).
 */
export function parametrosDoFunil(
  filtros: FiltrosFunil,
  mudar: Partial<Record<keyof FiltrosFunil, string | undefined>> = {},
): URLSearchParams {
  const todos = { ...filtros, ...mudar } as Record<string, unknown>;
  const p = new URLSearchParams();
  const personalizado = todos.periodo === "personalizado";
  for (const chave of Object.keys(campos)) {
    const v = todos[chave];
    if (v === undefined || v === "") continue;
    if (chave === "periodo" && (personalizado || v === "30d")) continue;
    if ((chave === "de" || chave === "ate") && !personalizado) continue;
    if (chave === "oc" && v === "cadastros" && todos.dc === "desc") continue;
    if (chave === "dc" && v === "desc" && todos.oc === "cadastros") continue;
    if (chave === "ov" && v === "grupo" && todos.dv === "asc") continue;
    if (chave === "dv" && v === "asc" && todos.ov === "grupo") continue;
    p.set(chave, String(v));
  }
  return p;
}

/** URL de uma tela com estes cortes (o funil e o perfil usam os mesmos). */
export function urlDoRecorte(
  caminho: string,
  filtros: FiltrosFunil,
  mudar: Partial<Record<keyof FiltrosFunil, string | undefined>> = {},
): string {
  const qs = parametrosDoFunil(filtros, mudar).toString();
  return qs ? `${caminho}?${qs}` : caminho;
}

export function urlDoFunil(filtros: FiltrosFunil, mudar: Partial<Record<keyof FiltrosFunil, string | undefined>> = {}): string {
  return urlDoRecorte("/funil", filtros, mudar);
}

/** Abaixo disto, a tela marca "amostra pequena". */
export const AMOSTRA_MINIMA = 30;
