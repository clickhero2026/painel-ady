import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { leadsDe } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

/**
 * Capturas (docs/capturas), larguras de celular e desktop, texto a 200%,
 * axe e checagens de teclado. Lighthouse fica em lighthouse.spec.ts.
 */

const LARGURAS = [360, 390, 1280] as const;
const LEAD = leadsDe("vera")[2]; // ativação preenchida: ficha com respostas

function vigiarConsole(page: Page) {
  const erros: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") erros.push(msg.text());
  });
  return erros;
}

/** Sem rolagem horizontal e nenhum texto cortado (elemento mais largo que a própria caixa). */
async function semCortes(page: Page) {
  const problemas = await page.evaluate(() => {
    const achados: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) {
      achados.push(`página rola na horizontal: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden" || el.closest(".sr-only")) continue;
      if (!["hidden", "clip"].includes(estilo.overflowX)) continue;
      if (el.scrollWidth > el.clientWidth + 1) achados.push(`cortado: <${el.tagName.toLowerCase()}> "${el.innerText.slice(0, 40)}"`);
    }
    return achados;
  });
  expect(problemas).toEqual([]);
}

/** Os gráficos do funil desenham só no navegador, depois do HTML. */
async function graficosProntos(page: Page) {
  await expect(page.locator(".recharts-surface")).toHaveCount(2);
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
}

test.beforeEach(async () => {
  await prepararEquipe();
  // Um lead com observação longa e sem espaços, pra testar quebra de linha.
  await sql("UPDATE teste7d_inscricoes SET observacoes = $2 WHERE id = $1", [
    LEAD.id,
    "Prefere falar depois das 18h. Site: https://www.exemplo-de-endereco-muito-comprido.com.br/pagina/produto?id=123456789",
  ]);
});

for (const largura of LARGURAS) {
  test(`telas em ${largura}px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: largura === 1280 ? 860 : 800 });
    const erros = vigiarConsole(page);
    const capturar = [360, 1280].includes(largura);

    await page.goto("/login");
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/login-${largura}.png`, fullPage: true });

    await entrar(page, EMAIL_DO_PAPEL.admin);
    await expect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/inicio-${largura}.png`, fullPage: true });

    await page.goto("/leads");
    await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/leads-${largura}.png`, fullPage: true });

    await page.goto(`/leads/${LEAD.id}`);
    await expect(page.getByRole("heading", { name: LEAD.nome, level: 1 })).toBeVisible();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/ficha-${largura}.png`, fullPage: true });

    await page.goto("/funil");
    await expect(page.getByRole("heading", { name: "Funil", level: 1 })).toBeVisible();
    await graficosProntos(page);
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/funil-${largura}.png`, fullPage: true });

    await page.goto("/perfil?periodo=tudo");
    await expect(page.getByRole("heading", { name: "Perfil dos leads", level: 1 })).toBeVisible();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/perfil-${largura}.png`, fullPage: true });

    await page.goto("/usuarios");
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/usuarios-${largura}.png`, fullPage: true });

    if (largura === 360) {
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Leads" })).toBeVisible();
      await page.screenshot({ path: `docs/capturas/menu-${largura}.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
    }

    expect(erros).toEqual([]);
  });
}

test("texto a 200% sem cortar (1280px)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await entrar(page, EMAIL_DO_PAPEL.admin);
  for (const caminho of ["/", "/leads", `/leads/${LEAD.id}`, "/funil", "/perfil?periodo=tudo", "/usuarios"]) {
    await page.goto(caminho);
    if (caminho === "/funil") await graficosProntos(page);
    // Pelo CSSOM: a CSP do painel bloqueia <style> injetado.
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
    // Os gráficos se medem de novo (ResizeObserver) depois da troca de fonte.
    if (caminho === "/funil") {
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".recharts-wrapper")].every(
          (g) =>
            g.getBoundingClientRect().width <=
            g.closest(".recharts-responsive-container")!.getBoundingClientRect().width + 1,
        ),
      );
    }
    await semCortes(page);
  }
});

test("axe sem violações (WCAG 2.2 AA) em todas as telas", async ({ page }) => {
  test.setTimeout(300_000);
  const telas: [string, string][] = [["login", "/login"]];
  const verificar = async (nome: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(r.violations.map((v) => `${nome}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  for (const largura of [390, 1280]) {
    await page.setViewportSize({ width: largura, height: 860 });
    await page.context().clearCookies();
    for (const [nome, caminho] of telas) {
      await page.goto(caminho);
      await verificar(`${nome} ${largura}`);
    }
    await entrar(page, EMAIL_DO_PAPEL.admin);
    for (const [nome, caminho] of [
      ["início", "/"],
      ["leads", "/leads"],
      ["leads parados", "/leads?visao=parados"],
      ["ficha", `/leads/${LEAD.id}`],
      ["funil", "/funil"],
      ["funil vazio", "/funil?de=2020-01-01&ate=2020-01-07"],
      ["perfil", "/perfil?periodo=tudo"],
      ["perfil vazio", "/perfil?de=2020-01-01&ate=2020-01-07"],
      ["usuários", "/usuarios"],
      ["404", "/nao-existe"],
      ["404 de lead", "/leads/00000000-0000-4000-8000-999999999999"],
    ]) {
      await page.goto(caminho);
      if (caminho === "/funil") await graficosProntos(page);
      await verificar(`${nome} ${largura}`);
    }
  }
  // 403 visto por quem não tem acesso.
  await page.context().clearCookies();
  await entrar(page, EMAIL_DO_PAPEL.leitura);
  await page.goto("/leads");
  await verificar("403");
  // Perfil com células ocultas.
  await page.goto("/perfil?periodo=tudo");
  await verificar("perfil leitura");
});

test("teclado: pular para o conteúdo e navegar pelo login", async ({ page }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Entrar com Google" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("E-mail")).toBeFocused();

  await entrar(page, EMAIL_DO_PAPEL.admin);
  await page.keyboard.press("Tab");
  const pular = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(pular).toBeFocused();
  await expect(pular).toBeVisible();
});

test("teclado: copiar link na ficha sem mouse", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3100" });
  await entrar(page, EMAIL_DO_PAPEL.suporte);
  await page.goto(`/leads/${LEAD.id}`);
  await page.getByRole("button", { name: "Copiar link de ativação" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Link copiado.")).toBeVisible();
});
