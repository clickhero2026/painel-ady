import { expect, test, type Page } from "@playwright/test";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe } from "./apoio";

/**
 * Capturas das telas em 360 e 1280 de largura (docs/capturas) e checagens
 * de acessibilidade básicas: sem erro de CSP no console, sem rolagem
 * horizontal no celular, teclado funcionando.
 */

const LARGURAS = [360, 1280] as const;

function vigiarConsole(page: Page) {
  const erros: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") erros.push(msg.text());
  });
  return erros;
}

async function semRolagemHorizontal(page: Page) {
  const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(larguras[0]).toBeLessThanOrEqual(larguras[1]);
}

test.beforeEach(async () => {
  await prepararEquipe();
});

for (const largura of LARGURAS) {
  test(`capturas em ${largura}px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: largura === 360 ? 780 : 860 });
    const erros = vigiarConsole(page);

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Entrar no painel" })).toBeVisible();
    await semRolagemHorizontal(page);
    await page.screenshot({ path: `docs/capturas/login-${largura}.png`, fullPage: true });

    await entrar(page, EMAIL_DO_PAPEL.admin);
    await expect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();
    await semRolagemHorizontal(page);
    await page.screenshot({ path: `docs/capturas/inicio-${largura}.png`, fullPage: true });

    await page.goto("/usuarios");
    await expect(page.getByRole("heading", { name: "Usuários", level: 1 })).toBeVisible();
    await semRolagemHorizontal(page);
    await page.screenshot({ path: `docs/capturas/usuarios-${largura}.png`, fullPage: true });

    if (largura === 360) {
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Usuários" })).toBeVisible();
      await page.screenshot({ path: `docs/capturas/menu-${largura}.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
    }

    expect(erros).toEqual([]);
  });
}

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
