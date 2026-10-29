import { expect, test } from "@playwright/test";
import { LEADS } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe } from "./apoio";

/** Nada disto pode aparecer no perfil (tela nem API). */
const PESSOAIS = [
  ...LEADS.flatMap((l) => [l.nome, l.email, l.whatsapp, l.token, `Loja de ${l.nome.split(" ")[0]}`]),
  "IPHASH-SECRETO",
  "UA-SECRETO",
  "FBCLID-SECRETO",
  "Fortaleza, Aldeota", // o texto cru; só o termo normalizado pode sair
  "Prefere falar depois das 18h.",
];

function semPessoais(texto: string, onde: string) {
  for (const s of PESSOAIS) expect(texto, `${onde} contém ${s}`).not.toContain(s);
}

const CONTAGENS = new Set(["pessoas", "total", "respondidos", "naoResponderam", "outros", "cadastros", "completaram", "agendaram", "naoAgendaram"]);

/** Todos os números de pessoas da resposta da API (fora os filtros). */
function contagens(valor: unknown, saida: number[] = []): number[] {
  if (Array.isArray(valor)) valor.forEach((v) => contagens(v, saida));
  else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      if (k === "filtros") continue;
      if (CONTAGENS.has(k) && typeof v === "number") saida.push(v);
      else contagens(v, saida);
    }
  }
  return saida;
}

test.beforeEach(async () => {
  await prepararEquipe();
});

test.describe("cada papel no perfil", () => {
  for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
    test(papel, async ({ page }) => {
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      await expect(page.getByRole("link", { name: "Ver o perfil dos leads" })).toBeVisible();
      const menu = page.getByRole("navigation", { name: "Principal" });
      if ((page.viewportSize()?.width ?? 1280) >= 1024) await expect(menu.getByRole("link", { name: "Perfil" })).toBeVisible();

      const tela = await page.request.get("/perfil?periodo=tudo", { maxRedirects: 0 });
      expect(tela.status()).toBe(200);
      semPessoais(await tela.text(), `HTML do perfil (${papel})`);

      const api = await page.request.get("/api/perfil?periodo=tudo");
      expect(api.status()).toBe(200);
      const corpo = await api.text();
      semPessoais(corpo, `API do perfil (${papel})`);
      const json = JSON.parse(corpo);
      expect(json.cadastros).toBe(LEADS.length);
      expect(json.termos[0].termos).toEqual([{ termo: "fortaleza aldeota", pessoas: LEADS.filter((l) => l.status !== "inscrito").length }]);

      await page.goto("/perfil?periodo=tudo");
      await expect(page.getByRole("heading", { name: "Perfil dos leads", level: 1 })).toBeVisible();
      await expect(page.getByText("“Agendou” pode estar subestimado")).toBeVisible();
      semPessoais(await page.content(), `DOM do perfil (${papel})`);
      // Sem exportação nesta tela.
      await expect(page.getByRole("button", { name: /Exportar/ })).toHaveCount(0);
    });
  }
});

test("sem login: tela vai pro login e API dá 401; sem POST", async ({ page }) => {
  expect((await page.request.get("/perfil", { maxRedirects: 0 })).status()).toBe(307);
  expect((await page.request.get("/api/perfil")).status()).toBe(401);
  await entrar(page, EMAIL_DO_PAPEL.admin);
  expect((await page.request.post("/api/perfil", { headers: { Origin: "http://localhost:3100" } })).status()).toBe(405);
});

test("leitura: células de 1 a 4 pessoas ocultas já na API", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.admin);
  const admin = contagens(await (await page.request.get("/api/perfil?periodo=tudo")).json());
  // O conjunto tem células pequenas (o teste não é vazio).
  expect(admin.some((n) => n > 0 && n < 5)).toBe(true);
  await page.goto("/perfil?periodo=tudo");
  await expect(page.getByRole("heading", { name: "Perfil dos leads", level: 1 })).toBeVisible();
  await expect(page.getByText("oculto", { exact: true })).toHaveCount(0);

  await page.context().clearCookies();
  await entrar(page, EMAIL_DO_PAPEL.leitura);
  const resposta = await (await page.request.get("/api/perfil?periodo=tudo")).json();
  expect(resposta.ocultaAbaixoDe).toBe(5);
  const leitura = contagens(resposta);
  expect(leitura.filter((n) => n > 0 && n < 5)).toEqual([]);
  // Com um corte menor, mais coisa some (e a resposta continua sem números pequenos).
  const corte = contagens(await (await page.request.get("/api/perfil?periodo=tudo&versao=A")).json());
  expect(corte.filter((n) => n > 0 && n < 5)).toEqual([]);

  await page.goto("/perfil?periodo=tudo");
  await expect(page.getByText(/No seu acesso \(leitura\)/)).toBeVisible();
  await expect(page.getByText("oculto", { exact: true }).first()).toBeVisible();
});

test("cortes combinados pela tela", async ({ page }) => {
  await entrar(page, EMAIL_DO_PAPEL.vendas);
  await page.goto("/perfil?periodo=tudo");
  await page.getByText("Período e cortes").click();
  await page.getByLabel("Criativo (utm_content)").selectOption("T7D-R1-H01-VID");
  await page.getByLabel("Campanha (utm_campaign)").selectOption("camp-a");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/\/perfil\?.*criativo=T7D-R1-H01-VID/);
  const esperado = LEADS.filter((l) => l.utm_content === "T7D-R1-H01-VID" && l.utm_campaign === "camp-a").length;
  const api = await (await page.request.get(`/api/perfil?${new URL(page.url()).searchParams}`)).json();
  expect(api.cadastros).toBe(esperado);
  await expect(page.locator("dl > div").filter({ hasText: /^Cadastros/ }).getByText(String(esperado), { exact: true })).toBeVisible();
  // Amostra pequena na comparação (poucos cadastros neste corte).
  await expect(page.getByText("amostra pequena").first()).toBeVisible();

  await page.goto("/perfil?de=2020-01-01&ate=2020-01-31");
  await expect(page.getByText("Nenhum cadastro neste recorte.")).toBeVisible();
});
