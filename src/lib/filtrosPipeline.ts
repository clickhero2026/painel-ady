import * as z from "zod";
import { ETAPAS_COMERCIAIS, CARTOES_POR_COLUNA, type EtapaComercial } from "@/config/pipeline";
import type { Papel } from "./papeis";

/**
 * Filtros, modo (quadro ou lista), ordem e página da tela de pipeline,
 * lidos da URL. Valor inválido é descartado. Arquivo puro (sem banco).
 */

export const MODOS = ["quadro", "lista"] as const;
export type ModoPipeline = (typeof MODOS)[number];

export const ORDENS_PIPELINE = ["nome", "etapa", "na_etapa", "cadastro", "responsavel", "origem"] as const;
export type OrdemPipeline = (typeof ORDENS_PIPELINE)[number];

export const POR_PAGINA_PIPELINE = 50;
/** Teto do "ver mais" por coluna (evita página gigante). */
export const MAX_CARTOES = 1000;

export interface FiltrosPipeline {
  modo: ModoPipeline;
  /** Só lista: etapa comercial. */
  etapa?: EtapaComercial;
  /** Admin e suporte: id do responsável, ou "sem". */
  responsavel?: string;
  /** Origem normalizada (utm_source), igual à do funil. */
  origem?: string;
  /** Campanha normalizada (utm_campaign), igual à do funil. */
  campanha?: string;
  /** Período do cadastro (datas de São Paulo, inclusivas). */
  de?: string;
  ate?: string;
  q?: string;
  /** Fechado e Perdido: true = tudo; false = só os últimos 30 dias (padrão). */
  tudo: boolean;
  /** Quadro: cartões por coluna (passo de 50). */
  limites: Record<EtapaComercial, number>;
  ordem: OrdemPipeline;
  dir: "asc" | "desc";
  pagina: number;
}

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)));
const texto = (max: number) => z.string().trim().min(1).max(max);

const campos = {
  modo: z.enum(MODOS),
  etapa: z.enum(ETAPAS_COMERCIAIS),
  responsavel: z.union([z.literal("sem"), z.uuid()]),
  origem: texto(255),
  campanha: texto(255),
  de: data,
  ate: data,
  q: texto(100),
  tudo: z.literal("1"),
  ordem: z.enum(ORDENS_PIPELINE),
  dir: z.enum(["asc", "desc"]),
  pagina: z.coerce.number().int().min(1).max(100_000),
};

const limite = z.coerce.number().int().min(CARTOES_POR_COLUNA).max(MAX_CARTOES);

type Entrada = Record<string, string | string[] | undefined> | URLSearchParams;

function valor(entrada: Entrada, chave: string): string | undefined {
  const v = entrada instanceof URLSearchParams ? (entrada.get(chave) ?? undefined) : entrada[chave];
  return Array.isArray(v) ? v[0] : v;
}

/** Quem filtra por responsável (vendas só vê os seus). */
export function podeFiltrarResponsavelNoPipeline(papel: Papel): boolean {
  return papel === "admin" || papel === "suporte";
}

export function lerFiltrosPipeline(entrada: Entrada, papel: Papel): FiltrosPipeline {
  const lido: Record<string, unknown> = {};
  for (const [chave, esquema] of Object.entries(campos)) {
    const bruto = valor(entrada, chave);
    if (bruto === undefined || bruto === "") continue;
    const r = esquema.safeParse(bruto);
    if (r.success) lido[chave] = r.data;
  }
  if (!podeFiltrarResponsavelNoPipeline(papel)) delete lido.responsavel;

  let { de, ate } = lido as { de?: string; ate?: string };
  if (de && ate && de > ate) [de, ate] = [ate, de];

  const limites = Object.fromEntries(
    ETAPAS_COMERCIAIS.map((e) => {
      const r = limite.safeParse(valor(entrada, `n_${e}`));
      // Arredonda pro passo de 50 (o "ver mais" soma 50).
      return [e, r.success ? Math.ceil(r.data / CARTOES_POR_COLUNA) * CARTOES_POR_COLUNA : CARTOES_POR_COLUNA];
    }),
  ) as Record<EtapaComercial, number>;

  const ordem = (lido.ordem as OrdemPipeline) ?? "na_etapa";
  return {
    modo: (lido.modo as ModoPipeline) ?? "quadro",
    etapa: lido.etapa as EtapaComercial | undefined,
    responsavel: lido.responsavel as string | undefined,
    origem: lido.origem as string | undefined,
    campanha: lido.campanha as string | undefined,
    de,
    ate,
    q: lido.q as string | undefined,
    tudo: lido.tudo === "1",
    limites,
    ordem,
    // Padrão: há mais tempo na etapa primeiro.
    dir: (lido.dir as "asc" | "desc") ?? "asc",
    pagina: (lido.pagina as number) ?? 1,
  };
}

type Mudar = Partial<Record<keyof FiltrosPipeline | `n_${EtapaComercial}`, string | number | boolean | undefined>>;

/** Query string do pipeline mudando só o que vier em `mudar`. */
export function urlDoPipeline(f: FiltrosPipeline, mudar: Mudar = {}): string {
  const todos = { ...f, ...mudar } as Record<string, unknown>;
  const p = new URLSearchParams();
  for (const chave of Object.keys(campos)) {
    const v = todos[chave];
    if (v === undefined || v === "" || v === false) continue;
    if (chave === "modo" && v === "quadro") continue;
    if (chave === "tudo") {
      p.set("tudo", "1");
      continue;
    }
    if (chave === "pagina" && Number(v) === 1) continue;
    if (chave === "ordem" && v === "na_etapa" && todos.dir === "asc") continue;
    if (chave === "dir" && v === "asc" && todos.ordem === "na_etapa") continue;
    p.set(chave, String(v));
  }
  // Os limites do quadro só valem no modo quadro.
  if (todos.modo !== "lista") {
    for (const e of ETAPAS_COMERCIAIS) {
      const n = (mudar as Record<string, unknown>)[`n_${e}`] ?? f.limites[e];
      if (Number(n) > CARTOES_POR_COLUNA) p.set(`n_${e}`, String(n));
    }
  }
  const qs = p.toString();
  return qs ? `/pipeline?${qs}` : "/pipeline";
}
