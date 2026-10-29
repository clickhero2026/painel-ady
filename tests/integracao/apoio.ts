import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { criarAuth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { limparTabelas } from "../banco";

/** Ajudantes dos testes de integração: chamam o Better Auth por HTTP de verdade. */

export const ORIGEM = "http://localhost:3000";
const PASTA_EMAILS = path.resolve(".dev-emails/vitest");

/** Conta Google "devolvida" pelo stub (o resto do fluxo OAuth roda de verdade). */
export const contaGoogle = { email: "", emailVerified: true, sub: "google-sub-1" };

export const auth = criarAuth({
  verifyIdToken: async () => true,
  getUserInfo: async () => ({
    user: {
      id: contaGoogle.sub,
      email: contaGoogle.email,
      name: "Pessoa do Google",
      emailVerified: contaGoogle.emailVerified,
    },
    data: { sub: contaGoogle.sub },
  }),
});

export const db = () => pool();

export async function limparTudo() {
  await limparTabelas((sql) => pool().query(sql));
  await rm(PASTA_EMAILS, { recursive: true, force: true });
}

export async function cadastrar(email: string, papel = "leitura", ativo = true) {
  const { rows } = await pool().query<{ id: string }>(
    "INSERT INTO painel_usuarios (email, papel, ativo) VALUES ($1, $2, $3) RETURNING id",
    [email, papel, ativo],
  );
  return rows[0].id;
}

export async function pedirLink(email: string, ip = "203.0.113.10") {
  return auth.handler(
    new Request(`${ORIGEM}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGEM, "X-Forwarded-For": ip },
      body: JSON.stringify({ email, callbackURL: "/", errorCallbackURL: "/login" }),
    }),
  );
}

/** Último link mágico "enviado" para o e-mail (caixa de saída de dev), ou null. */
export async function ultimoLink(email: string): Promise<string | null> {
  const arquivos = (await readdir(PASTA_EMAILS).catch(() => [])).sort();
  for (const arquivo of arquivos.reverse()) {
    const dados = JSON.parse(await readFile(path.join(PASTA_EMAILS, arquivo), "utf8"));
    if (dados.para === email.toLowerCase()) return dados.texto.match(/https?:\/\/\S+/)[0];
  }
  return null;
}

export async function abrirLink(url: string) {
  const resposta = await auth.handler(new Request(url, { headers: { "X-Forwarded-For": "203.0.113.10" } }));
  return {
    status: resposta.status,
    destino: resposta.headers.get("location") ?? "",
    cookie: cookieDeSessao(resposta),
  };
}

export function cookieDeSessao(resposta: Response): string | null {
  const cookie = resposta.headers.getSetCookie().find((c) => c.startsWith("painel.session_token="));
  return cookie ? cookie.split(";")[0] : null;
}

export async function entrarComGoogle(email: string, emailVerified = true) {
  contaGoogle.email = email;
  contaGoogle.emailVerified = emailVerified;
  contaGoogle.sub = `google-${email}`;
  const resposta = await auth.handler(
    new Request(`${ORIGEM}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGEM, "X-Forwarded-For": "203.0.113.20" },
      body: JSON.stringify({ provider: "google", idToken: { token: "token-falso" } }),
    }),
  );
  return { status: resposta.status, cookie: cookieDeSessao(resposta) };
}

export async function sessao(cookie: string | null) {
  if (!cookie) return null;
  const resposta = await auth.handler(new Request(`${ORIGEM}/api/auth/get-session`, { headers: { cookie } }));
  return (await resposta.json()) as { session: { token: string; papel: string }; user: { email: string } } | null;
}

export async function auditoria(acao: string) {
  const { rows } = await pool().query<{ usuario_id: string | null; detalhe: Record<string, unknown> }>(
    "SELECT usuario_id, detalhe FROM painel_auditoria WHERE acao = $1 ORDER BY id",
    [acao],
  );
  return rows;
}
