import { expect, test, type Page } from "@playwright/test";
import { LEADS, leadsDe } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

/**
 * Super admin e "Apagar lead", pela interface e pela API direta, com as
 * capturas da ficha (com e sem o botão), do modal e da tela de Usuários.
 * O super admin entra pelo dono do banco, como na migração
 * db/migrations/20261118_super_admin.sql (o painel_app não consegue criá-lo).
 */

const SUPER = { id: "10000000-0000-4000-8000-0000000000aa", email: "rafael@clickhero.com.br", nome: "Rafael Super" };
const LEAD = leadsDe("vera")[2];
const ORIGEM = "http://localhost:3100";

test.beforeEach(async () => {
  await prepararEquipe();
  await sql("INSERT INTO painel_usuarios (id, email, nome, papel, ativo) VALUES ($1, $2, $3, 'super_admin', true)", [
    SUPER.id,
    SUPER.email,
    SUPER.nome,
  ]);
});

async function existe(id: string) {
  return (await sql("SELECT 1 FROM teste7d_inscricoes WHERE id = $1", [id])).length === 1;
}

async function apagarPelaApi(page: Page, id: string, email: string) {
  return page.request.delete(`/api/leads/${id}`, { headers: { Origin: ORIGEM }, data: { email } });
}

for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
  test(`${papel}: sem botão "Apagar lead" e a API responde 403; nada é apagado`, async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL[papel]);
    if (papel !== "leitura") {
      await page.goto(`/leads/${LEAD.id}`);
      await expect(page.getByRole("heading", { name: LEAD.nome, level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Apagar lead" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Zona de perigo" })).toHaveCount(0);
    }
    const resposta = await apagarPelaApi(page, LEAD.id, LEAD.email);
    expect(resposta.status()).toBe(403);
    // Vendas também não apaga lead alheio (403 antes de qualquer leitura).
    const alheio = LEADS.find((l) => l.dono === null)!;
    expect((await apagarPelaApi(page, alheio.id, alheio.email)).status()).toBe(403);
    expect(await existe(LEAD.id)).toBe(true);
    expect(await existe(alheio.id)).toBe(true);
    expect(await sql("SELECT 1 FROM painel_auditoria WHERE acao = 'apagar_lead'")).toHaveLength(0);
  });
}

test("API sem sessão: 401; super admin com Origin de fora: 403", async ({ page }) => {
  expect((await page.request.delete(`/api/leads/${LEAD.id}`, { data: { email: LEAD.email } })).status()).toBe(401);
  await entrar(page, SUPER.email);
  const fora = await page.request.delete(`/api/leads/${LEAD.id}`, {
    headers: { Origin: "https://evil.example" },
    data: { email: LEAD.email },
  });
  expect(fora.status()).toBe(403);
  expect(await existe(LEAD.id)).toBe(true);
});

test("super admin pela API: e-mail errado 422, inexistente 404, certo apaga", async ({ page }) => {
  await entrar(page, SUPER.email);
  expect((await apagarPelaApi(page, LEAD.id, "outro@exemplo.com.br")).status()).toBe(422);
  expect(await existe(LEAD.id)).toBe(true);
  expect((await apagarPelaApi(page, "10000000-0000-4000-8000-00000000ffff", "x@y.com")).status()).toBe(404);
  expect((await apagarPelaApi(page, LEAD.id, LEAD.email)).status()).toBe(200);
  expect(await existe(LEAD.id)).toBe(false);
  expect((await apagarPelaApi(page, LEAD.id, LEAD.email)).status()).toBe(404);
});

for (const largura of [360, 1280] as const) {
  test(`super admin apaga pela ficha, com confirmação (${largura}px)`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: largura === 1280 ? 860 : 800 });

    // Ficha sem o botão (admin comum).
    await entrar(page, EMAIL_DO_PAPEL.admin, `/leads/${LEAD.id}`);
    await expect(page.getByRole("heading", { name: LEAD.nome, level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apagar lead" })).toHaveCount(0);
    await page.screenshot({ path: `docs/capturas/ficha-sem-apagar-${largura}.png`, fullPage: true });
    await page.context().clearCookies();

    // Ficha com o botão (super admin).
    await entrar(page, SUPER.email, `/leads/${LEAD.id}`);
    const zona = page.getByRole("region", { name: "Zona de perigo" });
    await expect(zona).toBeVisible();
    await page.screenshot({ path: `docs/capturas/ficha-apagar-${largura}.png`, fullPage: true });

    await zona.getByRole("button", { name: "Apagar lead" }).click();
    const modal = page.getByRole("dialog", { name: "Apagar este lead de vez?" });
    await expect(modal).toBeVisible();
    await expect(modal.getByText(LEAD.nome)).toBeVisible();
    await expect(modal.getByText(LEAD.email)).toBeVisible();
    await expect(modal.getByText("permanente e irreversível")).toBeVisible();
    const final = modal.getByRole("button", { name: "Apagar de vez" });
    await expect(final).toBeDisabled();
    await modal.getByLabel("Para confirmar, digite o e-mail do lead").fill("outro@exemplo.com.br");
    await expect(final).toBeDisabled();
    await page.screenshot({ path: `docs/capturas/ficha-apagar-modal-${largura}.png` });

    // Esc fecha sem apagar.
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    expect(await existe(LEAD.id)).toBe(true);

    await zona.getByRole("button", { name: "Apagar lead" }).click();
    await modal.getByLabel("Para confirmar, digite o e-mail do lead").fill(LEAD.email.toUpperCase());
    await expect(final).toBeEnabled();
    await final.click();
    await expect(page).toHaveURL(/\/leads\?apagado=1$/);
    await expect(page.getByText("Lead apagado.")).toBeVisible();
    expect(await existe(LEAD.id)).toBe(false);

    const [log] = await sql<{ usuario_id: string; detalhe: Record<string, unknown> }>(
      "SELECT usuario_id, detalhe FROM painel_auditoria WHERE acao = 'apagar_lead'",
    );
    expect(log.usuario_id).toBe(SUPER.id);
    expect(JSON.stringify(log.detalhe)).not.toContain(LEAD.email);

    // A ficha apagada é 404.
    const ficha = await page.goto(`/leads/${LEAD.id}`);
    expect(ficha?.status()).toBe(404);
  });
}

test("lead com cadastro mesclado nele: a zona de perigo explica e não mostra o botão", async ({ page }) => {
  const [principal, duplicado] = LEADS.filter((l) => l.dono === null);
  await sql("INSERT INTO painel_lead_mescla (duplicado_id, principal_id) VALUES ($1, $2)", [duplicado.id, principal.id]);
  await entrar(page, SUPER.email, `/leads/${principal.id}`);
  const zona = page.getByRole("region", { name: "Zona de perigo" });
  await expect(zona.getByText("desfaça as mesclas antes")).toBeVisible();
  await expect(zona.getByRole("button", { name: "Apagar lead" })).toHaveCount(0);
  expect((await apagarPelaApi(page, principal.id, principal.email)).status()).toBe(422);
});

for (const largura of [360, 1280] as const) {
  test(`Usuários: super admin com selo e sem ações; seletor sem "Super admin" (${largura}px)`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: largura === 1280 ? 860 : 800 });
    await entrar(page, EMAIL_DO_PAPEL.admin, "/usuarios");
    const linha = page.getByRole("listitem").filter({ hasText: SUPER.nome });
    await expect(linha.getByText("Super admin", { exact: true })).toBeVisible();
    await expect(linha.getByRole("combobox")).toHaveCount(0);
    await expect(linha.getByRole("button")).toHaveCount(0);
    await expect(page.getByLabel("Papel", { exact: true }).locator("option")).toHaveText(["Admin", "Suporte", "Vendas", "Leitura"]);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Ana Admin" }).getByLabel("Papel de Ana Admin").locator("option"),
    ).toHaveText(["Admin", "Suporte", "Vendas", "Leitura"]);
    await page.screenshot({ path: `docs/capturas/usuarios-super-admin-${largura}.png`, fullPage: true });

    // Com o super admin ativo, a Ana deixa de ser a "última admin" e pode ser rebaixada
    // (pelo super admin: se a própria Ana se rebaixasse, perderia o acesso à tela).
    await page.context().clearCookies();
    await entrar(page, SUPER.email, "/usuarios");
    await expect(page.getByRole("listitem").filter({ hasText: SUPER.nome }).getByText("você")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: SUPER.nome }).getByRole("button")).toHaveCount(0);
    const ana = page.getByRole("listitem").filter({ hasText: "Ana Admin" });
    await ana.getByLabel("Papel de Ana Admin", { exact: true }).selectOption("vendas");
    await ana.getByRole("button", { name: "Salvar papel de Ana Admin" }).click();
    await expect(ana.getByText("Papel atualizado.")).toBeVisible();
  });
}

test("super admin vê a mesma barra e as mesmas áreas do admin", async ({ page }) => {
  await entrar(page, SUPER.email);
  await expect(page.getByText("Super admin").first()).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Principal" });
  for (const item of ["Leads", "Pipeline", "Reuniões para fechar", "Funil", "Perfil", "Possíveis duplicados", "Usuários"]) {
    await expect(menu.getByRole("link", { name: item })).toBeVisible();
  }
  for (const caminho of ["/usuarios", "/duplicados", "/leads?visao=sem_responsavel", "/leads/novo", "/pipeline"]) {
    const r = await page.goto(caminho);
    expect(r?.status(), caminho).toBe(200);
  }
  // Exportar CSV (só admin): o super admin também.
  const csv = await page.request.post("/api/funil/exportar", { headers: { Origin: ORIGEM }, form: { periodo: "tudo" } });
  expect(csv.status()).toBe(200);
});
