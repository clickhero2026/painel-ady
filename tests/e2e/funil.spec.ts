import { expect, test } from "@playwright/test";
import { LEADS, USUARIOS_TESTE } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

const ORIGEM = "http://localhost:3100";
/** Nada disto pode aparecer na tela do funil, na API nem no CSV. */
const PESSOAIS = [
  ...LEADS.flatMap((l) => [l.nome, l.email, l.whatsapp, l.token]),
  "IPHASH-SECRETO",
  "UA-SECRETO",
  "FBCLID-SECRETO",
  "Fortaleza, Aldeota",
  "Prefere falar depois das 18h.",
];

function semPessoais(texto: string, onde: string) {
  for (const s of PESSOAIS) expect(texto, `${onde} contém ${s}`).not.toContain(s);
}

test.beforeEach(async () => {
  await prepararEquipe();
});

test.describe("cada papel no funil", () => {
  for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
    test(papel, async ({ page }) => {
      await entrar(page, EMAIL_DO_PAPEL[papel]);

      // Menu e card do Início levam ao funil.
      await expect(page.getByRole("link", { name: "Ver o funil" })).toBeVisible();
      const menu = page.getByRole("navigation", { name: "Principal" });
      if ((page.viewportSize()?.width ?? 1280) >= 1024) await expect(menu.getByRole("link", { name: "Funil" })).toBeVisible();

      const tela = await page.request.get("/funil", { maxRedirects: 0 });
      expect(tela.status()).toBe(200);
      semPessoais(await tela.text(), `HTML do funil (${papel})`);

      const api = await page.request.get("/api/funil?periodo=tudo");
      expect(api.status()).toBe(200);
      const corpo = await api.text();
      semPessoais(corpo, `API do funil (${papel})`);
      expect(JSON.parse(corpo).resumo.cadastros).toBe(LEADS.length);

      const exportar = await page.request.post("/api/funil/exportar", { headers: { Origin: ORIGEM }, form: { periodo: "tudo" } });
      expect(exportar.status()).toBe(papel === "admin" ? 200 : 403);

      await page.goto("/funil");
      await expect(page.getByRole("heading", { name: "Funil", level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Exportar CSV" })).toHaveCount(papel === "admin" ? 1 : 0);
      // Com os gráficos já desenhados no navegador.
      await expect(page.locator(".recharts-surface")).toHaveCount(2);
      semPessoais(await page.content(), `DOM do funil (${papel})`);
    });
  }
});

test("sem login: tela vai pro login e API dá 401", async ({ page }) => {
  expect((await page.request.get("/funil", { maxRedirects: 0 })).status()).toBe(307);
  expect((await page.request.get("/api/funil")).status()).toBe(401);
  expect((await page.request.post("/api/funil/exportar", { headers: { Origin: ORIGEM } })).status()).toBe(401);
});

test("avisos: Agendou subestimado, sem dados de reunião e amostra pequena", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.vendas);
  await page.goto("/funil?periodo=tudo");
  await expect(page.getByText("“Agendou” pode estar subestimado")).toBeVisible();
  await expect(page.getByText("Sem dados de reunião neste recorte")).toBeVisible();
  // 30 cadastros no total: não é amostra pequena (o limite é "menos de 30")...
  await expect(page.getByText(/^Amostra pequena:/)).toHaveCount(0);
  // ...mas cada versão do título tem 5.
  await page.goto("/funil?periodo=tudo&versao=A");
  await expect(page.getByText(/^Amostra pequena: 5 cadastros/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Por criativo" }).getByText("amostra pequena").first()).toBeVisible();
  // Reuniões realizadas: "sem dados", nunca zero.
  const cartao = page.locator("dl > div").filter({ hasText: "Reuniões realizadas" });
  await expect(cartao.getByText("sem dados")).toBeVisible();

  await page.goto("/funil?de=2020-01-01&ate=2020-01-31");
  await expect(page.getByText("Nenhum cadastro neste recorte.").first()).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(0);
});

test("cortes combinados pela tela e ordenação da tabela", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.leitura);
  await page.goto("/funil?periodo=tudo");
  await page.getByText("Período e cortes").click();
  await page.getByLabel("Criativo (utm_content)").selectOption("T7D-R1-H01-VID");
  await page.getByLabel("Campanha (utm_campaign)").selectOption("camp-a");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/criativo=T7D-R1-H01-VID/);
  const esperado = LEADS.filter((l) => l.utm_content === "T7D-R1-H01-VID" && l.utm_campaign === "camp-a").length;
  const api = await (await page.request.get(`/api/funil?${new URL(page.url()).searchParams}`)).json();
  expect(api.resumo.cadastros).toBe(esperado);
  await expect(page.locator("dl > div").filter({ hasText: /^Cadastros/ }).getByText(String(esperado), { exact: true })).toBeVisible();

  await page.goto("/funil?periodo=tudo");
  const tabela = page.getByRole("region", { name: "Por versão do título" });
  await tabela.getByRole("link", { name: "Cadastros" }).click();
  await expect(page).toHaveURL(/ov=cadastros&dv=desc/);
  await expect(page.getByRole("region", { name: "Por versão do título" }).getByRole("columnheader", { name: /Cadastros/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
});

test("admin exporta o CSV pela tela, com auditoria", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.admin);
  await page.goto("/funil?periodo=tudo&versao=B");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^funil-comparativo-\d{4}-\d{2}-\d{2}\.csv$/);
  const conteudo = await (await download.createReadStream()).toArray();
  const csv = Buffer.concat(conteudo).toString("utf8");
  expect(csv.startsWith("﻿corte;grupo;cadastros;")).toBe(true);
  expect(csv).toContain(`versao_titulo;B;${LEADS.filter((l) => l.lp_variant === "B").length};`);
  semPessoais(csv, "CSV");

  const auditoria = await sql<{ usuario_id: string; detalhe: { filtros: Record<string, string> } }>(
    "SELECT usuario_id, detalhe FROM painel_auditoria WHERE acao = 'exportar_funil'",
  );
  expect(auditoria).toHaveLength(1);
  expect(auditoria[0].usuario_id).toBe(USUARIOS_TESTE.ana.id);
  expect(auditoria[0].detalhe.filtros).toMatchObject({ periodo: "tudo", versao: "B" });

  // Sem Origin do painel, nada sai (nem auditoria).
  expect((await page.request.post("/api/funil/exportar", { form: { periodo: "tudo" } })).status()).toBe(403);
  expect(await sql("SELECT 1 FROM painel_auditoria WHERE acao = 'exportar_funil'")).toHaveLength(1);
});
