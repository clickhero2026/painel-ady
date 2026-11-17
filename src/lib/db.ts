import { Pool as NeonPool } from "@neondatabase/serverless";
import { attachDatabasePool } from "@vercel/functions";
import { Pool as PgPool, type PoolConfig } from "pg";
import { databaseCaCert, databaseDriver, databaseUrl, naVercel } from "./env";

/**
 * Pool de conexões do painel (só no servidor), escolhido por
 * `DATABASE_DRIVER` (ver `.env.example`):
 *
 *   - `neon` (padrão): `@neondatabase/serverless` via WebSocket. Fica
 *     enquanto houver rollback para o Neon.
 *   - `pg`: driver `pg` por TCP — Postgres próprio em produção e o
 *     Postgres local do `docker-compose.yml` em dev e testes.
 *
 * Com `pg`, o SSL vem SÓ de `DATABASE_CA_CERT` (PEM do certificado do
 * servidor), verificado (`rejectUnauthorized: true`). Os parâmetros de SSL
 * da URL (`sslmode` e afins) são removidos: no `pg` eles sobrescrevem o
 * objeto `ssl` e anulariam o CA. Na Vercel, `pg` sem CA não sobe.
 */

export interface Consulta {
  query<T = Record<string, unknown>>(
    texto: string,
    valores?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface PoolPainel extends Consulta {
  connect(): Promise<Consulta & { release(): void }>;
}

/** Pool pequeno: cada instância serverless abre o seu. */
export const POOL_PG = {
  max: 3,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
  /** Cancelado no servidor. */
  statement_timeout: 15_000,
  /** Desistência no cliente (o servidor já deveria ter cancelado antes). */
  query_timeout: 20_000,
} as const;

const PARAMETROS_SSL_DA_URL = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "sslpassword", "uselibpqcompat"];

/** Tira da URL os parâmetros de SSL, que no `pg` anulariam o objeto `ssl`. */
export function urlSemSsl(connectionString: string): string {
  const url = new URL(connectionString);
  for (const nome of PARAMETROS_SSL_DA_URL) url.searchParams.delete(nome);
  return url.toString();
}

/** Configuração do `pg`. Exportada para os testes. */
export function configPg(): PoolConfig {
  const ca = databaseCaCert();
  if (naVercel && !ca) {
    throw new Error("DATABASE_DRIVER=pg na Vercel exige DATABASE_CA_CERT (PEM do certificado do servidor).");
  }
  return {
    connectionString: urlSemSsl(databaseUrl()),
    ...POOL_PG,
    application_name: "painel",
    keepAlive: true,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
  };
}

function criarPool(): PoolPainel {
  if (databaseDriver() === "pg") {
    const pg = new PgPool(configPg());
    // Conexão ociosa derrubada pelo servidor: sem isto o erro derruba o processo.
    pg.on("error", (erro) => console.error("[db] erro numa conexão ociosa do pool", erro.message));
    // Fluid compute: fecha as ociosas antes de a instância ser suspensa.
    if (naVercel) attachDatabasePool(pg);
    return pg as unknown as PoolPainel;
  }
  return new NeonPool({ connectionString: databaseUrl() }) as unknown as PoolPainel;
}

/** Pool único por processo (o hot reload do dev não abre um novo a cada edição). */
export function pool(): PoolPainel {
  globalComPool.__painelPool ??= criarPool();
  return globalComPool.__painelPool;
}

const globalComPool = globalThis as typeof globalThis & { __painelPool?: PoolPainel };

/** Roda `fn` numa transação; desfaz tudo se ela lançar erro. */
export async function transacao<T>(fn: (db: Consulta) => Promise<T>): Promise<T> {
  const cliente = await pool().connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await fn(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}
