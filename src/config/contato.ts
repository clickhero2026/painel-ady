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

/** Página da LP que retoma o cadastro; o token vai em ?t=. */
export const URL_ATIVAR_CONTA = "https://lp.useady.com.br/ativar-conta";

/** O link de ativação vale este tanto desde o cadastro (regra do site). */
export const VALIDADE_LINK_ATIVACAO_DIAS = 30;
