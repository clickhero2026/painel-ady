/**
 * Conjunto de leads de teste, conhecido e fixo (inserido pelo dono do banco,
 * já que o painel_app não escreve em teste7d_inscricoes). Todas as respostas
 * usam chaves do mapa — o teste de "chaves sem mapa" confere isso.
 *
 * - 30 leads: 12 da Vera (vendas), 3 do Vitor (vendas), 2 de um vendedor
 *   desativado e 13 sem responsável;
 * - criativos T7D-R1-H01-VID / H02-IMG / H03-CAR, campanhas camp-a / camp-b,
 *   versões A a F, cadastros ao longo de 30 dias;
 * - ip_hash, user_agent e fbclid preenchidos (o painel nunca pode mostrar);
 * - reuniao_em e realizada_em sempre vazios (nenhum fluxo preenche hoje).
 */

export interface LeadTeste {
  id: string;
  nome: string;
  email: string;
  whatsapp: string;
  status: string;
  utm_content: string;
  utm_campaign: string;
  lp_variant: string;
  dias_atras: number;
  token: string;
  dono: "vera" | "vitor" | "inativo" | null;
  acesso_redes: string | null;
  conta_anuncios: string | null;
  cartao_pagamento: string | null;
  arquivo_logo: string | null;
  reuniao_computador: string | null;
  experiencia_anuncios: string | null;
  acao_desejada: string | null;
}

const NOMES = [
  "Ana Souza", "Bruno Lima", "Carla Dias", "Diego Alves", "Elisa Rocha", "Fábio Nunes", "Gabi Melo", "Hugo Reis",
  "Iara Costa", "João Pires", "Kátia Luz", "Lucas Moura", "Marta Gil", "Nina Prado", "Otto Sá", "Paula Vaz",
  "Quésia Leal", "Rafa Paz", "Sara Brito", "Téo Faria", "Úrsula Dantas", "Vini Lobo", "Wanda Cruz", "Xavier Neto",
  "Yara Mota", "Zeca Bento", "Alice Ramos", "Beto Cunha", "Cíntia Matos", "Davi Torres",
];
const STATUS = ["inscrito", "ativacao_preenchida", "agendado", "inscrito", "ativacao_preenchida"];
const CRIATIVOS = ["T7D-R1-H01-VID", "T7D-R1-H02-IMG", "T7D-R1-H03-CAR"];
const REDES = ["ambos_com_login", "so_instagram", "so_facebook", "senha_com_outro", "nao_tem"];
const CONTA = ["sim", "nao", "nao_sei"];
const CARTAO = ["sim_meu", "sim_outra_pessoa", "nao_tem"];
const LOGO = ["sim", "so_print", "nao_tem"];
const PC = ["sim", "so_celular", "com_ajuda"];
const EXPERIENCIA = ["nunca", "impulsionar", "gerenciador", "terceiro"];
const ACAO = ["whatsapp", "loja", "agendar", "site"];

function dono(i: number): LeadTeste["dono"] {
  if (i < 12) return "vera";
  if (i < 15) return "vitor";
  if (i < 17) return "inativo";
  return null;
}

export const LEADS: LeadTeste[] = NOMES.map((nome, i) => {
  const status = STATUS[i % STATUS.length];
  const preencheu = status !== "inscrito";
  const n = String(i).padStart(2, "0");
  return {
    id: `00000000-0000-4000-8000-0000000000${n}`,
    nome,
    email: `lead${n}@exemplo.com.br`,
    whatsapp: `55859${String(80000000 + i * 1111).padStart(8, "0")}`,
    status,
    utm_content: CRIATIVOS[i % 3],
    utm_campaign: i % 2 ? "camp-b" : "camp-a",
    lp_variant: "ABCDEF"[i % 6],
    dias_atras: i,
    token: `tokenteste${n}${"x".repeat(20)}`,
    dono: dono(i),
    acesso_redes: preencheu ? REDES[i % 5] : null,
    conta_anuncios: preencheu ? CONTA[i % 3] : null,
    cartao_pagamento: preencheu ? CARTAO[i % 3] : null,
    arquivo_logo: preencheu ? LOGO[i % 3] : null,
    reuniao_computador: preencheu ? PC[i % 3] : null,
    experiencia_anuncios: preencheu ? EXPERIENCIA[i % 4] : null,
    acao_desejada: preencheu ? ACAO[i % 4] : null,
  };
});

export const USUARIOS_TESTE = {
  ana: { id: "10000000-0000-4000-8000-000000000001", email: "ana@vendedormestre.com.br", nome: "Ana Admin", papel: "admin", ativo: true },
  sergio: { id: "10000000-0000-4000-8000-000000000002", email: "sergio@useady.com.br", nome: "Sérgio Suporte", papel: "suporte", ativo: true },
  vera: { id: "10000000-0000-4000-8000-000000000003", email: "vera@useady.com.br", nome: "Vera Vendas", papel: "vendas", ativo: true },
  vitor: { id: "10000000-0000-4000-8000-000000000004", email: "vitor@useady.com.br", nome: "Vitor Vendas", papel: "vendas", ativo: true },
  leo: { id: "10000000-0000-4000-8000-000000000005", email: "leo@marketinglabs.com.br", nome: "Léo Leitura", papel: "leitura", ativo: true },
  inativo: { id: "10000000-0000-4000-8000-000000000006", email: "saiu@useady.com.br", nome: "Ex Vendedor", papel: "vendas", ativo: false },
} as const;

type Sql = (texto: string, valores?: unknown[]) => Promise<unknown>;

/** Insere usuários, leads e responsáveis. Espera as tabelas vazias. */
export async function semear(sql: Sql): Promise<void> {
  for (const u of Object.values(USUARIOS_TESTE)) {
    await sql("INSERT INTO painel_usuarios (id, email, nome, papel, ativo) VALUES ($1, $2, $3, $4, $5)", [
      u.id, u.email, u.nome, u.papel, u.ativo,
    ]);
  }
  for (const l of LEADS) {
    const preencheu = l.status !== "inscrito";
    await sql(
      `INSERT INTO teste7d_inscricoes (
         id, created_at, nome, email, whatsapp, consentimento_lgpd, utm_source, utm_medium, utm_campaign,
         utm_content, lp_variant, fbclid, user_agent, ip_hash, token_retomada,
         negocio_nome_oferta, cidade_bairro, atende_todo_brasil, acao_desejada, experiencia_anuncios,
         acesso_redes, conta_anuncios, cartao_pagamento, arquivo_logo, reuniao_computador, observacoes,
         etapa2_concluida_em, agendado_em, status)
       VALUES ($1, now() - ($2 || ' days')::interval - interval '2 hours', $3, $4, $5, true, 'facebook', 'paid', $6,
         $7, $8, 'FBCLID-SECRETO', 'UA-SECRETO', 'IPHASH-SECRETO', $9,
         $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
         $21, $22, $23)`,
      [
        l.id, String(l.dias_atras), l.nome, l.email, l.whatsapp, l.utm_campaign, l.utm_content, l.lp_variant, l.token,
        preencheu ? `Loja de ${l.nome.split(" ")[0]}` : null, preencheu ? "Fortaleza, Aldeota" : null,
        preencheu ? l.dias_atras % 2 === 0 : null, l.acao_desejada, l.experiencia_anuncios, l.acesso_redes,
        l.conta_anuncios, l.cartao_pagamento, l.arquivo_logo, l.reuniao_computador,
        preencheu ? "Prefere falar depois das 18h." : null,
        null, // etapa2_concluida_em e agendado_em: preenchidos no UPDATE abaixo
        null,
        l.status,
      ],
    );
  }
  // Ativação 1h e agendamento 2h depois do cadastro, conforme a etapa.
  await sql(`UPDATE teste7d_inscricoes SET
      etapa2_concluida_em = CASE WHEN status <> 'inscrito' THEN created_at + interval '1 hour' END,
      agendado_em = CASE WHEN status = 'agendado' THEN created_at + interval '2 hours' END`);
  for (const l of LEADS) {
    if (!l.dono) continue;
    await sql("INSERT INTO painel_lead_responsavel (lead_id, usuario_id, atribuido_por) VALUES ($1, $2, $3)", [
      l.id, USUARIOS_TESTE[l.dono].id, USUARIOS_TESTE.ana.id,
    ]);
  }
}

export const leadsDe = (quem: LeadTeste["dono"]) => LEADS.filter((l) => l.dono === quem);
