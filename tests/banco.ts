import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Bancos dos testes: SEMPRE o Postgres local (docker-compose.yml), nunca o
 * Neon. Recusa qualquer URL que não seja localhost.
 *
 * O app roda como painel_app, com exatamente as permissões de
 * db/grants/painel_app.sql; os ajudantes dos testes (montar dados, limpar)
 * usam o dono do banco (postgres).
 */
export const SENHA_APP_TESTE = "painel_app_local";

export function urls(nome: string) {
  return {
    dono: `postgres://postgres:postgres@localhost:54329/${nome}`,
    app: `postgres://painel_app:${SENHA_APP_TESTE}@localhost:54329/${nome}`,
  };
}

export const BANCO_TESTE = urls("painel_teste");

export function garantirLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Testes só rodam em banco local; recusado: ${host}`);
  }
}

const raiz = path.resolve(__dirname, "..");
const ler = (arquivo: string) => readFileSync(path.join(raiz, arquivo), "utf8");

/** Recria o banco do zero: schema do site, migração do painel e GRANTs. */
export async function recriarBanco(urlDono: string): Promise<void> {
  garantirLocal(urlDono);
  const nome = new URL(urlDono).pathname.slice(1);
  const servidor = new URL(urlDono);
  servidor.pathname = "/postgres";

  const cliente = new Client({ connectionString: servidor.toString() });
  await cliente.connect();
  await cliente.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
  await cliente.query(`CREATE DATABASE ${nome}`);
  // Usuário do app: existe uma vez por servidor; sem privilégio nenhum além dos GRANTs.
  await cliente.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'painel_app') THEN
      CREATE ROLE painel_app LOGIN PASSWORD '${SENHA_APP_TESTE}';
    END IF;
  END $$`);
  await cliente.end();

  const banco = new Client({ connectionString: urlDono });
  await banco.connect();
  await banco.query(ler("tests/fixtures/teste7d_inscricoes.sql"));
  await banco.query(ler("db/migrations/20261028_painel_base.sql"));
  await banco.query(ler("db/grants/painel_app.sql"));
  await banco.end();
}

/** Cliente do dono do banco, pra montar e limpar dados nos testes. */
export function criarConsultaDono(urlDono: string) {
  garantirLocal(urlDono);
  return async function sql<T = Record<string, unknown>>(texto: string, valores: unknown[] = []): Promise<T[]> {
    const cliente = new Client({ connectionString: urlDono });
    await cliente.connect();
    try {
      return (await cliente.query(texto, valores)).rows as T[];
    } finally {
      await cliente.end();
    }
  };
}

/** Esvazia todas as tabelas (do painel e de cadastros) entre um teste e outro. */
export async function limparTabelas(consultar: (sql: string) => Promise<unknown>): Promise<void> {
  await consultar(
    `TRUNCATE painel_auditoria, painel_lead_responsavel, painel_auth_account, painel_auth_session,
              painel_auth_verification, painel_auth_rate_limit, painel_auth_user, painel_usuarios,
              teste7d_inscricoes
     RESTART IDENTITY CASCADE`,
  );
}
