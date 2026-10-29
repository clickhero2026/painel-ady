/**
 * Conjunto de cadastros de teste do perfil, conhecido e fixo (inserido pelo
 * dono do banco). Datas em julho de 2026, no horário de São Paulo.
 *
 * - 130 cadastros: 90 completaram a ativação (45 agendaram, 45 não) e 40
 *   pararam em pontos diferentes;
 * - quem agendou tende a ter conta de anúncios, os dois acessos e
 *   computador (diferenças grandes, com os dois grupos acima de 30);
 * - chaves que não existem no mapa ("chave_antiga", "zz_nova");
 * - a campanha "camp-sem-resposta" só tem cadastros sem nenhuma resposta;
 * - cidade e negócio em texto livre com variações de caixa, acento,
 *   pontuação e espaço, termos de 2 a 4 pessoas e muitos termos únicos.
 */

export const CRIATIVOS_PERFIL = ["T7D-R2-H01-VID", "T7D-R2-H02-IMG"] as const;

export interface CadastroPerfil {
  id: string;
  criadoEm: string;
  criativo: string;
  campanha: string;
  versao: string;
  completou: boolean;
  agendou: boolean;
  r: Record<string, string | boolean | null>;
}

const rep = (texto: string, n: number) => Array.from({ length: n }, () => texto);

const CIDADES = [
  ...rep("Fortaleza, Aldeota", 10),
  ...rep("fortaleza  aldeota", 10),
  ...rep("FORTALEZA - ALDEOTA.", 10),
  ...rep("São Paulo", 8),
  ...rep("sao paulo", 6),
  ...rep("SÃO PAULO!!", 6),
  ...rep("Recife", 6),
  ...rep("Crato", 4),
  "Quixadá",
  "quixada",
  "...",
];
const NEGOCIOS = [
  ...rep("Doces", 10),
  ...rep("doces!", 8),
  ...rep("DOCES", 7),
  ...rep("Roupas femininas", 15),
  ...rep("Pet-shop", 5),
  ...rep("pet shop", 3),
  "Açaí",
  "acai",
  "AÇAÍ",
  "   ",
  "...",
];

const ACAO = ["whatsapp", "loja", "agendar", "site", "outro"];
const EXPERIENCIA = ["nunca", "impulsionar", "gerenciador", "terceiro"];
const REDES = ["ambos_com_login", "so_instagram", "so_facebook", "senha_com_outro", "nao_tem"];
const CARTAO = ["sim_meu", "sim_outra_pessoa", "nao_tem"];
const LOGO = ["sim", "so_print", "nao_tem"];
const PC = ["sim", "so_celular", "com_ajuda"];

let cidade = 0;
let negocio = 0;

function cadastro(i: number): CadastroPerfil {
  const completou = i < 90;
  const agendou = completou && i % 2 === 0;
  // Incompletos: 0 = nada; 1 = negócio e cidade; 2 = até a experiência; 3 = até a reunião.
  const ate = completou ? 3 : i % 4;
  const r: CadastroPerfil["r"] = {};
  if (ate >= 1) {
    r.negocio_nome_oferta = NEGOCIOS[negocio] ?? `Ateliê Exclusivo ${negocio}`;
    negocio++;
    if (i % 5 === 0) r.atende_todo_brasil = true;
    else {
      r.cidade_bairro = CIDADES[cidade] ?? `Sítio Isolado ${cidade}`;
      cidade++;
    }
  }
  if (ate >= 2) {
    r.acao_desejada = i === 5 ? "zz_nova" : ACAO[i % 5];
    if (r.acao_desejada === "outro") r.acao_desejada_outro = "Ligar na loja";
    r.experiencia_anuncios = EXPERIENCIA[i % 4];
  }
  if (ate >= 3) {
    r.acesso_redes = [91, 95, 99].includes(i) ? "chave_antiga" : agendou ? "ambos_com_login" : REDES[i % 5];
    r.conta_anuncios = agendou ? (i % 10 === 0 ? "nao" : "sim") : i % 3 === 0 ? "sim" : "nao";
    r.cartao_pagamento = CARTAO[i % 3];
    r.arquivo_logo = LOGO[i % 3];
    r.reuniao_computador = agendou ? "sim" : PC[i % 3];
  }
  return {
    id: `30000000-0000-4000-8000-000000000${String(i).padStart(3, "0")}`,
    criadoEm: `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T${String(9 + (i % 10)).padStart(2, "0")}:20:00-03:00`,
    criativo: CRIATIVOS_PERFIL[i % 3 === 0 ? 0 : 1],
    campanha: i >= 90 && i % 4 === 0 ? "camp-sem-resposta" : i % 4 === 1 ? "camp-y" : "camp-x",
    versao: "ABCDEF"[i % 6],
    completou,
    agendou,
    r,
  };
}

export const CADASTROS_PERFIL: CadastroPerfil[] = Array.from({ length: 130 }, (_, i) => cadastro(i));

type Sql = (texto: string, valores?: unknown[]) => Promise<unknown>;

const CAMPOS = [
  "negocio_nome_oferta", "cidade_bairro", "atende_todo_brasil", "acao_desejada", "acao_desejada_outro",
  "experiencia_anuncios", "acesso_redes", "conta_anuncios", "cartao_pagamento", "arquivo_logo", "reuniao_computador",
] as const;

export async function semearPerfil(sql: Sql): Promise<void> {
  for (const [n, c] of CADASTROS_PERFIL.entries()) {
    await sql(
      `INSERT INTO teste7d_inscricoes (
         id, created_at, nome, email, whatsapp, utm_source, utm_medium, utm_campaign, utm_content, lp_variant,
         ip_hash, user_agent, fbclid, ${CAMPOS.join(", ")}, observacoes, etapa2_concluida_em, agendado_em, status)
       VALUES ($1, $2::timestamptz, $3, $4, $5, 'facebook', 'paid', $6, $7, $8, 'IPHASH-SECRETO', 'UA-SECRETO', 'FBCLID-SECRETO',
         ${CAMPOS.map((_, k) => `$${9 + k}`).join(", ")}, 'Observação secreta do lead',
         CASE WHEN $20 THEN $2::timestamptz + interval '1 hour' END,
         CASE WHEN $21 THEN $2::timestamptz + interval '3 hours' END,
         CASE WHEN $21 THEN 'agendado' WHEN $20 THEN 'ativacao_preenchida' ELSE 'inscrito' END)`,
      [
        c.id, c.criadoEm, `Pessoa Perfil ${n}`, `perfil${n}@exemplo.com.br`, `5585970000${String(n).padStart(3, "0")}`,
        c.campanha, c.criativo, c.versao, ...CAMPOS.map((k) => c.r[k] ?? null), c.completou, c.agendou,
      ],
    );
  }
}

/** Nada disto pode sair do perfil (tela, API): dados pessoais e respostas únicas de texto livre. */
export const PESSOAIS_PERFIL = [
  ...CADASTROS_PERFIL.flatMap((_, n) => [`Pessoa Perfil ${n}`, `perfil${n}@exemplo.com.br`, `5585970000${String(n).padStart(3, "0")}`]),
  "Ateliê Exclusivo", "atelie exclusivo", "Sítio Isolado", "sitio isolado", "Fortaleza, Aldeota", "SÃO PAULO!!",
  "Observação secreta", "Ligar na loja", "IPHASH-SECRETO", "UA-SECRETO", "FBCLID-SECRETO",
];
