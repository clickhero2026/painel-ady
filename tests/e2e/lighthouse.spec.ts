import { expect, test } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { leadsDe } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe } from "./apoio";

/**
 * Lighthouse (só a categoria acessibilidade) nas telas de leads, logado
 * como admin: o cookie de sessão vai no cabeçalho de cada requisição.
 * Usa o Google Chrome instalado na máquina.
 */
test("Lighthouse: acessibilidade 100 no login, na lista, na ficha, no funil e no perfil", async ({ page, context }) => {
  test.setTimeout(240_000);
  await prepararEquipe();
  await entrar(page, EMAIL_DO_PAPEL.admin);
  const cookie = (await context.cookies())
    .filter((c) => c.name.includes("painel."))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
  try {
    const notas: Record<string, number> = {};
    const telas: [string, string, boolean][] = [
      ["login", "/login", false],
      ["leads", "/leads", true],
      ["ficha", `/leads/${leadsDe("vera")[2].id}`, true],
      ["reuniões para fechar", "/leads?visao=para_fechar", true],
      ["funil", "/funil", true],
      ["perfil", "/perfil?periodo=tudo", true],
    ];
    for (const [nome, caminho, logado] of telas) {
      for (const formFactor of ["mobile", "desktop"] as const) {
        const resultado = await lighthouse(`http://localhost:3100${caminho}`, {
          port: chrome.port,
          onlyCategories: ["accessibility"],
          output: "json",
          logLevel: "error",
          formFactor,
          screenEmulation:
            formFactor === "mobile"
              ? { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false }
              : { mobile: false, width: 1280, height: 860, deviceScaleFactor: 1, disabled: false },
          extraHeaders: logado ? { Cookie: cookie } : undefined,
        });
        const lhr = resultado!.lhr;
        expect(lhr.finalDisplayedUrl, `${nome} caiu em outra página`).toContain(caminho);
        notas[`${nome} ${formFactor}`] = Math.round((lhr.categories.accessibility.score ?? 0) * 100);
        const falhas = Object.values(lhr.audits)
          .filter((a) => a.score === 0 && a.scoreDisplayMode === "binary")
          .map((a) => a.id);
        expect(falhas, `${nome} ${formFactor}`).toEqual([]);
      }
    }
    expect(Object.values(notas).every((n) => n === 100), JSON.stringify(notas)).toBe(true);
  } finally {
    chrome.kill();
  }
});
