import * as z from "zod";

/**
 * Validação dos dados do cadastro manual de lead (leadManual.ts). Arquivo
 * puro (sem banco), igual à regra do site (clickhero2026/site-ady,
 * src/lib/teste7dSchema.ts e src/lib/phoneMask.ts, commit c3156f4), para o
 * lead cadastrado aqui ser igual a um que veio da LP:
 *   - nome: sem espaços nas pontas, de 2 a 120 caracteres;
 *   - e-mail: sem espaços nas pontas, minúsculo, até 180, formato válido;
 *   - WhatsApp: só dígitos; com 12 ou 13 dígitos começando em 55, o 55 sai;
 *     sobra DDD (11 a 99, sem zero) + 8 dígitos (fixo) ou 9 começando em 9
 *     (celular); grava "55" + dígitos, que passa no CHECK do banco
 *     (^55[1-9]{2}[0-9]{8,9}$).
 */

export const NOME_MIN = 2;
export const NOME_MAX = 120;
export const EMAIL_MAX = 180;
/** CHECK de teste7d_inscricoes.whatsapp. */
export const WHATSAPP_DO_BANCO = /^55[1-9]{2}[0-9]{8,9}$/;

/** DDD válido (11–99, sem zero) + 8 dígitos (fixo) ou 9 começando em 9 (celular). Igual a isValidPhone do site. */
export function telefoneValido(valor: string): boolean {
  const digitos = valor.replace(/\D/g, "").slice(0, 11);
  return /^[1-9]{2}(?:9\d{8}|\d{8})$/.test(digitos);
}

/**
 * WhatsApp brasileiro em só dígitos com o 55 na frente ("(85) 99999-9999" ou
 * "+55 85 99999-9999" → "5585999999999"), ou null se não for um número
 * válido com DDD. Igual a normalizeWhatsappBR do site.
 */
export function normalizarWhatsappBR(valor: string): string | null {
  let digitos = valor.replace(/\D/g, "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length > 11 || !telefoneValido(digitos)) return null;
  const final = `55${digitos}`;
  return WHATSAPP_DO_BANCO.test(final) ? final : null;
}

export type CampoDoLead = "nome" | "email" | "whatsapp" | "anotacao" | "responsavel";
export type ErrosDoLead = Partial<Record<CampoDoLead, string>>;

export interface DadosValidos {
  nome: string;
  email: string;
  whatsapp: string;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const formatoDeEmail = z.email();

/** Nome, e-mail e WhatsApp prontos para gravar, ou os erros de cada campo. */
export function validarDadosDoLead(dados: {
  nome?: unknown;
  email?: unknown;
  whatsapp?: unknown;
}): { ok: true; dados: DadosValidos } | { ok: false; erros: ErrosDoLead } {
  const erros: ErrosDoLead = {};

  const nome = texto(dados.nome);
  if (nome.length < NOME_MIN) erros.nome = nome ? "Nome muito curto: digite o nome completo." : "Digite o nome.";
  else if (nome.length > NOME_MAX) erros.nome = `Nome muito longo: até ${NOME_MAX} caracteres.`;

  const email = texto(dados.email).toLowerCase();
  if (!email) erros.email = "Digite o e-mail.";
  else if (email.length > EMAIL_MAX) erros.email = `E-mail muito longo: até ${EMAIL_MAX} caracteres.`;
  else if (!formatoDeEmail.safeParse(email).success) erros.email = "Digite um e-mail válido, como nome@exemplo.com.br.";

  const bruto = texto(dados.whatsapp);
  const whatsapp = bruto ? normalizarWhatsappBR(bruto) : null;
  if (!bruto) erros.whatsapp = "Digite o WhatsApp, com DDD.";
  else if (!whatsapp) erros.whatsapp = "Digite um WhatsApp válido, com DDD, como (85) 99999-9999.";

  if (Object.keys(erros).length > 0 || !whatsapp) return { ok: false, erros };
  return { ok: true, dados: { nome, email, whatsapp } };
}
