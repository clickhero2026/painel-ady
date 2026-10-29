import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Banco dos testes: SEMPRE um Postgres local (docker-compose.yml), nunca o
 * Neon. Recusa qualquer URL que não seja localhost.
 */
export const URL_TESTE = "postgres://postgres:postgres@localhost:54329/painel_teste";

export function garantirLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Testes só rodam em banco local; recusado: ${host}`);
  }
}

const raiz = path.resolve(__dirname, "..");

/** Recria o banco de teste do zero e aplica a migração do painel. */
export async function recriarBanco(url = URL_TESTE): Promise<void> {
  garantirLocal(url);
  const alvo = new URL(url);
  const nome = alvo.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";

  const cliente = new Client({ connectionString: admin.toString() });
  await cliente.connect();
  await cliente.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
  await cliente.query(`CREATE DATABASE ${nome}`);
  await cliente.end();

  const banco = new Client({ connectionString: url });
  await banco.connect();
  await banco.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await banco.query(readFileSync(path.join(raiz, "tests/fixtures/teste7d_inscricoes_minima.sql"), "utf8"));
  await banco.query(readFileSync(path.join(raiz, "db/migrations/20261028_painel_base.sql"), "utf8"));
  await banco.end();
}

/** Esvazia todas as tabelas do painel (entre um teste e outro). */
export async function limparTabelas(consultar: (sql: string) => Promise<unknown>): Promise<void> {
  await consultar(
    `TRUNCATE painel_auditoria, painel_lead_responsavel, painel_auth_account, painel_auth_session,
              painel_auth_verification, painel_auth_rate_limit, painel_auth_user, painel_usuarios
     RESTART IDENTITY CASCADE`,
  );
}
