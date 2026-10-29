import { expect, test } from "@playwright/test";
import { EMAIL_DO_PAPEL, entrar, linkMaisNovo, prepararEquipe, sql } from "./apoio";

test.beforeEach(async () => {
  await prepararEquipe();
});

test.describe("sem login", () => {
  test("toda página manda pro login, guardando o destino", async ({ page }) => {
    await page.goto("/usuarios");
    await expect(page).toHaveURL("/login?voltar=%2Fusuarios");
    await page.goto("/");
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "Entrar no painel" })).toBeVisible();
  });

  test("APIs respondem 401", async ({ request }) => {
    const resposta = await request.get("/api/qualquer-coisa", { maxRedirects: 0 });
    expect(resposta.status()).toBe(401);
    expect(await resposta.json()).toEqual({ erro: "nao_autenticado" });
  });

  test("cabeçalhos de segurança e noindex em páginas e APIs", async ({ request }) => {
    for (const caminho of ["/login", "/api/auth/get-session"]) {
      const resposta = await request.get(caminho);
      const h = resposta.headers();
      expect(h["x-robots-tag"]).toContain("noindex");
      expect(h["referrer-policy"]).toBe("no-referrer");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
    }
    const csp = (await request.get("/login")).headers()["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
  });
});

test.describe("acesso por papel (inclusive pela URL direta)", () => {
  for (const [papel, email] of Object.entries(EMAIL_DO_PAPEL)) {
    test(`${papel}`, async ({ page }) => {
      await entrar(page, email);
      await expect(page).toHaveURL("/");
      const menu = page.getByRole("navigation", { name: "Principal" });
      await expect(menu.getByRole("link", { name: "Início" })).toBeVisible();

      const resposta = await page.goto("/usuarios");
      if (papel === "admin") {
        expect(resposta?.status()).toBe(200);
        await expect(page.getByRole("heading", { name: "Usuários", level: 1 })).toBeVisible();
        await expect(menu.getByRole("link", { name: "Usuários" })).toBeVisible();
      } else {
        expect(resposta?.status()).toBe(403);
        await expect(page.getByRole("heading", { name: "Você não tem acesso a esta página" })).toBeVisible();
        await page.goto("/");
        await expect(menu.getByRole("link", { name: "Usuários" })).toHaveCount(0);
      }
    });
  }

  test("o papel vale na hora, lido do banco (não da sessão)", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    expect((await page.goto("/usuarios"))?.status()).toBe(403);
    await sql("UPDATE painel_usuarios SET papel = 'admin' WHERE email = $1", [EMAIL_DO_PAPEL.suporte]);
    expect((await page.goto("/usuarios"))?.status()).toBe(200);
    await sql("UPDATE painel_usuarios SET papel = 'leitura' WHERE email = $1", [EMAIL_DO_PAPEL.suporte]);
    expect((await page.goto("/usuarios"))?.status()).toBe(403);
  });

  test("ação de admin chamada por quem não é admin é recusada no servidor", async ({ page }) => {
    // Admin abre a tela; no meio do caminho vira "leitura" e tenta adicionar alguém.
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto("/usuarios");
    await sql("UPDATE painel_usuarios SET papel = 'leitura' WHERE email = $1", [EMAIL_DO_PAPEL.admin]);
    await page.getByLabel("E-mail").fill("furao@useady.com.br");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByRole("heading", { name: "Você não tem acesso a esta página" })).toBeVisible();
    expect(await sql("SELECT 1 FROM painel_usuarios WHERE email = 'furao@useady.com.br'")).toHaveLength(0);
  });

  test("página que não existe mostra 404", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.leitura);
    const resposta = await page.goto("/nao-existe");
    expect(resposta?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  });
});

test.describe("login pela tela", () => {
  test("e-mail fora da lista vê exatamente a mesma resposta", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("intruso@useady.com.br");
    await page.getByRole("button", { name: "Enviar link de acesso" }).click();
    await expect(page.getByText("Se este e-mail tiver acesso ao painel")).toBeVisible();
    expect(await linkMaisNovo("intruso@useady.com.br", 0)).toBeNull();
  });

  test("link reutilizado e link vencido mostram aviso e não entram", async ({ page, context }) => {
    const link = await entrar(page, EMAIL_DO_PAPEL.vendas);
    await expect(page).toHaveURL("/");
    await context.clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?error=INVALID_TOKEN/);
    await expect(page.getByText("Este link de acesso venceu ou já foi usado")).toBeVisible();
  });

  test("recusa do Google mostra a mensagem neutra", async ({ page }) => {
    await page.goto("/login?error=unable_to_create_user");
    await expect(page.getByText("Não foi possível entrar com este e-mail.")).toBeVisible();
  });

  test("volta para a página pedida depois do login", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.admin, "/usuarios");
    await expect(page).toHaveURL("/usuarios");
  });

  test("sair encerra a sessão", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.leitura);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL("/login");
    await page.goto("/");
    await expect(page).toHaveURL("/login");
    expect(await sql("SELECT 1 FROM painel_auth_session")).toHaveLength(0);
    expect(await sql("SELECT 1 FROM painel_auditoria WHERE acao = 'logout'")).toHaveLength(1);
  });

  test("cookie de sessão httpOnly e Secure", async ({ page, context }) => {
    await entrar(page, EMAIL_DO_PAPEL.leitura);
    const cookie = (await context.cookies()).find((c) => c.name.endsWith("painel.session_token"));
    expect(cookie?.name).toBe("__Secure-painel.session_token");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
  });
});

test.describe("sessão", () => {
  test("8 horas sem uso: volta pro login com aviso e o cookie é apagado", async ({ page, context }) => {
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await sql("UPDATE painel_auth_session SET expires_at = now() - interval '1 minute'");
    await page.goto("/");
    await expect(page).toHaveURL("/login?motivo=expirada");
    await expect(page.getByText("Sua sessão expirou")).toBeVisible();
    expect((await context.cookies()).filter((c) => c.name.endsWith("session_token"))).toEqual([]);
  });

  test("7 dias depois do login: pede login de novo mesmo em uso", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await sql("UPDATE painel_auth_session SET created_at = now() - interval '7 days 1 minute'");
    await page.goto("/");
    await expect(page).toHaveURL("/login?motivo=expirada");
    expect(await sql("SELECT 1 FROM painel_auth_session")).toHaveLength(0);
  });

  test("uso renova a validade e o cookie", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await sql("UPDATE painel_auth_session SET expires_at = now() + interval '1 hour'");
    await page.goto("/");
    const [linha] = await sql<{ horas: number }>(
      "SELECT extract(epoch FROM expires_at - now()) / 3600 AS horas FROM painel_auth_session",
    );
    expect(Number(linha.horas)).toBeGreaterThan(7.9);
  });

  test("quem é desativado cai na próxima requisição", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    await sql("UPDATE painel_usuarios SET ativo = false WHERE email = $1", [EMAIL_DO_PAPEL.suporte]);
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});
