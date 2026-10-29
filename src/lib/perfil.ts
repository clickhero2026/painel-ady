import { pool } from "./db";
import type { FiltrosFunil } from "./filtrosFunil";
import { AGENDOU, ATIVOU, condicoes, TELAS_DA_ATIVACAO } from "./funil";
import type { Papel } from "./papeis";
import { MAPAS_DE_RESPOSTA, type CampoDeResposta } from "./respostas";
import { Parametros } from "./sql";

/**
 * Consultas do perfil estatístico dos leads. Usa os mesmos cortes e as
 * mesmas definições do funil (funil.ts): cadastro no período (coorte, fuso
 * de São Paulo), ativação completa = etapa2_concluida_em, agendou =
 * agendado_em. Não usa reunião realizada (nenhum fluxo grava hoje).
 *
 * Só agregados. O texto livre (cidade e negócio) é lido do banco para
 * contar termos, mas só sai daqui o termo normalizado que se repete
 * (2+ pessoas; 5+ para "leitura"); o resto vira "outros".
 *
 * Papel "leitura": toda célula de 1 a 4 pessoas é ocultada AQUI (null), e
 * não só na tela. Ver `celulasOcultas`.
 */

// ── Perguntas ──

export type CampoDoPerfil = CampoDeResposta | "atende_todo_brasil";

/** A opção de "todo o Brasil" fica na tela de cidade: respondeu = respondeu essa tela. */
export const ATENDE_TODO_BRASIL = {
  sim: "Atende todo o Brasil / vende pela internet",
  cidade: "Informou cidade ou bairro (não marcou todo o Brasil)",
} as const;

const MAPAS: Record<CampoDoPerfil, Record<string, string>> = { ...MAPAS_DE_RESPOSTA, atende_todo_brasil: ATENDE_TODO_BRASIL };

const telaDe = (id: string) => TELAS_DA_ATIVACAO.find((t) => t.id === id)!;

/** Ordem da ativação; título da tela de lá. `valor`: a chave gravada, ou null = não respondeu. */
const PERGUNTAS: readonly { campo: CampoDoPerfil; pergunta: string; valor: string }[] = [
  {
    campo: "atende_todo_brasil",
    pergunta: "Atende todo o Brasil?",
    valor: `CASE WHEN i.atende_todo_brasil IS TRUE THEN 'sim' WHEN ${telaDe("cidade").respondida} THEN 'cidade' END`,
  },
  ...(
    [
      ["acao_desejada", "acao"],
      ["experiencia_anuncios", "experiencia"],
      ["acesso_redes", "acesso"],
      ["conta_anuncios", "conta"],
      ["cartao_pagamento", "cartao"],
      ["arquivo_logo", "logo"],
      ["reuniao_computador", "reuniao"],
    ] as const
  ).map(([campo, tela]) => ({ campo, pergunta: telaDe(tela).pergunta, valor: `nullif(btrim(i.${campo}), '')` })),
];

export const CAMPOS_DO_PERFIL = PERGUNTAS.map((p) => p.campo);

const TEXTOS_LIVRES = [
  { campo: "cidade_bairro", titulo: "Cidade e bairro" },
  { campo: "negocio_nome_oferta", titulo: "Negócio e o que vende" },
] as const;

/** Abaixo disto (em cada grupo), a comparação é marcada como amostra pequena. */
export const AMOSTRA_MINIMA_GRUPO = 30;
/** Diferença destacada na comparação (só com amostra suficiente nos dois grupos). */
export const DIFERENCA_RELEVANTE = 0.1;
/** Papel "leitura": células com menos pessoas que isto ficam ocultas. */
export const MINIMO_LEITURA = 5;
/** Termo de texto livre só aparece com pelo menos tantas pessoas (os demais vão para "outros"). */
export const MINIMO_TERMO = 2;
export const TERMOS_NO_TOPO = 20;

export function minimoDoPapel(papel: Papel): number {
  return papel === "leitura" ? MINIMO_LEITURA : 0;
}

// ── Tipos do resultado (null = oculto para o papel) ──

export interface Celula {
  pessoas: number | null;
  /** Fração sobre quem respondeu (no grupo). */
  percentual: number | null;
}

export interface OpcaoDoPerfil extends Celula {
  chave: string;
  texto: string;
  /** Chave gravada que não existe no mapa (mostrada crua). */
  semMapa: boolean;
}

export interface Grupo {
  /** Pessoas no grupo (o total de que as células saem). */
  total: number | null;
  respondidos: number | null;
  naoResponderam: number | null;
}

export interface LinhaDaComparacao {
  chave: string;
  texto: string;
  semMapa: boolean;
  agendou: Celula;
  naoAgendou: Celula;
  /** Agendou menos não agendou, em fração (0,12 = 12 pontos percentuais). */
  diferenca: number | null;
  destaque: boolean;
}

export interface PerguntaDoPerfil {
  campo: CampoDoPerfil;
  pergunta: string;
  distribuicao: Grupo & { opcoes: OpcaoDoPerfil[] };
  comparacao: {
    agendou: Grupo;
    naoAgendou: Grupo;
    /** Algum dos dois grupos com menos de AMOSTRA_MINIMA_GRUPO respostas. */
    amostraPequena: boolean;
    linhas: LinhaDaComparacao[];
  };
}

export interface TermosDoPerfil {
  campo: (typeof TEXTOS_LIVRES)[number]["campo"];
  titulo: string;
  respondidos: number | null;
  naoResponderam: number | null;
  termos: { termo: string; pessoas: number }[];
  /** Pessoas cujo termo não aparece na lista (único, pouco frequente ou fora do topo). */
  outros: number | null;
  /** Mínimo de pessoas para um termo aparecer, para este papel. */
  minimoPorTermo: number;
}

export interface PerfilDosLeads {
  cadastros: number | null;
  completaram: number | null;
  agendaram: number | null;
  naoAgendaram: number | null;
  /** Células abaixo disto foram ocultadas (papel "leitura"); null = nada oculto. */
  ocultaAbaixoDe: number | null;
  perguntas: PerguntaDoPerfil[];
  termos: TermosDoPerfil[];
}

// ── Ocultação de células pequenas ──

/**
 * Quais células de uma partição (células que somam um total conhecido)
 * ocultar: as de 1 a `minimo - 1` pessoas e, enquanto o que ficou oculto
 * somar de 1 a `minimo - 1` (daria para descobrir pela diferença do
 * total), também a menor célula visível. Zero não é ocultado (não
 * identifica ninguém). Com `minimo` 0, nada fica oculto.
 */
export function celulasOcultas(celulas: number[], minimo: number): boolean[] {
  const oculta = celulas.map((n) => n > 0 && n < minimo);
  const somaOculta = () => celulas.reduce((s, n, k) => s + (oculta[k] ? n : 0), 0);
  while (somaOculta() > 0 && somaOculta() < minimo) {
    let menor = -1;
    celulas.forEach((n, k) => {
      if (!oculta[k] && n > 0 && (menor < 0 || n < celulas[menor])) menor = k;
    });
    if (menor < 0) break;
    oculta[menor] = true;
  }
  return oculta;
}

// ── Normalização dos termos ──

/** Minúsculas, sem acentos, pontuação vira espaço, espaços colapsados. */
export function normalizarTermo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ── Consultas ──

interface Contagem {
  campo: string;
  valor: string | null;
  cadastros: number;
  agendou: number;
  nao_agendou: number;
}

async function contagens(f: FiltrosFunil): Promise<Contagem[]> {
  const p = new Parametros();
  const valores = PERGUNTAS.map((q) => `('${q.campo}', ${q.valor})`).join(",\n             ");
  const { rows } = await pool().query<Contagem>(
    `SELECT r.campo, r.valor, count(*)::int AS cadastros,
            (count(*) FILTER (WHERE ${ATIVOU} AND ${AGENDOU}))::int AS agendou,
            (count(*) FILTER (WHERE ${ATIVOU} AND NOT (${AGENDOU})))::int AS nao_agendou
       FROM teste7d_inscricoes i
      CROSS JOIN LATERAL (VALUES ${valores}) AS r(campo, valor)
      WHERE ${condicoes(f, p)}
      GROUP BY 1, 2`,
    p.valores,
  );
  return rows;
}

async function textosLivres(f: FiltrosFunil): Promise<{ campo: string; texto: string; n: number }[]> {
  const p = new Parametros();
  const valores = TEXTOS_LIVRES.map((t) => `('${t.campo}', nullif(btrim(i.${t.campo}), ''))`).join(", ");
  const { rows } = await pool().query<{ campo: string; texto: string; n: number }>(
    `SELECT r.campo, r.texto, count(*)::int AS n
       FROM teste7d_inscricoes i
      CROSS JOIN LATERAL (VALUES ${valores}) AS r(campo, texto)
      WHERE ${condicoes(f, p)} AND r.texto IS NOT NULL
      GROUP BY 1, 2`,
    p.valores,
  );
  return rows;
}

// ── Montagem ──

const somar = (linhas: Contagem[], coluna: "cadastros" | "agendou" | "nao_agendou") =>
  linhas.reduce((s, l) => s + l[coluna], 0);

/** Opções de uma pergunta: as do mapa, na ordem dele, e depois as chaves sem mapa (mais frequentes primeiro). */
function opcoesDe(campo: CampoDoPerfil, linhas: Contagem[]) {
  const mapa = MAPAS[campo];
  const semMapa = linhas
    .filter((l) => l.valor !== null && !Object.hasOwn(mapa, l.valor))
    .sort((a, b) => b.cadastros - a.cadastros || a.valor!.localeCompare(b.valor!))
    .map((l) => l.valor!);
  return [...Object.keys(mapa), ...semMapa].map((chave) =>
    Object.hasOwn(mapa, chave) ? { chave, texto: mapa[chave], semMapa: false } : { chave, texto: chave, semMapa: true },
  );
}

/**
 * Um grupo (todos, agendou ou não agendou): células por opção mais "não
 * respondeu", que somam o total do grupo. `visivel` = o total do grupo
 * pode aparecer.
 */
function grupo(contas: Map<string | null, number>, chaves: string[], total: number, visivel: boolean, minimo: number) {
  const pessoas = chaves.map((c) => contas.get(c) ?? 0);
  const nao = contas.get(null) ?? 0;
  const respondidos = total - nao;
  const oculta = visivel ? celulasOcultas([...pessoas, nao], minimo) : [...pessoas, nao].map(() => true);
  // "Responderam" só aparece se "não responderam" aparece (um sai do outro pelo total).
  const naoOculto = oculta.at(-1)!;
  return {
    resumo: {
      total: visivel ? total : null,
      respondidos: naoOculto ? null : respondidos,
      naoResponderam: naoOculto ? null : nao,
    } satisfies Grupo,
    respondidosBrutos: respondidos,
    celulas: pessoas.map(
      (n, k): Celula => ({
        pessoas: oculta[k] ? null : n,
        percentual: oculta[k] || naoOculto || respondidos === 0 ? null : n / respondidos,
      }),
    ),
  };
}

function termos(
  campo: TermosDoPerfil["campo"],
  titulo: string,
  textos: { texto: string; n: number }[],
  cadastros: number,
  visivel: boolean,
  minimo: number,
): TermosDoPerfil {
  // Resposta só de pontuação não vira termo (conta em "outros").
  const contas = new Map<string, number>();
  for (const { texto, n } of textos) {
    const termo = normalizarTermo(texto);
    if (termo) contas.set(termo, (contas.get(termo) ?? 0) + n);
  }
  const respondidos = textos.reduce((s, t) => s + t.n, 0);
  const nao = cadastros - respondidos;
  const minimoPorTermo = Math.max(MINIMO_TERMO, minimo);
  const lista = [...contas]
    .map(([termo, pessoas]) => ({ termo, pessoas }))
    .filter((t) => t.pessoas >= minimoPorTermo)
    .sort((a, b) => b.pessoas - a.pessoas || a.termo.localeCompare(b.termo, "pt-BR"))
    .slice(0, TERMOS_NO_TOPO);

  // "Leitura": o que a diferença deixaria descobrir vai também para "outros".
  let oculta: boolean[];
  for (;;) {
    const outros = respondidos - lista.reduce((s, t) => s + t.pessoas, 0);
    oculta = visivel ? celulasOcultas([...lista.map((t) => t.pessoas), outros, nao], minimo) : lista.map(() => true).concat(true, true);
    const k = oculta.slice(0, lista.length).lastIndexOf(true);
    if (k < 0 || !visivel) break;
    lista.splice(k, 1);
  }
  const outros = respondidos - lista.reduce((s, t) => s + t.pessoas, 0);
  const [outrosOculto, naoOculto] = oculta.slice(-2);
  return {
    campo,
    titulo,
    respondidos: naoOculto ? null : respondidos,
    naoResponderam: naoOculto ? null : nao,
    termos: visivel ? lista : [],
    outros: outrosOculto ? null : outros,
    minimoPorTermo,
  };
}

/** Perfil do recorte, já com as células ocultas para o papel. */
export async function perfilDosLeads(f: FiltrosFunil, papel: Papel): Promise<PerfilDosLeads> {
  const minimo = minimoDoPapel(papel);
  const [linhas, textos] = await Promise.all([contagens(f), textosLivres(f)]);

  // Totais (iguais em qualquer pergunta: cada cadastro aparece uma vez por pergunta).
  const umaPergunta = linhas.filter((l) => l.campo === PERGUNTAS[0].campo);
  const cadastros = somar(umaPergunta, "cadastros");
  const agendaram = somar(umaPergunta, "agendou");
  const naoAgendaram = somar(umaPergunta, "nao_agendou");
  const completaram = agendaram + naoAgendaram;

  const totalVisivel = cadastros >= minimo || cadastros === 0;
  // Completaram × não completaram somam os cadastros; agendaram × não agendaram somam os que completaram.
  const [completaramOculto] = totalVisivel ? celulasOcultas([completaram, cadastros - completaram], minimo) : [true];
  const gruposOcultos = completaramOculto ? [true, true] : celulasOcultas([agendaram, naoAgendaram], minimo);

  const perguntas = PERGUNTAS.map((q): PerguntaDoPerfil => {
    const daPergunta = linhas.filter((l) => l.campo === q.campo);
    const opcoes = opcoesDe(q.campo, daPergunta);
    const chaves = opcoes.map((o) => o.chave);
    const contas = (coluna: "cadastros" | "agendou" | "nao_agendou") => new Map(daPergunta.map((l) => [l.valor, l[coluna]]));

    const todos = grupo(contas("cadastros"), chaves, cadastros, totalVisivel, minimo);
    const ag = grupo(contas("agendou"), chaves, agendaram, !gruposOcultos[0], minimo);
    const nag = grupo(contas("nao_agendou"), chaves, naoAgendaram, !gruposOcultos[1], minimo);
    const amostraPequena = Math.min(ag.respondidosBrutos, nag.respondidosBrutos) < AMOSTRA_MINIMA_GRUPO;

    return {
      campo: q.campo,
      pergunta: q.pergunta,
      distribuicao: { ...todos.resumo, opcoes: opcoes.map((o, k) => ({ ...o, ...todos.celulas[k] })) },
      comparacao: {
        agendou: ag.resumo,
        naoAgendou: nag.resumo,
        amostraPequena,
        linhas: opcoes.map((o, k) => {
          const a = ag.celulas[k].percentual;
          const b = nag.celulas[k].percentual;
          const diferenca = a === null || b === null ? null : a - b;
          return {
            ...o,
            agendou: ag.celulas[k],
            naoAgendou: nag.celulas[k],
            diferenca,
            destaque: !amostraPequena && diferenca !== null && Math.abs(diferenca) >= DIFERENCA_RELEVANTE - 1e-9,
          };
        }),
      },
    };
  });

  return {
    cadastros: totalVisivel ? cadastros : null,
    completaram: completaramOculto ? null : completaram,
    agendaram: gruposOcultos[0] ? null : agendaram,
    naoAgendaram: gruposOcultos[1] ? null : naoAgendaram,
    ocultaAbaixoDe: minimo > 0 ? minimo : null,
    perguntas,
    termos: TEXTOS_LIVRES.map((t) =>
      termos(
        t.campo,
        t.titulo,
        textos.filter((x) => x.campo === t.campo),
        cadastros,
        totalVisivel,
        minimo,
      ),
    ),
  };
}
