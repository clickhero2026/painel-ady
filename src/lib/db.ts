import { Pool as NeonPool } from "@neondatabase/serverless";
import { databaseUrl, naVercel } from "./env";

/**
 * Pool de conexões do painel (só no servidor). Em produção é sempre o
 * driver do Neon (`@neondatabase/serverless`, via WebSocket), conectado
 * com o usuário `painel_app`.
 *
 * Só fora da Vercel (dev e testes, inclusive `next start` local), com
 * `DATABASE_DRIVER=pg`, usa o driver `pg` (mesma interface do Pool do
 * Neon) contra o Postgres local do `docker-compose.yml` — o driver do Neon
 * não fala com um Postgres comum sem um proxy na frente. Na Vercel a
 * variável é ignorada.
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

const globalComPool = globalThis as typeof globalThis & { __painelPool?: PoolPainel };

function criarPool(): PoolPainel {
  const connectionString = databaseUrl();
  if (!naVercel && process.env.DATABASE_DRIVER === "pg") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    return new Pool({ connectionString, max: 5 }) as unknown as PoolPainel;
  }
  return new NeonPool({ connectionString }) as unknown as PoolPainel;
}

/** Pool único por processo (o hot reload do dev não abre um novo a cada edição). */
export function pool(): PoolPainel {
  globalComPool.__painelPool ??= criarPool();
  return globalComPool.__painelPool;
}

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
