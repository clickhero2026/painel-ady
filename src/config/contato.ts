/**
 * Textos e endereços usados na ficha do lead. Editar aqui muda o painel
 * inteiro (exige novo deploy).
 */

/**
 * Mensagem pronta do botão de WhatsApp. Marcadores:
 *   {nome}      primeiro nome do lead
 *   {atendente} primeiro nome de quem está usando o painel
 */
export const MENSAGEM_WHATSAPP =
  "Oi, {nome}! Aqui é {atendente}, do ady. Vi que você se cadastrou no teste grátis de 7 dias e quero te ajudar a começar. Podemos conversar por aqui?";

/**
 * Mensagem do botão de WhatsApp na ficha de lead cadastrado à mão no painel
 * (a de cima fala em "se cadastrou", o que não vale para ele). Mesmos
 * marcadores de MENSAGEM_WHATSAPP.
 */
export const MENSAGEM_WHATSAPP_MANUAL =
  "Oi, {nome}! Aqui é {atendente}, do ady. Vou te ajudar a começar o teste grátis de 7 dias. Podemos conversar por aqui?";

/**
 * Mensagem do botão "Copiar mensagem com o link" (ficha de lead cadastrado à
 * mão). Montada no servidor, só no clique, e auditada como copiar_link.
 * Marcadores:
 *   {nome}      primeiro nome do lead
 *   {atendente} primeiro nome de quem está usando o painel
 *   {link}      link de ativação (com o token)
 */
export const MENSAGEM_LINK_ATIVACAO =
  "Oi, {nome}! Aqui é {atendente}, do ady. Esse é o link para ativar seu teste grátis de 7 dias: {link}";

/** Página da LP que retoma o cadastro; o token vai em ?t=. */
export const URL_ATIVAR_CONTA = "https://lp.useady.com.br/ativar-conta";

/** O link de ativação vale este tanto desde o cadastro (regra do site). */
export const VALIDADE_LINK_ATIVACAO_DIAS = 30;
