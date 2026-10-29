import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { garantirLocal, limparTabelas } from "../banco";
import { URL_E2E } from "../../playwright.config";

const PASTA_EMAILS = path.resolve(".dev-emails/e2e");

export async function sql<T = Record<string, unknown>>(texto: string, valores: unknown[] = []): Promise<T[]> {
  garantirLocal(URL_E2E);
  const cliente = new Client({ connectionString: URL_E2E });
  await cliente.connect();
  try {
    return (await cliente.query(texto, valores)).rows as T[];
  } finally {
    await cliente.end();
  }
}

/** Banco limpo com um admin ("Ana Admin") e uma pessoa de cada papel. */
export async function prepararEquipe() {
  await limparTabelas((texto) => sql(texto));
  await sql(
    `INSERT INTO painel_usuarios (email, nome, papel) VALUES
       ('ana@vendedormestre.com.br', 'Ana Admin', 'admin'),
       ('sergio@useady.com.br', 'Sérgio Suporte', 'suporte'),
       ('vera@useady.com.br', 'Vera Vendas', 'vendas'),
       ('leo@marketinglabs.com.br', 'Léo Leitura', 'leitura')`,
  );
}

export const EMAIL_DO_PAPEL = {
  admin: "ana@vendedormestre.com.br",
  suporte: "sergio@useady.com.br",
  vendas: "vera@useady.com.br",
  leitura: "leo@marketinglabs.com.br",
} as const;

async function linkMaisNovo(email: string, depoisDe: number): Promise<string | null> {
  const arquivos = (await readdir(PASTA_EMAILS).catch(() => [])).sort().reverse();
  for (const arquivo of arquivos) {
    if (Number(arquivo.split("-")[0]) < depoisDe) continue;
    const dados = JSON.parse(await readFile(path.join(PASTA_EMAILS, arquivo), "utf8"));
    if (dados.para === email) return dados.texto.match(/https?:\/\/\S+/)[0];
  }
  return null;
}

/** Pede o link pela tela de login e abre o link "recebido". */
export async function entrar(page: Page, email: string, destino = "/") {
  const inicio = Date.now();
  await page.goto(destino === "/" ? "/login" : `/login?voltar=${encodeURIComponent(destino)}`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(page.getByText("Se este e-mail tiver acesso ao painel")).toBeVisible();
  let link: string | null = null;
  await expect.poll(async () => (link = await linkMaisNovo(email, inicio)), { timeout: 10_000 }).not.toBeNull();
  await page.goto(link!);
  return link!;
}

export { linkMaisNovo };
