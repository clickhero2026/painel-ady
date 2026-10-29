import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { LEADS, leadsDe } from "../fixtures/leads";
import { LOG_SERVIDOR } from "../../playwright.config";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

const PROPRIO = leadsDe("vera")[0]; // da Vera (vendas)
const ALHEIO = leadsDe("vitor")[0]; // do Vitor (vendas)
const ORIGEM = "http://localhost:3100";
const TOKENS = LEADS.map((l) => l.token);
const SENSIVEIS = ["IPHASH-SECRETO", "UA-SECRETO", "FBCLID-SECRETO", ...TOKENS];

test.beforeEach(async () => {
  await prepararEquipe();
});

function semSensiveis(texto: string, onde: string) {
  for (const s of SENSIVEIS) expect(texto, `${onde} contém ${s}`).not.toContain(s);
}

async function status(page: Page, caminho: string) {
  return (await page.request.get(caminho, { maxRedirects: 0 })).status();
}

async function statusLink(page: Page, id: string) {
  return (await page.request.post(`/api/leads/${id}/link-ativacao`, { headers: { Origin: ORIGEM } })).status();
}

test.describe("cada papel contra cada rota e cada API", () => {
  // [/, /leads, ficha própria da Vera, ficha alheia, /usuarios]
  const paginas = {
    admin: [200, 200, 200, 200, 200],
    suporte: [200, 200, 200, 200, 403],
    vendas: [200, 200, 200, 404, 403],
    leitura: [200, 403, 403, 403, 403],
  } as const;
  // [GET /api/leads, GET ficha própria, GET ficha alheia, POST link próprio, POST link alheio]
  const apis = {
    admin: [200, 200, 200, 200, 200],
    suporte: [200, 200, 200, 200, 200],
    vendas: [200, 200, 404, 200, 404],
    leitura: [403, 403, 403, 403, 403],
  } as const;

  for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
    test(papel, async ({ page }) => {
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      const rotas = ["/", "/leads", `/leads/${PROPRIO.id}`, `/leads/${ALHEIO.id}`, "/usuarios"];
      const obtidos = [];
      for (const rota of rotas) obtidos.push(await status(page, rota));
      expect(obtidos).toEqual(paginas[papel]);

      const daApi = [
        await status(page, "/api/leads"),
        await status(page, `/api/leads/${PROPRIO.id}`),
        await status(page, `/api/leads/${ALHEIO.id}`),
        await statusLink(page, PROPRIO.id),
        await statusLink(page, ALHEIO.id),
      ];
      expect(daApi).toEqual(apis[papel]);

      const menu = page.getByRole("navigation", { name: "Principal" });
      await page.goto("/");
      await expect(menu.getByRole("link", { name: "Leads" })).toHaveCount(papel === "leitura" ? 0 : 1);
    });
  }

  test("sem login: páginas vão pro login e APIs dão 401", async ({ page }) => {
    expect(await status(page, "/leads")).toBe(307);
    expect(await status(page, `/leads/${PROPRIO.id}`)).toBe(307);
    expect(await status(page, "/api/leads")).toBe(401);
    expect(await status(page, `/api/leads/${PROPRIO.id}`)).toBe(401);
    expect(await statusLink(page, PROPRIO.id)).toBe(401);
  });

  test("link de ativação só com Origin do painel (POST de outro site é recusado)", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.admin);
    const r = await page.request.post(`/api/leads/${PROPRIO.id}/link-ativacao`, { headers: { Origin: "https://evil.example" } });
    expect(r.status()).toBe(403);
    expect(await sql("SELECT 1 FROM painel_auditoria WHERE acao = 'copiar_link'")).toHaveLength(0);
  });
});

test.describe("vendedor tentando ler lead alheio", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.vendas);
  });

  test("URL direta: página 404, igual a um lead que não existe", async ({ page }) => {
    const r = await page.goto(`/leads/${ALHEIO.id}`);
    expect(r?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await expect(page.getByText(ALHEIO.nome)).toHaveCount(0);
  });

  test("API: 404 na ficha e no link; a lista não traz o lead nem com filtro", async ({ page }) => {
    const ficha = await page.request.get(`/api/leads/${ALHEIO.id}`);
    expect(ficha.status()).toBe(404);
    expect(await ficha.json()).toEqual({ erro: "nao_encontrado" });
    const lista = await (await page.request.get(`/api/leads?q=${encodeURIComponent(ALHEIO.nome)}`)).json();
    expect(lista.total).toBe(0);
    const porResponsavel = await (await page.request.get(`/api/leads?responsavel=10000000-0000-4000-8000-000000000004`)).json();
    expect(porResponsavel.total).toBe(leadsDe("vera").length);
  });

  test("busca na tela por nome, e-mail e WhatsApp do lead alheio: nada", async ({ page }) => {
    for (const termo of [ALHEIO.nome, ALHEIO.email, ALHEIO.whatsapp.slice(-8)]) {
      await page.goto(`/leads?q=${encodeURIComponent(termo)}`);
      await expect(page.getByText("Nenhum lead encontrado com estes filtros.")).toBeVisible();
    }
  });

  test("lista mostra só os 12 dela e sem filtro de responsável", async ({ page }) => {
    await page.goto("/leads");
    await expect(page.getByText(`${leadsDe("vera").length} leads`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Responsável")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sem responsável" })).toHaveCount(0);
  });
});

test.describe("token de ativação", () => {
  test("não aparece no HTML, nas respostas da API nem nos logs; vai só para a área de transferência", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEM });
    await entrar(page, EMAIL_DO_PAPEL.admin);

    semSensiveis(await (await page.request.get("/leads")).text(), "HTML da lista");
    semSensiveis(await (await page.request.get(`/leads/${PROPRIO.id}`)).text(), "HTML da ficha");
    semSensiveis(await (await page.request.get("/api/leads")).text(), "API da lista");
    semSensiveis(await (await page.request.get(`/api/leads/${PROPRIO.id}`)).text(), "API da ficha");

    await page.goto(`/leads/${PROPRIO.id}`);
    await page.getByRole("button", { name: "Copiar link de ativação" }).click();
    await expect(page.getByText("Link copiado.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `https://lp.useady.com.br/ativar-conta?t=${PROPRIO.token}`,
    );
    semSensiveis(await page.content(), "página depois de copiar");
  });

  test.afterAll(async () => {
    semSensiveis(await readFile(LOG_SERVIDOR, "utf8"), "log do servidor");
  });
});

test.describe("auditoria", () => {
  test("abrir ficha grava ver_lead; copiar link grava copiar_link (sem o token)", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEM });
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await page.goto(`/leads/${PROPRIO.id}`);
    await page.getByRole("button", { name: "Copiar link de ativação" }).click();
    await expect(page.getByText("Link copiado.")).toBeVisible();
    await page.goto(`/leads/${ALHEIO.id}`); // 404: não grava

    const linhas = await sql<{ acao: string; lead_id: string; detalhe: unknown }>(
      "SELECT acao, lead_id, detalhe FROM painel_auditoria WHERE acao IN ('ver_lead', 'copiar_link') ORDER BY id",
    );
    expect(linhas).toEqual([
      { acao: "ver_lead", lead_id: PROPRIO.id, detalhe: { via: "tela" } },
      { acao: "copiar_link", lead_id: PROPRIO.id, detalhe: null },
    ]);
  });

  test("a lista não grava ver_lead (nem por pré-carregamento dos links)", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto("/leads");
    await page.getByRole("link", { name: LEADS[0].nome }).first().hover();
    await page.waitForTimeout(500);
    expect(await sql("SELECT 1 FROM painel_auditoria WHERE acao = 'ver_lead'")).toHaveLength(0);
  });
});

test.describe("lista: filtros, ordem e paginação", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, EMAIL_DO_PAPEL.admin);
  });

  test("30 leads em 2 páginas", async ({ page }) => {
    await page.goto("/leads");
    await expect(page.getByText("30 leads", { exact: true })).toBeVisible();
    await expect(page.getByText("Página 1 de 2")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(25);
    await page.getByRole("link", { name: "Próxima" }).click();
    await expect(page.getByText("Página 2 de 2")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(5);
  });

  test("filtro pelo formulário (criativo + versão) e limpar", async ({ page }) => {
    await page.goto("/leads");
    await page.getByText("Filtros e ordem").click();
    await page.getByLabel("Criativo").selectOption("T7D-R1-H02-IMG");
    await page.getByLabel("Versão do título").selectOption("B");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    const esperados = LEADS.filter((l) => l.utm_content === "T7D-R1-H02-IMG" && l.lp_variant === "B");
    await expect(page.getByText(`${esperados.length} leads`, { exact: true })).toBeVisible();
    await expect(page.getByText("Filtros e ordem (2 ativos)")).toBeVisible();
    await page.getByRole("link", { name: "Limpar" }).click();
    await expect(page.getByText("30 leads", { exact: true })).toBeVisible();
  });

  test("ordenar pelo cabeçalho da tabela", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("link", { name: "Nome" }).click();
    await expect(page.getByRole("columnheader", { name: "Nome" })).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("table tbody tr").first()).toContainText("Alice Ramos");
  });

  test("visões prontas", async ({ page }) => {
    await page.goto("/leads");
    const visoes = page.getByRole("navigation", { name: "Visões" });
    await visoes.getByRole("link", { name: "Cadastros parados" }).click();
    await expect(page.getByRole("columnheader", { name: "Parado há" })).toBeVisible();
    await visoes.getByRole("link", { name: "Sem responsável" }).click();
    await expect(page.getByText(`${leadsDe(null).length + leadsDe("inativo").length} leads em “Sem responsável”`)).toBeVisible();
    await visoes.getByRole("link", { name: "Agendados esta semana" }).click();
    await expect(page.getByText("Sem dados de reunião ainda.")).toBeVisible();
  });
});

test.describe("ficha", () => {
  test("campos de reunião vazios aparecem como 'sem dados'", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    await page.goto("/leads");
    await expect(page.locator("table tbody tr").first().getByText("sem dados")).toBeVisible();
    await page.goto(`/leads/${PROPRIO.id}`);
    const linha = page.getByRole("listitem").filter({ hasText: /^Reunião/ });
    await expect(linha.first()).toContainText("sem dados");
  });

  test("chave sem mapa aparece crua, sem quebrar a tela", async ({ page }) => {
    const lead = LEADS.find((l) => l.acesso_redes)!;
    await sql("UPDATE teste7d_inscricoes SET acesso_redes = 'chave_nova', experiencia_anuncios = 'outra_chave' WHERE id = $1", [lead.id]);
    await entrar(page, EMAIL_DO_PAPEL.admin);
    const r = await page.goto(`/leads/${lead.id}`);
    expect(r?.status()).toBe(200);
    // No checklist e no bloco de redes.
    await expect(page.getByText("chave_nova (resposta sem texto cadastrado)")).toHaveCount(2);
    await expect(page.getByText("Não classificado")).toBeVisible();
    await expect(page.getByText("outra_chave")).toBeVisible();
  });

  test("cabeçalho, WhatsApp com mensagem pronta, checklist e nada de dado sensível", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto(`/leads/${PROPRIO.id}`);
    await expect(page.getByRole("heading", { level: 1, name: PROPRIO.nome })).toBeVisible();
    const whats = page.getByRole("link", { name: /Abrir conversa no WhatsApp/ });
    const href = decodeURIComponent((await whats.getAttribute("href"))!);
    expect(href).toContain(`https://wa.me/${PROPRIO.whatsapp}?text=`);
    expect(href).toContain(`Oi, ${PROPRIO.nome.split(" ")[0]}! Aqui é Ana, do ady.`);
    await expect(page.getByRole("heading", { name: "Prontidão para o onboarding" })).toBeVisible();
    semSensiveis(await page.content(), "ficha");
  });
});
