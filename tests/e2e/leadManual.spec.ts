import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LEADS, leadsDe, USUARIOS_TESTE } from "../fixtures/leads";
import { LOG_SERVIDOR } from "../../playwright.config";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

/**
 * Cadastro manual de lead ("Novo lead"): API por papel, fluxo completo da
 * tela em 360 e 1280 px (com axe e capturas em docs/capturas) e o token
 * fora do HTML, das respostas e do log.
 */

const ORIGEM = "http://localhost:3100";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAPEIS = ["admin", "suporte", "vendas", "leitura"] as const;

const criar = (page: Page, dados: Record<string, unknown>, origem: string | null = ORIGEM) =>
  page.request.post("/api/leads", { headers: origem ? { Origin: origem } : {}, data: dados });

const lead = (n: string) => ({ nome: `Lead Manual ${n}`, email: `manual.${n}@exemplo.com.br`, whatsapp: "(85) 96666-0000" });

async function tokenDe(id: string): Promise<string> {
  return (await sql<{ token_retomada: string }>("SELECT token_retomada FROM teste7d_inscricoes WHERE id = $1", [id]))[0].token_retomada;
}

async function axe(page: Page, nome: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(r.violations.map((v) => `${nome}: ${v.id} (${v.nodes.length})`)).toEqual([]);
}

/** Sem rolagem horizontal e nenhum texto cortado (mesma checagem de visual.spec.ts). */
async function semCortes(page: Page, onde = "") {
  const problemas = await page.evaluate(() => {
    const achados: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) achados.push("página rola na horizontal");
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden" || el.closest(".sr-only")) continue;
      if (!["hidden", "clip"].includes(estilo.overflowX)) continue;
      if (el.scrollWidth > el.clientWidth + 1) achados.push(`cortado: <${el.tagName.toLowerCase()}> "${el.innerText.slice(0, 40)}"`);
    }
    return achados;
  });
  expect(problemas, onde).toEqual([]);
}

test.beforeEach(async () => {
  await prepararEquipe();
});

test.describe("API POST /api/leads", () => {
  for (const papel of PAPEIS) {
    test(`${papel}: ${papel === "admin" || papel === "vendas" ? "201" : "403, nada gravado"}`, async ({ page }) => {
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      const r = await criar(page, lead(papel));
      const linhas = await sql<{ id: string; utm_source: string }>("SELECT id, utm_source FROM teste7d_inscricoes WHERE email = $1", [lead(papel).email]);
      if (papel === "admin" || papel === "vendas") {
        expect(r.status()).toBe(201);
        const corpo = await r.json();
        expect(Object.keys(corpo)).toEqual(["id"]);
        expect(corpo.id).toMatch(UUID);
        expect(linhas).toEqual([{ id: corpo.id, utm_source: "manual" }]);
      } else {
        expect(r.status()).toBe(403);
        expect(linhas).toEqual([]);
      }
      // A tela também: botão só para admin e vendas; /leads/novo dá 403 para os outros.
      if (papel !== "leitura") {
        await page.goto("/leads");
        await expect(page.getByRole("link", { name: "Novo lead" })).toHaveCount(papel === "suporte" ? 0 : 1);
      }
      const tela = await page.goto("/leads/novo");
      expect(tela?.status()).toBe(papel === "admin" || papel === "vendas" ? 200 : 403);
    });
  }

  test("sem login 401; sem Origin 403; pedido malformado 400; validação 422; e-mail repetido 409", async ({ page }) => {
    expect((await criar(page, lead("x"))).status()).toBe(401);
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    expect((await criar(page, lead("x"), null)).status()).toBe(403);
    expect((await criar(page, lead("x"), "https://evil.example")).status()).toBe(403);
    expect((await criar(page, { nome: 1 })).status()).toBe(400);

    const invalido = await criar(page, { nome: "J", email: "sem-arroba", whatsapp: "123" });
    expect(invalido.status()).toBe(422);
    const corpo = await invalido.json();
    expect(Object.keys(corpo.erros).sort()).toEqual(["email", "nome", "whatsapp"]);

    // E-mail de lead do Vitor: 409 só com a mensagem.
    const alheio = leadsDe("vitor")[0];
    const r1 = await criar(page, { ...lead("y"), email: alheio.email.toUpperCase() });
    expect(r1.status()).toBe(409);
    const t1 = await r1.text();
    expect(JSON.parse(t1)).toEqual({ erro: "email_existente", mensagem: "Já existe um cadastro com este e-mail." });
    for (const dado of [alheio.id, alheio.nome, alheio.whatsapp]) expect(t1).not.toContain(dado);

    // E-mail de lead da própria Vera: 409 com o id para abrir a ficha.
    const proprio = leadsDe("vera")[0];
    const r2 = await criar(page, { ...lead("z"), email: proprio.email });
    expect(r2.status()).toBe(409);
    expect(await r2.json()).toEqual({ erro: "email_existente", mensagem: "Já existe um cadastro com este e-mail.", leadId: proprio.id });
  });

  test("lead da Vera: o Vitor recebe 404 na ficha e na API; o token não sai em nenhuma resposta", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    const { id } = await (await criar(page, lead("vera"))).json();
    const token = await tokenDe(id);
    for (const url of [`/leads/${id}`, `/api/leads/${id}`, "/api/leads", `/leads/${id}?novo=1`]) {
      expect(await (await page.request.get(url)).text()).not.toContain(token);
    }

    await page.context().clearCookies();
    await entrar(page, USUARIOS_TESTE.vitor.email);
    expect((await page.goto(`/leads/${id}`))?.status()).toBe(404);
    expect((await page.request.get(`/api/leads/${id}`)).status()).toBe(404);
    expect((await page.request.post(`/api/leads/${id}/link-ativacao`, { headers: { Origin: ORIGEM } })).status()).toBe(404);
    expect((await page.request.post(`/api/leads/${id}/link-ativacao?formato=mensagem`, { headers: { Origin: ORIGEM } })).status()).toBe(404);
  });
});

for (const largura of [360, 1280] as const) {
  test(`fluxo da tela em ${largura}px: vendas e admin cadastram, erros claros, ficha com link`, async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEM });
    await page.setViewportSize({ width: largura, height: largura === 1280 ? 860 : 800 });
    const erros: string[] = [];
    page.on("console", (m) => {
      // 422 e 409 são respostas esperadas deste fluxo (validação e e-mail repetido).
      if (m.type() === "error" && !/status of (409|422)\b/.test(m.text())) erros.push(m.text());
    });

    // ── Vendas ──
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await page.goto("/leads");
    await page.getByRole("link", { name: "Novo lead" }).click();
    await expect(page.getByRole("heading", { name: "Novo lead", level: 1 })).toBeVisible();
    await expect(page.getByText("O lead fica com você.")).toBeVisible();
    await expect(page.getByLabel("Responsável", { exact: true })).toHaveCount(0);
    await semCortes(page, "novo lead vendas");
    await axe(page, `novo lead vendas ${largura}`);
    await page.screenshot({ path: `docs/capturas/novo-lead-${largura}.png`, fullPage: true });

    // Enviar vazio: erros por campo, foco no primeiro.
    await page.getByRole("button", { name: "Cadastrar lead" }).click();
    await expect(page.getByText("Confira os 3 campos marcados abaixo.")).toBeVisible();
    await expect(page.getByLabel("Nome")).toBeFocused();
    await expect(page.getByLabel("Nome")).toHaveAttribute("aria-invalid", "true");

    // Pelo teclado: nome curto e WhatsApp inválido voltam do servidor.
    await page.keyboard.type("J");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("WhatsApp, com DDD")).toBeFocused();
    await page.keyboard.type("85 1234");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("E-mail")).toBeFocused();
    await page.keyboard.type(`nova.${largura}@exemplo.com.br`);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Nome muito curto: digite o nome completo.")).toBeVisible();
    await expect(page.getByText(/Digite um WhatsApp válido, com DDD/)).toBeVisible();
    await expect(page.getByLabel("Nome")).toBeFocused();
    await expect(page.getByLabel("Nome")).toHaveAccessibleDescription("Nome muito curto: digite o nome completo.");
    await semCortes(page, "novo lead com erros");
    await axe(page, `novo lead com erros ${largura}`);
    await page.screenshot({ path: `docs/capturas/novo-lead-erros-${largura}.png`, fullPage: true });

    // E-mail que já é de um lead dela: mensagem e link para a ficha.
    const proprio = leadsDe("vera")[0];
    await page.getByLabel("Nome").fill("Joana Manual");
    await page.getByLabel("WhatsApp, com DDD").fill("(85) 98888-1234");
    await page.getByLabel("E-mail").fill(proprio.email.toUpperCase());
    await page.getByRole("button", { name: "Cadastrar lead" }).click();
    await expect(page.getByText("Já existe um cadastro com este e-mail.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir a ficha desse lead" })).toHaveAttribute("href", `/leads/${proprio.id}`);
    await expect(page.getByLabel("E-mail")).toBeFocused();

    // Agora vai.
    await page.getByLabel("E-mail").fill(`joana.${largura}@exemplo.com.br`);
    await page.getByLabel("Anotação interna (opcional)").fill("Conheceu o ady na feira de Fortaleza.");
    await page.getByRole("button", { name: "Cadastrar lead" }).click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}\?novo=1$/);
    const id = page.url().match(/leads\/([0-9a-f-]{36})/)![1];
    await expect(page.getByRole("heading", { name: "Joana Manual", level: 1 })).toBeVisible();
    await expect(page.getByText("Lead cadastrado.")).toBeVisible();
    await expect(page.getByText("Cadastro manual", { exact: true })).toBeVisible();
    await expect(page.getByText("Responsável: Vera Vendas")).toBeVisible();
    const bloco = page.getByRole("region", { name: "Link de ativação" });
    await expect(bloco.getByText(/Vale até \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    await expect(page.getByText("Conheceu o ady na feira de Fortaleza.")).toBeVisible();
    const whatsapp = await page.getByRole("link", { name: /Abrir conversa no WhatsApp/ }).getAttribute("href");
    expect(decodeURIComponent(whatsapp!)).toContain("Oi, Joana! Aqui é Vera, do ady. Vou te ajudar a começar o teste grátis de 7 dias.");
    await semCortes(page, "ficha manual");
    await axe(page, `ficha manual ${largura}`);

    const token = await tokenDe(id);
    await bloco.getByRole("button", { name: "Copiar mensagem com o link" }).click();
    await expect(bloco.getByText("Mensagem copiada.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `Oi, Joana! Aqui é Vera, do ady. Esse é o link para ativar seu teste grátis de 7 dias: https://lp.useady.com.br/ativar-conta?t=${token}`,
    );
    await bloco.getByRole("button", { name: "Copiar link de ativação" }).click();
    await expect(bloco.getByText("Link copiado.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://lp.useady.com.br/ativar-conta?t=${token}`);
    expect(await page.content()).not.toContain(token);
    await page.screenshot({ path: `docs/capturas/ficha-manual-${largura}.png`, fullPage: true });

    const auditoria = await sql<{ acao: string; detalhe: unknown }>(
      "SELECT acao, detalhe FROM painel_auditoria WHERE lead_id = $1 AND acao IN ('criar_lead', 'copiar_link') ORDER BY id",
      [id],
    );
    expect(auditoria).toEqual([
      { acao: "criar_lead", detalhe: { via: "tela", responsavel_id: USUARIOS_TESTE.vera.id } },
      { acao: "copiar_link", detalhe: { formato: "mensagem" } },
      { acao: "copiar_link", detalhe: null },
    ]);

    // Volta para a lista: o lead está lá.
    await page.goto(`/leads?q=${encodeURIComponent("Joana Manual")}`);
    await expect(page.getByText("1 lead", { exact: true })).toBeVisible();

    // ── Admin: escolhe o responsável ──
    await page.context().clearCookies();
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto("/leads/novo");
    await expect(page.getByLabel("Responsável", { exact: true })).toHaveValue("");
    await expect(page.getByText("O lead fica com você.")).toHaveCount(0);
    await axe(page, `novo lead admin ${largura}`);
    await page.screenshot({ path: `docs/capturas/novo-lead-admin-${largura}.png`, fullPage: true });
    await page.getByLabel("Nome").fill("Pedro Manual");
    await page.getByLabel("WhatsApp, com DDD").fill("+55 11 3333-4444");
    await page.getByLabel("E-mail").fill(`pedro.${largura}@exemplo.com.br`);
    await page.getByLabel("Responsável", { exact: true }).selectOption({ label: "Vitor Vendas (Vendas)" });
    await page.getByRole("button", { name: "Cadastrar lead" }).click();
    await expect(page.getByRole("heading", { name: "Pedro Manual", level: 1 })).toBeVisible();
    await expect(page.getByText("Responsável: Vitor Vendas")).toBeVisible();
    expect(await sql("SELECT whatsapp FROM teste7d_inscricoes WHERE email = $1", [`pedro.${largura}@exemplo.com.br`])).toEqual([
      { whatsapp: "551133334444" },
    ]);

    expect(erros).toEqual([]);
  });
}

test("lead manual: fora do funil, da origem e do perfil, dentro do funil comercial (APIs)", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.admin);
  const ler = async (url: string) => (await page.request.get(url)).json();
  const antes = await ler("/api/funil?periodo=tudo");
  expect((await criar(page, lead("funil"))).status()).toBe(201);
  expect((await ler("/api/funil?periodo=tudo")).resumo).toEqual(antes.resumo);
  expect((await ler("/api/funil/origem?periodo=tudo")).total.cadastros).toBe(LEADS.length);
  expect((await ler("/api/perfil?periodo=tudo")).cadastros).toBe(LEADS.length);
  expect((await ler("/api/funil/comercial?periodo=tudo")).total).toBe(LEADS.length + 1);
  expect((await ler("/api/leads")).total).toBe(LEADS.length + 1);
});

test.afterAll(async () => {
  // O token de nenhum lead (nem dos criados aqui) vai para o log do servidor.
  const log = await readFile(LOG_SERVIDOR, "utf8");
  const tokens = await sql<{ token_retomada: string }>("SELECT token_retomada FROM teste7d_inscricoes");
  for (const { token_retomada } of tokens) expect(log).not.toContain(token_retomada);
});
