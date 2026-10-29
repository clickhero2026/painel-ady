/**
 * Conjunto de cadastros de teste do funil, conhecido e fixo (inserido pelo
 * dono do banco). Datas em setembro de 2026, no horário de São Paulo.
 *
 * - 49 cadastros de 01/09 a 20/09, com criativos (e sem), campanhas,
 *   origens, mídias e versões (e sem versão) variados;
 * - a ativação para em pontos diferentes (inclusive resposta vazia e
 *   "outro" sem texto, que o site não conta como respondida);
 * - 2 cadastros na virada do dia (10/09 às 23h30 e 11/09 às 00h10) e 1 em
 *   31/08 às 23h59 (fora do período de setembro);
 * - nenhum dado de reunião (o teste que precisa marca e desfaz).
 */

export interface CadastroFunil {
  id: string;
  /** Data e hora de São Paulo, com o fuso explícito. */
  criadoEm: string;
  criativo: string | null;
  campanha: string;
  origem: string;
  midia: string;
  versao: string | null;
  respostas: Partial<Record<CampoAtivacao, string | boolean | null>>;
  /** Horas do cadastro à conclusão da ativação (null = não concluiu). */
  ativacaoH: number | null;
  /** Horas da ativação ao agendamento (null = não agendou). */
  agendamentoH: number | null;
}

export type CampoAtivacao =
  | "negocio_nome_oferta"
  | "cidade_bairro"
  | "atende_todo_brasil"
  | "acao_desejada"
  | "acao_desejada_outro"
  | "experiencia_anuncios"
  | "acesso_redes"
  | "conta_anuncios"
  | "cartao_pagamento"
  | "arquivo_logo"
  | "reuniao_computador"
  | "observacoes";

const CRIATIVOS = ["T7D-R1-H01-VID", "T7D-R1-H02-IMG", "T7D-R1-H03-CAR", null];
/** Quantas telas cada cadastro respondeu, pela posição (i % 7); 10 = concluiu. */
const TELAS_RESPONDIDAS = [0, 3, 5, 9, 10, 10, 10];

/** Respostas das `n` primeiras telas, na ordem do site. */
function respostasAte(n: number, i: number): CadastroFunil["respostas"] {
  const r: CadastroFunil["respostas"] = {};
  const telas: (() => void)[] = [
    () => (r.negocio_nome_oferta = `Negócio ${i}`),
    () => (i % 2 ? (r.cidade_bairro = "Fortaleza, Aldeota") : (r.atende_todo_brasil = true)),
    () => {
      r.acao_desejada = i % 3 ? "whatsapp" : "outro";
      if (r.acao_desejada === "outro") r.acao_desejada_outro = "Ligar na loja";
    },
    () => (r.experiencia_anuncios = "nunca"),
    () => (r.acesso_redes = "ambos_com_login"),
    () => (r.conta_anuncios = "sim"),
    () => (r.cartao_pagamento = "sim_meu"),
    () => (r.arquivo_logo = "sim"),
    () => (r.reuniao_computador = "sim"),
    () => (r.observacoes = i % 2 ? "Nada a declarar." : null),
  ];
  telas.slice(0, n).forEach((t) => t());
  return r;
}

const dia = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;

function cadastro(i: number): CadastroFunil {
  const telas = TELAS_RESPONDIDAS[i % 7];
  const concluiu = telas === 10;
  return {
    id: `20000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
    criadoEm: `${dia(1 + (i % 20))}T${String(8 + ((i * 7) % 14)).padStart(2, "0")}:15:00-03:00`,
    criativo: CRIATIVOS[i % 4],
    campanha: i % 3 === 0 ? "camp-b" : "camp-a",
    origem: i % 5 === 0 ? "instagram" : "facebook",
    midia: i % 2 ? "paid" : "cpc",
    versao: i % 11 === 0 ? null : "ABCDEF"[i % 6],
    respostas: respostasAte(telas, i),
    ativacaoH: concluiu ? 1 + (i % 5) : null,
    agendamentoH: concluiu && i % 2 === 0 ? 2 + (i % 3) * 3 : null,
  };
}

const base = Array.from({ length: 44 }, (_, i) => cadastro(i));

/** Casos especiais (ids 44 a 48). */
const especiais: CadastroFunil[] = [
  // Virada do dia: 23h30 de 10/09 em São Paulo é 02h30 de 11/09 em UTC.
  { ...cadastro(44), criadoEm: "2026-09-10T23:30:00-03:00" },
  { ...cadastro(45), criadoEm: "2026-09-11T00:10:00-03:00" },
  // Fora de setembro por 1 minuto.
  { ...cadastro(46), criadoEm: "2026-08-31T23:59:00-03:00" },
  // Resposta só com espaços: o site não deixa avançar (para na 1ª pergunta).
  { ...cadastro(47), respostas: { negocio_nome_oferta: "   " }, ativacaoH: null, agendamentoH: null },
  // "Outro" sem texto: para na pergunta da ação desejada.
  {
    ...cadastro(48),
    respostas: { negocio_nome_oferta: "Doces", cidade_bairro: "Recife", acao_desejada: "outro" },
    ativacaoH: null,
    agendamentoH: null,
  },
];
especiais.forEach((c, k) => (c.id = `20000000-0000-4000-8000-0000000000${44 + k}`));

export const CADASTROS_FUNIL: CadastroFunil[] = [...base, ...especiais];

type Sql = (texto: string, valores?: unknown[]) => Promise<unknown>;

export async function semearFunil(sql: Sql): Promise<void> {
  for (const [n, c] of CADASTROS_FUNIL.entries()) {
    const r = c.respostas;
    await sql(
      `INSERT INTO teste7d_inscricoes (
         id, created_at, nome, email, whatsapp, utm_source, utm_medium, utm_campaign, utm_content, lp_variant,
         ip_hash, user_agent, fbclid,
         negocio_nome_oferta, cidade_bairro, atende_todo_brasil, acao_desejada, acao_desejada_outro,
         experiencia_anuncios, acesso_redes, conta_anuncios, cartao_pagamento, arquivo_logo, reuniao_computador,
         observacoes, etapa2_concluida_em, agendado_em, status)
       VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, 'IPHASH-SECRETO', 'UA-SECRETO', 'FBCLID-SECRETO',
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
         $2::timestamptz + ($23 || ' hours')::interval,
         $2::timestamptz + (($23::int + $24::int) || ' hours')::interval,
         CASE WHEN $24 IS NOT NULL THEN 'agendado' WHEN $23 IS NOT NULL THEN 'ativacao_preenchida' ELSE 'inscrito' END)`,
      [
        c.id, c.criadoEm, `Pessoa Funil ${n}`, `funil${n}@exemplo.com.br`, `5585980000${String(n).padStart(3, "0")}`,
        c.origem, c.midia, c.campanha, c.criativo, c.versao,
        r.negocio_nome_oferta ?? null, r.cidade_bairro ?? null, r.atende_todo_brasil ?? null, r.acao_desejada ?? null,
        r.acao_desejada_outro ?? null, r.experiencia_anuncios ?? null, r.acesso_redes ?? null, r.conta_anuncios ?? null,
        r.cartao_pagamento ?? null, r.arquivo_logo ?? null, r.reuniao_computador ?? null, r.observacoes ?? null,
        c.ativacaoH === null ? null : String(c.ativacaoH), c.agendamentoH === null ? null : String(c.agendamentoH),
      ],
    );
  }
}

/** Nomes, e-mails e WhatsApps do conjunto: nada disso pode sair na tela do funil. */
export const PESSOAIS_FUNIL = CADASTROS_FUNIL.flatMap((_, n) => [
  `Pessoa Funil ${n}`,
  `funil${n}@exemplo.com.br`,
  `5585980000${String(n).padStart(3, "0")}`,
]);
