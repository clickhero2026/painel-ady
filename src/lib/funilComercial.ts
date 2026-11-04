import {
  ETAPA_INICIAL,
  ETAPA_PERDIDO,
  ETAPAS_COMERCIAIS,
  LINHA_DO_FUNIL,
  MOTIVOS_DE_PERDA,
  rotuloMotivo,
  type EtapaComercial,
} from "@/config/pipeline";
import { pool } from "./db";
import { rotuloEtapa } from "./etapas";
import { AMOSTRA_MINIMA, type FiltrosFunil } from "./filtrosFunil";
import { CAMPAIGN, condicoes, mascararOrigem, MEDIUM, MINIMO_LEITURA, SOURCE, taxa } from "./funil";
import { NOME_RESPONSAVEL } from "./leads";
import type { Papel } from "./papeis";
import { celulasOcultas, completarOcultas } from "./perfil";
import { Parametros } from "./sql";

/**
 * Funil comercial (bloco da tela Funil e GET /api/funil/comercial). Mesmos
 * cortes e mesma coorte do funil: `condicoes` de funil.ts (período pela
 * data do CADASTRO, criativo, campanha, origem, mídia, versão; sem os
 * cadastros mesclados em outro), mas COM os leads cadastrados à mão no
 * painel (`condicoes(..., "incluir")`): eles são trabalho comercial, só não
 * entram nos indicadores de marketing. Por isso o total daqui pode passar
 * dos cadastros do funil. Só agregados; nenhum dado pessoal sai daqui.
 *
 * Definições:
 *   - Etapa atual: painel_lead_etapa; sem registro = "não contatado".
 *   - Chegou a pelo menos a etapa X: a maior etapa da linha (não contatado
 *     → fechado) que o lead já teve, hoje ou no histórico (de ou para).
 *     Quem pulou etapas conta como tendo chegado às anteriores; perdido
 *     fica fora da linha (quem foi perdido em Negociação chegou a
 *     Negociação).
 *   - Taxa de passagem: chegaram à etapa seguinte / chegaram a esta.
 *   - Tempo em cada etapa: do histórico. Cada mudança fecha um período na
 *     etapa de origem (do cadastro, ou da mudança anterior, até a mudança).
 *     Período ainda aberto (a etapa de hoje) não entra.
 *   - Perdidos: quem está hoje em "negócio perdido"; o motivo é o de hoje;
 *     "em que etapa estavam" = etapa de origem da última mudança para perdido.
 *
 * Papel "leitura": células de 1 a 4 leads ocultas (null) AQUI, no servidor,
 * com a proteção contra subtração do perfil (celulasOcultas). Cortes por
 * responsável só para admin e suporte.
 */

const POS = (expr: string) =>
  `(array_position(ARRAY[${LINHA_DO_FUNIL.map((e) => `'${e}'`).join(",")}]::text[], ${expr}) - 1)`;
const ETAPA = `coalesce(e.etapa, '${ETAPA_INICIAL}')`;

export function podeVerCorteResponsavel(papel: Papel): boolean {
  return papel === "admin" || papel === "suporte";
}

// ── Tipos do resultado (null = oculto para o papel, ou sem dado) ──

export interface EtapaAtual {
  etapa: EtapaComercial;
  leads: number | null;
}

export interface Chegada {
  etapa: EtapaComercial;
  leads: number | null;
  /** Chegaram à próxima etapa da linha / chegaram a esta. Última etapa: null. */
  passagem: number | null;
}

export interface TempoNaEtapa {
  etapa: EtapaComercial;
  /** Períodos encerrados nesta etapa (mudanças a partir dela). */
  passagens: number | null;
  /** Segundos; null sem período ou oculto. */
  mediana: number | null;
}

export interface LinhaDoCorte {
  grupo: string;
  leads: number;
  reuniao: number | null;
  negociacao: number | null;
  fechados: number | null;
  perdidos: number | null;
  taxaFechamento: number | null;
  amostraPequena: boolean;
}

export interface CorteComercial {
  linhas: LinhaDoCorte[];
  /** Só "leitura": soma das linhas ocultas. */
  outras: Omit<LinhaDoCorte, "grupo" | "amostraPequena" | "leads"> & { leads: number | null } | null;
}

export interface FunilComercial {
  total: number | null;
  amostraPequena: boolean;
  /** Células abaixo disto foram ocultadas; null = nada oculto. */
  ocultaAbaixoDe: number | null;
  atual: EtapaAtual[];
  chegaram: Chegada[];
  tempos: TempoNaEtapa[];
  perdidos: {
    total: number | null;
    porMotivo: { motivo: string; rotulo: string; leads: number | null }[];
    porEtapa: { etapa: EtapaComercial; leads: number | null }[];
  };
  cortes: {
    origem: CorteComercial;
    situacao: CorteComercial;
    /** Só admin e suporte. */
    responsavel?: CorteComercial;
  };
}

// ── Consultas ──

interface Grupo {
  etapa: EtapaComercial;
  nivel: number;
  motivo: string | null;
  perdido_de: EtapaComercial | null;
  source: string;
  medium: string;
  campaign: string;
  status: string;
  responsavel: string | null;
  n: number;
}

async function grupos(f: FiltrosFunil): Promise<Grupo[]> {
  const p = new Parametros();
  const { rows } = await pool().query<Grupo>(
    `WITH base AS (
       SELECT ${ETAPA} AS etapa,
              coalesce(greatest(${POS(ETAPA)},
                (SELECT max(greatest(${POS("h.etapa_de")}, ${POS("h.etapa_para")}))
                   FROM painel_lead_etapa_historico h WHERE h.lead_id = i.id)), 0) AS nivel,
              e.motivo_perda AS motivo,
              CASE WHEN e.etapa = '${ETAPA_PERDIDO}' THEN
                (SELECT h.etapa_de FROM painel_lead_etapa_historico h
                  WHERE h.lead_id = i.id AND h.etapa_para = '${ETAPA_PERDIDO}'
                  ORDER BY h.criado_em DESC, h.id DESC LIMIT 1) END AS perdido_de,
              ${SOURCE} AS source, ${MEDIUM} AS medium, ${CAMPAIGN} AS campaign, i.status,
              ${NOME_RESPONSAVEL} AS responsavel
         FROM teste7d_inscricoes i
         LEFT JOIN painel_lead_etapa e ON e.lead_id = i.id
         LEFT JOIN painel_lead_responsavel r ON r.lead_id = i.id
         LEFT JOIN painel_usuarios ru ON ru.id = r.usuario_id
        WHERE ${condicoes(f, p, "incluir")}
     )
     SELECT etapa, nivel, motivo, perdido_de, source, medium, campaign, status, responsavel, count(*)::int AS n
       FROM base
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`,
    p.valores,
  );
  return rows;
}

async function tempos(f: FiltrosFunil): Promise<{ etapa: EtapaComercial; n: number; mediana: number }[]> {
  const p = new Parametros();
  const { rows } = await pool().query<{ etapa: EtapaComercial; n: number; mediana: number }>(
    `WITH escopo AS (SELECT i.id, i.created_at FROM teste7d_inscricoes i WHERE ${condicoes(f, p, "incluir")}),
     periodos AS (
       SELECT h.etapa_de AS etapa,
              extract(epoch FROM h.criado_em - coalesce(
                lag(h.criado_em) OVER (PARTITION BY h.lead_id ORDER BY h.criado_em, h.id), s.created_at))::float8 AS segundos
         FROM painel_lead_etapa_historico h
         JOIN escopo s ON s.id = h.lead_id
     )
     SELECT etapa, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(segundos, 0)) AS mediana
       FROM periodos GROUP BY etapa`,
    p.valores,
  );
  return rows;
}

// ── Proteção ──

const pequeno = (n: number, minimo: number) => n > 0 && n < minimo;

/**
 * Totais acumulados ("chegaram a pelo menos"): cada valor mostrado e cada
 * diferença entre dois valores mostrados vizinhos tem de ser 0 ou >= mínimo
 * (a diferença é quanta gente parou entre as duas etapas).
 */
export function acumuladosProtegidos(acumulados: number[], minimo: number, primeiroVisivel: boolean): (number | null)[] {
  if (minimo === 0) return acumulados;
  const saida: (number | null)[] = acumulados.map(() => null);
  if (!primeiroVisivel) return saida;
  saida[0] = acumulados[0];
  let ultimo = 0;
  for (let k = 1; k < acumulados.length; k++) {
    if (!pequeno(acumulados[k], minimo) && !pequeno(acumulados[ultimo] - acumulados[k], minimo)) {
      saida[k] = acumulados[k];
      ultimo = k;
    }
  }
  return saida;
}

/** Partição que soma `total`: oculta as células pequenas (e o necessário contra a subtração). */
function particao(valores: number[], totalVisivel: boolean, minimo: number): (number | null)[] {
  if (!totalVisivel) return valores.map(() => null);
  const oculta = celulasOcultas(valores, minimo);
  return valores.map((v, k) => (oculta[k] ? null : v));
}

type Colunas = "reuniao" | "negociacao" | "fechados" | "perdidos";
const COLUNAS: Colunas[] = ["reuniao", "negociacao", "fechados", "perdidos"];

interface LinhaBruta {
  grupo: string;
  leads: number;
  reuniao: number;
  negociacao: number;
  fechados: number;
  perdidos: number;
}

/** Igual ao bloco de origem: linhas pequenas viram "outras"; dentro das linhas, colunas protegidas por complemento. */
function protegerCorte(brutas: LinhaBruta[], minimo: number): CorteComercial {
  const ordenadas = [...brutas].sort((a, b) => b.leads - a.leads || a.grupo.localeCompare(b.grupo, "pt-BR"));
  const comTaxa = (l: Omit<LinhaDoCorte, "taxaFechamento" | "amostraPequena">): LinhaDoCorte => ({
    ...l,
    taxaFechamento: taxa(l.fechados, l.leads),
    amostraPequena: l.leads < AMOSTRA_MINIMA,
  });
  if (minimo === 0) return { linhas: ordenadas.map(comTaxa), outras: null };

  const ocultas = celulasOcultas(
    ordenadas.map((l) => l.leads),
    minimo,
  );
  const visiveis = ordenadas.filter((_, k) => !ocultas[k]);
  const resto = ordenadas.filter((_, k) => ocultas[k]);
  const soma = (c: keyof Omit<LinhaBruta, "grupo">) => resto.reduce((s, l) => s + l[c], 0);
  const partes: LinhaBruta[] = resto.length
    ? [...visiveis, { grupo: "", leads: soma("leads"), reuniao: soma("reuniao"), negociacao: soma("negociacao"), fechados: soma("fechados"), perdidos: soma("perdidos") }]
    : visiveis;

  const ocultasPorColuna = Object.fromEntries(
    COLUNAS.map((c) => [
      c,
      completarOcultas(
        partes.map((l) => l[c]),
        partes.map((l) => pequeno(l[c], minimo) || pequeno(l.leads - l[c], minimo)),
        minimo,
      ),
    ]),
  ) as Record<Colunas, boolean[]>;
  const protegidas = partes.map((l, k) => ({
    ...l,
    ...Object.fromEntries(COLUNAS.map((c) => [c, ocultasPorColuna[c][k] ? null : l[c]])),
  })) as (Omit<LinhaBruta, Colunas> & Record<Colunas, number | null>)[];

  const linhas = (resto.length ? protegidas.slice(0, -1) : protegidas).map(comTaxa);
  const ultima = protegidas.at(-1);
  return {
    linhas,
    outras:
      resto.length && ultima
        ? {
            leads: ultima.leads >= minimo ? ultima.leads : null,
            reuniao: ultima.reuniao,
            negociacao: ultima.negociacao,
            fechados: ultima.fechados,
            perdidos: ultima.perdidos,
            taxaFechamento: ultima.leads >= minimo ? taxa(ultima.fechados, ultima.leads) : null,
          }
        : null,
  };
}

const NIVEL_REUNIAO = LINHA_DO_FUNIL.indexOf("reuniao_marcada");
const NIVEL_NEGOCIACAO = LINHA_DO_FUNIL.indexOf("negociacao");
const NIVEL_FECHADO = LINHA_DO_FUNIL.indexOf("negocio_fechado");

function agruparCorte(linhas: Grupo[], chave: (g: Grupo) => string): LinhaBruta[] {
  const mapa = new Map<string, LinhaBruta>();
  for (const g of linhas) {
    const grupo = chave(g);
    const l = mapa.get(grupo) ?? { grupo, leads: 0, reuniao: 0, negociacao: 0, fechados: 0, perdidos: 0 };
    l.leads += g.n;
    if (g.nivel >= NIVEL_REUNIAO) l.reuniao += g.n;
    if (g.nivel >= NIVEL_NEGOCIACAO) l.negociacao += g.n;
    if (g.nivel >= NIVEL_FECHADO) l.fechados += g.n;
    if (g.etapa === ETAPA_PERDIDO) l.perdidos += g.n;
    mapa.set(grupo, l);
  }
  return [...mapa.values()];
}

// ── Entrada única ──

export async function funilComercial(f: FiltrosFunil, papel: Papel): Promise<FunilComercial> {
  const minimo = papel === "leitura" ? MINIMO_LEITURA : 0;
  const [linhas, periodos] = await Promise.all([grupos(f), tempos(f)]);

  const soma = (filtro: (g: Grupo) => boolean) => linhas.reduce((s, g) => s + (filtro(g) ? g.n : 0), 0);
  const total = soma(() => true);
  const totalVisivel = total === 0 || total >= minimo;

  // Etapa de hoje (partição do total).
  const atuais = ETAPAS_COMERCIAIS.map((e) => soma((g) => g.etapa === e));
  const atualProtegido = particao(atuais, totalVisivel, minimo);

  // Chegaram a pelo menos cada etapa da linha.
  const acumulados = LINHA_DO_FUNIL.map((_, k) => soma((g) => g.nivel >= k));
  const chegaram = acumuladosProtegidos(acumulados, minimo, totalVisivel);

  // Perdidos (a quantidade é a mesma célula de "perdido" na etapa de hoje).
  const kPerdido = ETAPAS_COMERCIAIS.indexOf(ETAPA_PERDIDO);
  const totalPerdidos = atuais[kPerdido];
  const perdidosVisivel = atualProtegido[kPerdido] !== null;
  const perdidos = linhas.filter((g) => g.etapa === ETAPA_PERDIDO);
  const chavesMotivo = [
    ...MOTIVOS_DE_PERDA.map((m) => m.chave),
    ...[...new Set(perdidos.map((g) => g.motivo ?? ""))].filter((m) => !MOTIVOS_DE_PERDA.some((x) => x.chave === m)).sort(),
  ];
  const porMotivo = chavesMotivo.map((m) => perdidos.reduce((s, g) => s + ((g.motivo ?? "") === m ? g.n : 0), 0));
  const porMotivoProtegido = particao(porMotivo, perdidosVisivel, minimo);
  const etapasDePerda = ETAPAS_COMERCIAIS.filter((e) => e !== ETAPA_PERDIDO);
  const porEtapa = etapasDePerda.map((e) => perdidos.reduce((s, g) => s + (g.perdido_de === e ? g.n : 0), 0));
  const porEtapaProtegido = particao(porEtapa, perdidosVisivel, minimo);

  const temposPorEtapa = new Map(periodos.map((t) => [t.etapa, t]));

  const cortes: FunilComercial["cortes"] = {
    origem: protegerCorte(
      agruparCorte(linhas, (g) => [g.source, g.medium, g.campaign].map(mascararOrigem).join(" / ")),
      minimo,
    ),
    situacao: protegerCorte(
      agruparCorte(linhas, (g) => rotuloEtapa(g.status)),
      minimo,
    ),
  };
  if (podeVerCorteResponsavel(papel)) {
    cortes.responsavel = protegerCorte(
      agruparCorte(linhas, (g) => g.responsavel ?? "Sem responsável"),
      minimo,
    );
  }

  return {
    total: totalVisivel ? total : null,
    amostraPequena: total < AMOSTRA_MINIMA,
    ocultaAbaixoDe: minimo > 0 ? minimo : null,
    atual: ETAPAS_COMERCIAIS.map((etapa, k) => ({ etapa, leads: atualProtegido[k] })),
    chegaram: LINHA_DO_FUNIL.map((etapa, k) => ({
      etapa,
      leads: chegaram[k],
      passagem: k + 1 < LINHA_DO_FUNIL.length ? taxa(chegaram[k + 1], chegaram[k]) : null,
    })),
    tempos: ETAPAS_COMERCIAIS.map((etapa) => {
      const t = temposPorEtapa.get(etapa);
      const oculto = !t || pequeno(t.n, minimo);
      return { etapa, passagens: t ? (oculto ? null : t.n) : 0, mediana: oculto ? null : t.mediana };
    }),
    perdidos: {
      total: perdidosVisivel ? totalPerdidos : null,
      porMotivo: chavesMotivo.map((motivo, k) => ({ motivo, rotulo: rotuloMotivo(motivo) ?? "(sem motivo)", leads: porMotivoProtegido[k] })),
      porEtapa: etapasDePerda.map((etapa, k) => ({ etapa, leads: porEtapaProtegido[k] })),
    },
    cortes,
  };
}
