/**
 * Leitura das variáveis de ambiente do servidor. Tudo documentado em
 * `.env.example`. Nada aqui vai pro navegador (só NEXT_PUBLIC_* iria).
 */

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ${nome} não configurada.`);
  return valor;
}

export const emProducao = process.env.NODE_ENV === "production";

/** Rodando na Vercel (produção ou preview). Lá, atalhos de dev nunca valem. */
export const naVercel = Boolean(process.env.VERCEL);

export function databaseUrl(): string {
  return obrigatoria("DATABASE_URL");
}

/** Origem pública do painel, sem barra no fim (ex. https://painel.useady.com.br). */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function authSecret(): string {
  const segredo = obrigatoria("AUTH_SECRET");
  if (segredo.length < 32) throw new Error("AUTH_SECRET precisa ter pelo menos 32 caracteres.");
  return segredo;
}

/** E-mail do primeiro admin (só vale com a tabela de usuários vazia). */
export function adminInicial(): string | null {
  const email = process.env.PAINEL_ADMIN_INICIAL?.trim().toLowerCase();
  return email || null;
}

export function google(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
