import * as z from "zod";
import { ETAPAS } from "./etapas";
import type { Papel } from "./papeis";

/**
 * Filtros, visão, ordenação e página da lista de leads, lidos da URL. Valor
 * inválido é descartado (nunca vira erro nem entra no SQL cru).
 */

export const VISOES = ["parados", "agendados_semana", "sem_reuniao", "sem_responsavel", "para_fechar"] as const;
export type Visao = (typeof VISOES)[number];

export const ROTULO_VISAO: Record<Visao, string> = {
  parados: "Cadastros parados",
  agendados_semana: "Agendados esta semana",
  sem_reuniao: "Sem reunião marcada",
  sem_responsavel: "Sem responsável",
  para_fechar: "Reuniões para fechar",
};

/** Quem vê cada visão restrita (as demais: todos que veem leads). */
export function podeVerVisao(visao: Visao, papel: Papel): boolean {
  if (visao === "sem_responsavel") return papel === "admin";
  if (visao === "para_fechar") return papel === "admin" || papel === "suporte";
  return true;
}

export const ORDENS = ["cadastro", "nome", "etapa", "criativo", "versao", "responsavel", "reuniao", "parado", "agendamento"] as const;
export type Ordem = (typeof ORDENS)[number];

export const VERSOES = ["A", "B", "C", "D", "E", "F"] as const;
export const POR_PAGINA = 25;

export interface FiltrosLeads {
  status?: (typeof ETAPAS)[number];
  criativo?: string;
  campanha?: string;
  versao?: (typeof VERSOES)[number];
  de?: string;
  ate?: string;
  /** id do usuário responsável, ou "sem". */
  responsavel?: string;
  q?: string;
  visao?: Visao;
  ordem: Ordem;
  dir: "asc" | "desc";
  pagina: number;
}

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)));
const texto = (max: number) => z.string().trim().min(1).max(max);

const campos = {
  status: z.enum(ETAPAS),
  criativo: texto(200),
  campanha: texto(200),
  versao: z.enum(VERSOES),
  de: data,
  ate: data,
  responsavel: z.union([z.literal("sem"), z.uuid()]),
  q: texto(100),
  visao: z.enum(VISOES),
  ordem: z.enum(ORDENS),
  dir: z.enum(["asc", "desc"]),
  pagina: z.coerce.number().int().min(1).max(100_000),
};

type Entrada = Record<string, string | string[] | undefined> | URLSearchParams;

function valor(entrada: Entrada, chave: string): string | undefined {
  const v = entrada instanceof URLSearchParams ? (entrada.get(chave) ?? undefined) : entrada[chave];
  return Array.isArray(v) ? v[0] : v;
}

/** Visões e filtros que dependem do papel ("Sem responsável" e o filtro de responsável). */
export function podeFiltrarResponsavel(papel: Papel): boolean {
  return papel === "admin" || papel === "suporte";
}

export function lerFiltros(entrada: Entrada, papel: Papel): FiltrosLeads {
  const lido: Record<string, unknown> = {};
  for (const [chave, esquema] of Object.entries(campos)) {
    const bruto = valor(entrada, chave);
    if (bruto === undefined || bruto === "") continue;
    const r = esquema.safeParse(bruto);
    if (r.success) lido[chave] = r.data;
  }
  if (!podeFiltrarResponsavel(papel)) delete lido.responsavel;
  if (lido.visao && !podeVerVisao(lido.visao as Visao, papel)) delete lido.visao;

  const visao = lido.visao as Visao | undefined;
  // "Sem responsável": cadastros mais recentes primeiro; "para fechar": agendamento mais antigo primeiro.
  const ordemPadrao: Ordem =
    visao === "parados" ? "parado" : visao === "agendados_semana" ? "reuniao" : visao === "para_fechar" ? "agendamento" : "cadastro";
  const dirPadrao = visao === "parados" || visao === "agendados_semana" || visao === "para_fechar" ? "asc" : "desc";
  return {
    ...(lido as Partial<FiltrosLeads>),
    ordem: (lido.ordem as Ordem) ?? ordemPadrao,
    dir: (lido.dir as "asc" | "desc") ?? (lido.ordem ? "asc" : dirPadrao),
    pagina: (lido.pagina as number) ?? 1,
  };
}

/** Monta a query string da lista mudando só o que vier em `mudar`. */
export function urlDaLista(filtros: FiltrosLeads, mudar: Partial<Record<keyof FiltrosLeads, string | number | undefined>>): string {
  const p = new URLSearchParams();
  const todos = { ...filtros, ...mudar } as Record<string, unknown>;
  for (const chave of [...Object.keys(campos)]) {
    const v = todos[chave];
    if (v === undefined || v === "" || (chave === "pagina" && v === 1)) continue;
    p.set(chave, String(v));
  }
  const qs = p.toString();
  return qs ? `/leads?${qs}` : "/leads";
}
