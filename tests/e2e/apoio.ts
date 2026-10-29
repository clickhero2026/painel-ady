import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { criarConsultaDono, limparTabelas } from "../banco";
import { semear, USUARIOS_TESTE } from "../fixtures/leads";
import { BANCO_E2E } from "../../playwright.config";

const PASTA_EMAILS = path.resolve(".dev-emails/e2e");

/** Dono do banco local do e2e (monta e confere dados; o app roda como painel_app). */
export const sql = criarConsultaDono(BANCO_E2E.dono);

/** Banco limpo com a equipe de teste (um de cada papel) e os 30 leads de tests/fixtures/leads.ts. */
export async function prepararEquipe() {
  await limparTabelas((texto) => sql(texto));
  await semear(sql);
}

export const EMAIL_DO_PAPEL = {
  admin: USUARIOS_TESTE.ana.email,
  suporte: USUARIOS_TESTE.sergio.email,
  vendas: USUARIOS_TESTE.vera.email,
  leitura: USUARIOS_TESTE.leo.email,
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
