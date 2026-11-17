import { afterEach, describe, expect, it, vi } from "vitest";

// Cada caso reimporta os módulos do zero (pg, Neon, @vercel/functions): o primeiro import é lento.
vi.setConfig({ testTimeout: 30_000 });

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBteste\n-----END CERTIFICATE-----";

/** Importa db.ts/env.ts de novo (`naVercel` é lido no import). */
async function carregar(env: Record<string, string | undefined>) {
  for (const [nome, valor] of Object.entries(env)) vi.stubEnv(nome, valor as string);
  vi.resetModules();
  return { db: await import("@/lib/db"), env: await import("@/lib/env") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("driver do banco", () => {
  it("padrão é neon; aceita pg; recusa outro valor", async () => {
    expect((await carregar({ DATABASE_DRIVER: "" })).env.databaseDriver()).toBe("neon");
    expect((await carregar({ DATABASE_DRIVER: "neon" })).env.databaseDriver()).toBe("neon");
    expect((await carregar({ DATABASE_DRIVER: "pg" })).env.databaseDriver()).toBe("pg");
    const { env } = await carregar({ DATABASE_DRIVER: "postgres" });
    expect(() => env.databaseDriver()).toThrow(/DATABASE_DRIVER inválida/);
  });

  it("DATABASE_CA_CERT aceita \\n escrito e vazio vira null", async () => {
    expect((await carregar({ DATABASE_CA_CERT: PEM.replace(/\n/g, "\\n") })).env.databaseCaCert()).toBe(PEM);
    expect((await carregar({ DATABASE_CA_CERT: "  " })).env.databaseCaCert()).toBeNull();
  });
});

describe("configuração do pg", () => {
  it("remove sslmode e afins da URL, mantendo o resto", async () => {
    const { db } = await carregar({});
    const url = db.urlSemSsl("postgres://u:s@185.111.156.157:5432/painel?sslmode=require&uselibpqcompat=true&application_name=x");
    expect(url).toBe("postgres://u:s@185.111.156.157:5432/painel?application_name=x");
  });

  it("com CA: ssl verificado e pool pequeno", async () => {
    const { db } = await carregar({
      DATABASE_URL: "postgres://u:s@185.111.156.157:5432/painel?sslmode=require",
      DATABASE_CA_CERT: PEM,
      VERCEL: "1",
    });
    const config = db.configPg();
    expect(config.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(config.connectionString).not.toMatch(/sslmode/);
    expect(config).toMatchObject({
      max: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      query_timeout: 20_000,
    });
  });

  it("na Vercel, sem CA, recusa subir", async () => {
    const { db } = await carregar({ DATABASE_CA_CERT: "", VERCEL: "1" });
    expect(() => db.configPg()).toThrow(/exige DATABASE_CA_CERT/);
  });

  it("fora da Vercel, sem CA, conecta sem SSL (Postgres local)", async () => {
    const { db } = await carregar({ DATABASE_CA_CERT: "", VERCEL: "" });
    expect(db.configPg().ssl).toBeUndefined();
  });
});
