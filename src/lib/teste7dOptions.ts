/**
 * CÓPIA de src/lib/teste7dOptions.ts do repositório do site
 * (clickhero2026/site-ady, pasta ../site), commit 16f9252 de 27/10/2026.
 * Não editar aqui sem editar lá: o teste tests/unit/opcoes.test.ts compara
 * as duas versões quando ../site existe e acusa diferença.
 */

/**
 * Opções da etapa 2 do teste grátis — mesmas perguntas e respostas do
 * Google Forms "Briefing para o Onboarding do ADY". No banco vai a chave
 * (estável); o texto da opção vai pro Bitrix e, depois, pra tela.
 */

export const ACAO_DESEJADA = {
  whatsapp: "Me chamar no WhatsApp",
  loja: "Ir até a minha loja",
  agendar: "Marcar um horário comigo",
  site: "Comprar pelo meu site",
  outro: "Outro",
} as const;

export const EXPERIENCIA_ANUNCIOS = {
  nunca: "Nunca fiz",
  impulsionar: 'Já apertei o botão "Impulsionar" pelo celular',
  gerenciador: "Já fiz anúncio pelo computador, no Gerenciador de Anúncios",
  terceiro: "Tenho ou já tive uma pessoa ou agência que cuidava disso para mim",
} as const;

export const ACESSO_REDES = {
  ambos_com_login: "Tenho os dois e sei o login e a senha",
  so_instagram: "Tenho só o Instagram",
  so_facebook: "Tenho só o Facebook",
  senha_com_outro: "Tenho, mas quem sabe a senha é outra pessoa",
  nao_tem: "Ainda não tenho",
} as const;

export const CONTA_ANUNCIOS = {
  sim: "Sim, já tenho",
  nao: "Não tenho",
  nao_sei: "Não sei o que é isso",
} as const;

export const CARTAO_PAGAMENTO = {
  sim_meu: "Sim, o cartão está comigo",
  sim_outra_pessoa: "Sim, mas o cartão é de outra pessoa (sócio, esposa, contador)",
  nao_tem: "Ainda não tenho",
} as const;

export const ARQUIVO_LOGO = {
  sim: "Sim, tenho o arquivo da logo",
  so_print: "Tenho a logo, mas só em print ou foto de qualidade ruim",
  nao_tem: "Não tenho logo",
} as const;

export const REUNIAO_COMPUTADOR = {
  sim: "Sim, consigo pelo computador",
  so_celular: "Só consigo pelo celular",
  com_ajuda: "Consigo pelo computador, mas vou precisar de alguém me ajudando",
} as const;

/** Chaves de um mapa de opções, como tupla — formato que o `z.enum` pede. */
export function optionKeys<T extends Record<string, string>>(options: T) {
  return Object.keys(options) as [keyof T & string, ...(keyof T & string)[]];
}

/** Texto da opção pra uma chave gravada no banco; devolve a própria chave
 * se ela não existir mais no mapa (opção renomeada/removida). */
export function optionLabel(
  options: Record<string, string>,
  key: string | null,
): string | null {
  if (!key) return null;
  return options[key] ?? key;
}
