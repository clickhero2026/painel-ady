import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LEADS, leadsDe, USUARIOS_TESTE } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

/**
 * Capturas (docs/capturas), larguras de celular e desktop, texto a 200%,
 * axe e checagens de teclado. Lighthouse fica em lighthouse.spec.ts.
 */

const LARGURAS = [360, 390, 1280] as const;
const LEAD = leadsDe("vera")[2]; // ativação preenchida: ficha com respostas
const DUPLICADO = LEADS.filter((l) => l.dono === null)[5];

/** Etapas, histórico, anotações e um cadastro mesclado, pra telas do pipeline com conteúdo. */
async function semearPipeline() {
  const ana = USUARIOS_TESTE.ana.id;
  const etapas: [number, string, string | null, number][] = [
    [0, "tentativa_contato", null, 2],
    [1, "reuniao_marcada", null, 5],
    [3, "negociacao", null, 1],
    [4, "negocio_provavel", null, 3],
    [5, "negocio_fechado", null, 4],
    [6, "negocio_perdido", "sem_orcamento", 6],
    [8, "tentativa_contato", null, 9],
    [13, "negociacao", null, 12],
    [17, "reuniao_marcada", null, 0],
  ];
  for (const [i, etapa, motivo, dias] of etapas) {
    await sql("INSERT INTO painel_lead_etapa (lead_id, etapa, motivo_perda, atualizado_em, atualizado_por) VALUES ($1, $2, $3, now() - make_interval(days => $4), $5)", [
      LEADS[i].id, etapa, motivo, dias, ana,
    ]);
    await sql("INSERT INTO painel_lead_etapa_historico (lead_id, etapa_de, etapa_para, motivo_perda, usuario_id, criado_em) VALUES ($1, 'nao_contatado', $2, $3, $4, now() - make_interval(days => $5))", [
      LEADS[i].id, etapa, motivo, ana, dias,
    ]);
  }
  await sql("INSERT INTO painel_lead_etapa (lead_id, etapa, atualizado_em, atualizado_por) VALUES ($1, 'tentativa_contato', now() - interval '3 days', $2)", [LEAD.id, ana]);
  await sql(
    `INSERT INTO painel_lead_etapa_historico (lead_id, etapa_de, etapa_para, usuario_id, criado_em) VALUES
       ($1, 'nao_contatado', 'negociacao', $2, now() - interval '6 days'),
       ($1, 'negociacao', 'tentativa_contato', $3, now() - interval '3 days')`,
    [LEAD.id, ana, USUARIOS_TESTE.vera.id],
  );
  await sql(
    `INSERT INTO painel_lead_anotacao (lead_id, usuario_id, texto, criado_em) VALUES
       ($1, $2, 'Ligou pedindo para falar só depois das 18h.', now() - interval '2 days'),
       ($1, $3, $4, now() - interval '1 hour')`,
    [LEAD.id, USUARIOS_TESTE.sergio.id, USUARIOS_TESTE.vera.id, "Mandei o link do teste de novo.\nVai responder até sexta. Site: https://www.exemplo-de-endereco-muito-comprido.com.br/pagina?id=123456789"],
  );
  await sql("INSERT INTO painel_lead_mescla (duplicado_id, principal_id, mesclado_por) VALUES ($1, $2, $3)", [DUPLICADO.id, LEAD.id, ana]);
}

function vigiarConsole(page: Page) {
  const erros: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") erros.push(msg.text());
  });
  return erros;
}

/** Sem rolagem horizontal e nenhum texto cortado (elemento mais largo que a própria caixa). */
async function semCortes(page: Page, onde = "") {
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
  expect(problemas, onde).toEqual([]);
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
  await semearPipeline();
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

    // Ficha com atribuição (admin) e com a confirmação da reunião aberta.
    await expect(page.getByRole("region", { name: "Atendimento" })).toBeVisible();
    if (capturar) await page.getByRole("region", { name: "Atendimento" }).screenshot({ path: `docs/capturas/ficha-atribuicao-${largura}.png` });
    await page.getByRole("button", { name: "Reunião realizada" }).click();
    await expect(page.getByText("Marcar a reunião como realizada?")).toBeVisible();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/ficha-reuniao-${largura}.png`, fullPage: true });
    await page.getByRole("button", { name: "Cancelar" }).click();

    // Blocos novos da ficha: etapa comercial, anotações e cadastros mesclados (com a comparação aberta).
    for (const [regiao, nome] of [
      ["Etapa comercial", "ficha-etapa"],
      ["Anotações internas", "ficha-anotacoes"],
    ] as const) {
      await expect(page.getByRole("region", { name: regiao })).toBeVisible();
      if (capturar) await page.getByRole("region", { name: regiao }).screenshot({ path: `docs/capturas/${nome}-${largura}.png` });
    }
    await page.getByRole("region", { name: "Etapa comercial" }).getByLabel("Mudar para").selectOption("negocio_perdido");
    await page.getByRole("region", { name: "Etapa comercial" }).getByRole("button", { name: "Salvar etapa" }).click();
    await expect(page.getByRole("group", { name: "Por que o negócio foi perdido?" })).toBeVisible();
    await semCortes(page);
    if (capturar) await page.getByRole("region", { name: "Etapa comercial" }).screenshot({ path: `docs/capturas/ficha-etapa-perdido-${largura}.png` });
    await page.getByRole("region", { name: "Etapa comercial" }).getByRole("button", { name: "Cancelar" }).click();
    const mesclados = page.getByRole("region", { name: "Cadastros mesclados" });
    await mesclados.getByRole("button", { name: "Mesclar com outro lead" }).click();
    await mesclados.getByLabel("Buscar o outro cadastro por nome, e-mail ou WhatsApp").fill("Zeca");
    await mesclados.getByRole("button", { name: "Buscar", exact: true }).click();
    await mesclados.getByRole("button", { name: /Comparar com Zeca/ }).click();
    await expect(mesclados.getByRole("heading", { name: "Confira os dois cadastros antes de mesclar" })).toBeFocused();
    await semCortes(page);
    if (capturar) await mesclados.screenshot({ path: `docs/capturas/ficha-mescla-${largura}.png` });

    // Pipeline: quadro e lista.
    await page.goto("/pipeline");
    await expect(page.getByRole("heading", { name: "Pipeline", level: 1 })).toBeVisible();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/pipeline-quadro-${largura}.png`, fullPage: true });
    const cartao = page.getByRole("article", { name: LEADS[0].nome });
    await cartao.getByRole("button", { name: /Mover para/ }).click();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/pipeline-mover-${largura}.png` });
    await page.goto("/pipeline?modo=lista");
    await expect(page.getByRole("heading", { name: "Pipeline", level: 1 })).toBeVisible();
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/pipeline-lista-${largura}.png`, fullPage: true });
    await page.goto("/duplicados");
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/duplicados-${largura}.png`, fullPage: true });

    // Lista com seleção em lote.
    await page.goto("/leads?visao=sem_responsavel");
    for (const caixa of (await page.getByRole("checkbox", { name: /^Selecionar (?!todos)/ }).all()).slice(0, 3)) await caixa.check();
    await expect(page.getByText("3 leads selecionados.")).toBeVisible();
    await page.getByLabel("Responsável para os selecionados").selectOption({ label: "Vera Vendas (Vendas)" });
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/lista-lote-${largura}.png`, fullPage: true });

    await page.goto("/leads?visao=para_fechar");
    await expect(page.getByText(/leads em “Reuniões para fechar”/)).toBeVisible();
    await semCortes(page);

    await page.goto("/funil");
    await expect(page.getByRole("heading", { name: "Funil", level: 1 })).toBeVisible();
    await graficosProntos(page);
    await semCortes(page);
    if (capturar) await page.screenshot({ path: `docs/capturas/funil-${largura}.png`, fullPage: true });
    await page.goto("/funil?periodo=tudo");
    await graficosProntos(page);
    const comercial = page.getByRole("region", { name: "Funil comercial" });
    await expect(comercial).toBeVisible();
    if (capturar) await comercial.screenshot({ path: `docs/capturas/funil-comercial-${largura}.png` });

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
  for (const caminho of [
    "/",
    "/leads",
    "/leads?visao=para_fechar",
    "/leads/novo",
    `/leads/${LEAD.id}`,
    "/pipeline",
    "/pipeline?modo=lista",
    "/duplicados",
    "/funil",
    "/perfil?periodo=tudo",
    "/usuarios",
  ]) {
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
    await semCortes(page, caminho);
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
      ["reuniões para fechar", "/leads?visao=para_fechar"],
      ["fila sem responsável", "/leads?visao=sem_responsavel"],
      ["pipeline", "/pipeline"],
      ["pipeline lista", "/pipeline?modo=lista"],
      ["pipeline tudo", "/pipeline?tudo=1"],
      ["duplicados", "/duplicados"],
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
  // Confirmação da reunião aberta e lista com seleção.
  await page.goto(`/leads/${LEAD.id}`);
  await page.getByRole("button", { name: "Reunião realizada" }).click();
  await verificar("ficha confirmando reunião");
  // Pedido de motivo da perda, comparação da mescla e menu "Mover para…".
  await page.goto(`/leads/${LEAD.id}`);
  await page.getByRole("region", { name: "Etapa comercial" }).getByLabel("Mudar para").selectOption("negocio_perdido");
  await page.getByRole("region", { name: "Etapa comercial" }).getByRole("button", { name: "Salvar etapa" }).click();
  await verificar("ficha pedindo motivo");
  const mesclados = page.getByRole("region", { name: "Cadastros mesclados" });
  await mesclados.getByRole("button", { name: "Mesclar com outro lead" }).click();
  await mesclados.getByLabel("Buscar o outro cadastro por nome, e-mail ou WhatsApp").fill("Zeca");
  await mesclados.getByRole("button", { name: "Buscar", exact: true }).click();
  await mesclados.getByRole("button", { name: /Comparar com Zeca/ }).click();
  await verificar("ficha comparando mescla");
  await page.goto("/pipeline");
  await page.getByRole("article", { name: LEADS[0].nome }).getByRole("button", { name: /Mover para/ }).click();
  await verificar("pipeline com menu aberto");
  await page.goto("/leads");
  await page.getByLabel("Selecionar todos desta página").check();
  await verificar("lista com seleção");
  // 403 visto por quem não tem acesso.
  await page.context().clearCookies();
  await entrar(page, EMAIL_DO_PAPEL.leitura);
  await page.goto("/leads");
  await verificar("403");
  // Perfil e funil comercial com células ocultas.
  await page.goto("/perfil?periodo=tudo");
  await verificar("perfil leitura");
  await page.goto("/funil?periodo=tudo");
  await graficosProntos(page);
  await verificar("funil leitura");
  // Vendas: pipeline só dos seus, com menu de mover.
  await page.context().clearCookies();
  await entrar(page, EMAIL_DO_PAPEL.vendas);
  await page.goto("/pipeline");
  await verificar("pipeline vendas");
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
