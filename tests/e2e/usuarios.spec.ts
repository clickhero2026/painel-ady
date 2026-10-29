import { expect, test, type Page } from "@playwright/test";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

test.beforeEach(async () => {
  await prepararEquipe();
});

function linha(page: Page, texto: string) {
  return page.getByRole("listitem").filter({ hasText: texto });
}

test("admin adiciona, muda papel, desativa e reativa — tudo auditado", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.admin, "/usuarios");

  await page.getByLabel("E-mail").fill("Nova@Parceiro.com.br");
  await page.getByLabel("Nome (opcional)").fill("Nina Nova");
  await page.getByLabel("Papel", { exact: true }).selectOption("vendas");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("nova@parceiro.com.br adicionado.")).toBeVisible();
  await expect(linha(page, "Nina Nova")).toBeVisible();

  const nina = linha(page, "Nina Nova");
  await nina.getByLabel("Papel de Nina Nova", { exact: true }).selectOption("suporte");
  await nina.getByRole("button", { name: "Salvar papel de Nina Nova" }).click();
  await expect(nina.getByText("Papel atualizado.")).toBeVisible();

  await nina.getByRole("button", { name: "Desativar Nina Nova" }).click();
  await expect(linha(page, "Nina Nova").getByText("desativado", { exact: true })).toBeVisible();
  await linha(page, "Nina Nova").getByRole("button", { name: "Reativar Nina Nova" }).click();
  await expect(linha(page, "Nina Nova").getByRole("button", { name: "Desativar Nina Nova" })).toBeVisible();

  const acoes = await sql<{ acao: string }>(
    "SELECT acao FROM painel_auditoria WHERE acao LIKE 'usuario_%' ORDER BY id",
  );
  expect(acoes.map((a) => a.acao)).toEqual([
    "usuario_criado",
    "usuario_papel_alterado",
    "usuario_desativado",
    "usuario_reativado",
  ]);
});

test("e-mail repetido mostra erro", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.admin, "/usuarios");
  await page.getByLabel("E-mail").fill("VERA@useady.com.br");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("Já existe um usuário com este e-mail.")).toBeVisible();
});

test("último admin ativo não pode ser rebaixado", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.admin, "/usuarios");
  const ana = linha(page, "Ana Admin");
  await ana.getByLabel("Papel de Ana Admin", { exact: true }).selectOption("leitura");
  await ana.getByRole("button", { name: "Salvar papel de Ana Admin" }).click();
  await expect(ana.getByText("Não dá para rebaixar o último admin ativo.")).toBeVisible();
  // E ninguém tem botão de desativar a si mesmo.
  await expect(ana.getByRole("button", { name: /Desativar/ })).toHaveCount(0);
  expect((await sql<{ papel: string }>("SELECT papel FROM painel_usuarios WHERE email = $1", [EMAIL_DO_PAPEL.admin]))[0].papel).toBe("admin");
});
