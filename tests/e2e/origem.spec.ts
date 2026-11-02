import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { LEADS, USUARIOS_TESTE } from "../fixtures/leads";
import { EMAIL_NO_UTM, HTML_MALICIOSO, pessoalOrigem, semearOrigem, TOTAL_ORIGEM } from "../fixtures/origem";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

const ORIGEM = "http://localhost:3100";
const TELA = "/funil?de=2026-10-01&ate=2026-10-31";
const API = "/api/funil/origem?de=2026-10-01&ate=2026-10-31";

const PESSOAIS = [
  ...Array.from({ length: TOTAL_ORIGEM }, (_, n) => pessoalOrigem(n)).flat(),
  `tokenorigem${"0".repeat(20)}1`,
  ...LEADS.flatMap((l) => [l.email, l.whatsapp, l.token]),
];
function semPessoais(texto: string, onde: string) {
  for (const s of PESSOAIS) expect(texto, `${onde} contém ${s}`).not.toContain(s);
}

/** Largura que a página rola além da janela (0 = não rola na horizontal). */
const excesso = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.beforeEach(async () => {
  await prepararEquipe();
  await semearOrigem(sql);
});

for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
  test(`API e tela para ${papel}`, async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL[papel]);
    const api = await page.request.get(API);
    expect(api.status()).toBe(200);
    const corpo = await api.text();
    semPessoais(corpo, `API (${papel})`);
    expect(corpo).not.toContain(EMAIL_NO_UTM);
    const json = JSON.parse(corpo);

    if (papel === "leitura") {
      // Na API, não só no HTML.
      expect(json.linhas.every((l: { cadastros: number }) => l.cadastros >= 5)).toBe(true);
      expect(corpo).not.toContain("ad17");
      expect(corpo).not.toContain("tiktok");
      expect(json.outras.cadastros).toBe(6);
    } else {
      expect(corpo).toContain("ad17");
    }

    const exportar = await page.request.post("/api/funil/origem/exportar", {
      headers: { Origin: ORIGEM },
      form: { de: "2026-10-01", ate: "2026-10-31" },
    });
    expect(exportar.status()).toBe(papel === "admin" ? 200 : 403);

    const tela = await page.request.get(TELA);
    semPessoais(await tela.text(), `HTML (${papel})`);
    await page.goto(TELA);
    await expect(page.getByRole("heading", { name: "Origem dos leads" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar origem (CSV)" })).toHaveCount(papel === "admin" ? 1 : 0);
    await expect(page.getByText("“Agendou” pode estar subestimado (agendado_em vem do navegador da pessoa).")).toBeVisible();
    await expect(page.getByText("a campanha é o identificador do anúncio")).toBeVisible();
    semPessoais(await page.content(), `DOM (${papel})`);
    if (papel === "leitura") {
      await expect(page.getByRole("rowheader", { name: "Outras origens" })).toBeVisible();
      // Nem na lista do corte.
      await expect(page.getByLabel("Campanha (utm_campaign)").locator("option", { hasText: "ad17" })).toHaveCount(0);
    }
  });
}

test("sem login: 401 e exportação com outra origem recusada", async ({ page }) => {
  expect((await page.request.get(API)).status()).toBe(401);
  expect((await page.request.post("/api/funil/origem/exportar", { headers: { Origin: ORIGEM } })).status()).toBe(401);
  await entrar(page, EMAIL_DO_PAPEL.admin);
  const fora = await page.request.post("/api/funil/origem/exportar", { headers: { Origin: "https://mal.example" }, form: {} });
  expect(fora.status()).toBe(403);
});

test("HTML no UTM aparece como texto e não executa", async ({ page }) => {
  let alerta = false;
  page.on("dialog", (d) => {
    alerta = true;
    void d.dismiss();
  });
  await entrar(page, EMAIL_DO_PAPEL.admin);
  await page.goto(TELA);
  await expect(page.getByRole("rowheader", { name: HTML_MALICIOSO.toLowerCase() })).toBeVisible();
  await expect(page.locator("section img[src='x']")).toHaveCount(0);
  expect(alerta).toBe(false);
  expect(await (await page.request.get(TELA)).text()).not.toContain("<img src=x");
});

test("visões, filtro por clique, ordenação e CSV com auditoria", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.admin);
  await page.goto(TELA);
  await page.getByRole("link", { name: "Por source", exact: true }).click();
  await expect(page).toHaveURL(/vo=source/);
  const regiao = page.getByRole("region", { name: "Tabela de origem" });
  await expect(regiao.getByRole("columnheader", { name: "Medium" })).toHaveCount(0);

  await regiao.getByRole("link", { name: "Filtrar por meta" }).click();
  await expect(page).toHaveURL(/origem=meta/);
  await expect(page.getByText(/origem meta/)).toBeVisible();
  // O resto da tela acompanha: KPI de cadastros.
  await expect(page.locator("dl > div").filter({ hasText: "Cadastros" }).first()).toContainText("21");

  await regiao.getByRole("link", { name: /^Cadastros/ }).click();
  await expect(page).toHaveURL(/oo=cadastros.*odo=asc|odo=asc.*oo=cadastros/);

  await page.goto(TELA);
  const espera = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar origem (CSV)" }).click();
  const baixado = await espera;
  expect(baixado.suggestedFilename()).toMatch(/^funil-origem-\d{4}-\d{2}-\d{2}\.csv$/);

  const auditoria = await sql<{ usuario_id: string; detalhe: { filtros: Record<string, string>; linhas: number } }>(
    "SELECT usuario_id, detalhe FROM painel_auditoria WHERE acao = 'exportar_origem'",
  );
  expect(auditoria).toHaveLength(1);
  expect(auditoria[0].usuario_id).toBe(USUARIOS_TESTE.ana.id);
  expect(auditoria[0].detalhe.filtros).toMatchObject({ de: "2026-10-01" });
  const { pagina } = await (await page.request.get(API)).json();
  expect(auditoria[0].detalhe.linhas).toBe(pagina.linhasNoTotal);
});

test("ficha mostra source, medium, campaign e só o caminho da entrada", async ({ page }) => {
  const lead = LEADS[0];
  await sql("UPDATE teste7d_inscricoes SET utm_source = 'meta', utm_medium = 'ga2', utm_campaign = 'ad16', landing_url = $2 WHERE id = $1", [
    lead.id,
    "https://lp.useady.com.br/?utm_source=meta&email=vazou%40exemplo.com",
  ]);
  await entrar(page, EMAIL_DO_PAPEL.admin);
  await page.goto(`/leads/${lead.id}`);
  const bloco = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Origem", exact: true }) }).last();
  await expect(bloco.getByText("Fonte (utm_source)")).toBeVisible();
  await expect(bloco.getByText("Meio (utm_medium)")).toBeVisible();
  await expect(bloco.getByText("Campanha (utm_campaign)")).toBeVisible();
  expect(await page.content()).not.toContain("vazou");
  const api = await page.request.get(`/api/leads/${lead.id}`);
  const corpo = await api.text();
  expect(corpo).not.toContain("vazou");
  expect(corpo).not.toContain("landing_url");
});

for (const largura of [360, 390, 1280]) {
  test(`sem rolagem nem corte em ${largura}, e capturas`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 860 });
    await sql("UPDATE teste7d_inscricoes SET utm_campaign = repeat('campanha-sem-espaco-', 12) WHERE utm_source = 'Google'");
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto(TELA);
    await expect(page.locator(".recharts-surface")).toHaveCount(2);
    expect(await excesso(page)).toBeLessThanOrEqual(0);
    if (largura !== 390) {
      await page.getByRole("heading", { name: "Origem dos leads" }).scrollIntoViewIfNeeded();
      const secao = page.locator("section").filter({ has: page.getByRole("heading", { name: "Origem dos leads" }) });
      await secao.screenshot({ path: `docs/capturas/origem-${largura}.png` });
    }
  });
}

test("texto a 200% sem rolagem da página", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await entrar(page, EMAIL_DO_PAPEL.admin);
  await page.goto(TELA);
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  expect(await excesso(page)).toBeLessThanOrEqual(0);
});

test("axe sem violações", async ({ page }) => {
  test.setTimeout(180_000);
  for (const [papel, largura] of [["admin", 390], ["admin", 1280], ["leitura", 1280]] as const) {
    await page.context().clearCookies();
    await page.setViewportSize({ width: largura, height: 860 });
    await entrar(page, EMAIL_DO_PAPEL[papel]);
    for (const caminho of [TELA, `${TELA}&vo=campaign`, "/funil?de=2020-01-01&ate=2020-01-07"]) {
      await page.goto(caminho);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      expect(r.violations.map((v) => `${papel} ${largura} ${caminho}: ${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
    }
  }
});

test("Lighthouse: acessibilidade 100 com o bloco de origem", async ({ page, context }) => {
  test.setTimeout(180_000);
  await entrar(page, EMAIL_DO_PAPEL.admin);
  const cookie = (await context.cookies())
    .filter((c) => c.name.includes("painel."))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
  try {
    for (const formFactor of ["mobile", "desktop"] as const) {
      const r = await lighthouse(`http://localhost:3100${TELA}`, {
        port: chrome.port,
        onlyCategories: ["accessibility"],
        output: "json",
        logLevel: "error",
        formFactor,
        screenEmulation:
          formFactor === "mobile"
            ? { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false }
            : { mobile: false, width: 1280, height: 860, deviceScaleFactor: 1, disabled: false },
        extraHeaders: { Cookie: cookie },
      });
      const falhas = Object.values(r!.lhr.audits).filter((a) => a.score === 0 && a.scoreDisplayMode === "binary").map((a) => a.id);
      expect(falhas, formFactor).toEqual([]);
      expect(Math.round((r!.lhr.categories.accessibility.score ?? 0) * 100), formFactor).toBe(100);
    }
  } finally {
    chrome.kill();
  }
});
