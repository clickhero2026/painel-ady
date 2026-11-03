import { expect, test, type Page } from "@playwright/test";
import { LEADS, leadsDe, USUARIOS_TESTE } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

const ORIGEM = "http://localhost:3100";
const DA_VERA = leadsDe("vera");
const DO_VITOR = leadsDe("vitor")[0];
const SEM_DONO = LEADS.filter((l) => l.dono === null);
const PAPEIS = ["admin", "suporte", "vendas", "leitura"] as const;

const enviar = (page: Page, metodo: "put" | "post" | "delete", url: string, data?: unknown) =>
  page.request[metodo](url, { headers: { Origin: ORIGEM }, data }).then((r) => r.status());
const ler = (page: Page, url: string) => page.request.get(url, { maxRedirects: 0 }).then((r) => r.status());

test.beforeEach(async () => {
  await prepararEquipe();
});

test.describe("APIs novas por papel", () => {
  // Lead da Vera (dela) e do Vitor (alheio para a Vera).
  const esperado = {
    //            etapa: GET dela, PUT dela, PUT alheio | anotações: GET dela, POST dela, GET alheio, POST alheio | mescla: GET, POST, DELETE, duplicados | pipeline, funil comercial
    admin: [200, 200, 200, 200, 201, 200, 201, 200, 200, 200, 200, 200, 200],
    suporte: [200, 403, 403, 200, 201, 200, 201, 403, 403, 403, 403, 200, 200],
    vendas: [200, 200, 404, 200, 201, 404, 404, 403, 403, 403, 403, 200, 200],
    leitura: [403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 200],
  } as const;

  for (const papel of PAPEIS) {
    test(papel, async ({ page }) => {
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      const dela = DA_VERA[0].id;
      const alheio = DO_VITOR.id;
      const obtido = [
        await ler(page, `/api/leads/${dela}/etapa`),
        await enviar(page, "put", `/api/leads/${dela}/etapa`, { esperada: "nao_contatado", etapa: "tentativa_contato" }),
        await enviar(page, "put", `/api/leads/${alheio}/etapa`, { esperada: "nao_contatado", etapa: "tentativa_contato" }),
        await ler(page, `/api/leads/${dela}/anotacoes`),
        await enviar(page, "post", `/api/leads/${dela}/anotacoes`, { texto: `nota de ${papel}` }),
        await ler(page, `/api/leads/${alheio}/anotacoes`),
        await enviar(page, "post", `/api/leads/${alheio}/anotacoes`, { texto: "nota alheia" }),
        await ler(page, `/api/leads/${SEM_DONO[0].id}/mescla?q=lead`),
        await enviar(page, "post", `/api/leads/${SEM_DONO[0].id}/mescla`, { com: SEM_DONO[1].id, principal: SEM_DONO[0].id }),
        await enviar(page, "delete", `/api/leads/${SEM_DONO[1].id}/mescla`),
        await ler(page, "/api/leads/duplicados"),
        await ler(page, "/api/pipeline"),
        await ler(page, "/api/funil/comercial?periodo=tudo"),
      ];
      expect(obtido).toEqual(esperado[papel]);
      // 403 e 404 não gravam nada.
      const etapas = await sql<{ lead_id: string }>("SELECT lead_id FROM painel_lead_etapa");
      expect(etapas.map((e) => e.lead_id).sort()).toEqual(
        papel === "admin" ? [dela, alheio].sort() : papel === "vendas" ? [dela] : [],
      );
      const notasAlheias = await sql("SELECT 1 FROM painel_lead_anotacao WHERE lead_id = $1", [alheio]);
      expect(notasAlheias.length).toBe(papel === "admin" || papel === "suporte" ? 1 : 0);
    });
  }

  test("sem login 401; sem Origin 403; pedido inválido 400; perdido sem motivo 422; conflito 409", async ({ page }) => {
    expect(await ler(page, "/api/pipeline")).toBe(401);
    expect(await enviar(page, "put", `/api/leads/${DA_VERA[0].id}/etapa`, {})).toBe(401);
    await entrar(page, EMAIL_DO_PAPEL.admin);
    const url = `/api/leads/${DA_VERA[0].id}/etapa`;
    expect((await page.request.put(url, { data: { esperada: "nao_contatado", etapa: "negociacao" } })).status()).toBe(403);
    expect(await enviar(page, "put", url, { esperada: "nao_contatado", etapa: "inventada" })).toBe(400);
    const semMotivo = await page.request.put(url, { headers: { Origin: ORIGEM }, data: { esperada: "nao_contatado", etapa: "negocio_perdido" } });
    expect(semMotivo.status()).toBe(422);
    expect((await semMotivo.json()).mensagem).toMatch(/motivo/);
    const outroSemTexto = await page.request.put(url, {
      headers: { Origin: ORIGEM },
      data: { esperada: "nao_contatado", etapa: "negocio_perdido", motivo: "outro" },
    });
    expect(outroSemTexto.status()).toBe(422);
    expect(await enviar(page, "put", url, { esperada: "nao_contatado", etapa: "negociacao" })).toBe(200);
    const conflito = await page.request.put(url, { headers: { Origin: ORIGEM }, data: { esperada: "nao_contatado", etapa: "negocio_fechado" } });
    expect(conflito.status()).toBe(409);
    expect((await conflito.json()).mensagem).toMatch(/já tinha mudado para “Negociação”/);
    expect(await enviar(page, "post", `/api/leads/${SEM_DONO[0].id}/mescla`, { com: SEM_DONO[1].id, principal: SEM_DONO[2].id })).toBe(400);
    expect(await enviar(page, "post", `/api/leads/${SEM_DONO[0].id}/mescla`, { com: SEM_DONO[0].id, principal: SEM_DONO[0].id })).toBe(422);
  });

  test("funil comercial da “leitura”: sem células de 1 a 4 e sem dado pessoal", async ({ page }) => {
    // Um fechado e um perdido: células de 1 lead.
    await sql(`INSERT INTO painel_lead_etapa (lead_id, etapa, motivo_perda) VALUES ($1, 'negocio_fechado', NULL), ($2, 'negocio_perdido', 'sumiu')`, [
      SEM_DONO[0].id,
      SEM_DONO[1].id,
    ]);
    await entrar(page, EMAIL_DO_PAPEL.leitura);
    const r = await page.request.get("/api/funil/comercial?periodo=tudo");
    const corpo = await r.json();
    const texto = JSON.stringify(corpo);
    for (const l of LEADS) {
      expect(texto).not.toContain(l.nome);
      expect(texto).not.toContain(l.email);
      expect(texto).not.toContain(l.whatsapp);
    }
    const pequenos: number[] = [];
    const varrer = (v: unknown, chave = "") => {
      if (typeof v === "number" && ["leads", "total", "passagens", "reuniao", "negociacao", "fechados", "perdidos"].includes(chave) && v > 0 && v < 5)
        pequenos.push(v);
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) varrer(x, Array.isArray(v) ? chave : k);
    };
    varrer(corpo);
    expect(pequenos).toEqual([]);
    expect(corpo.cortes.responsavel).toBeUndefined();
    expect(corpo.atual.find((a: { etapa: string }) => a.etapa === "negocio_fechado").leads).toBeNull();
  });
});

test.describe("telas novas por papel (inclusive pela URL direta)", () => {
  for (const papel of PAPEIS) {
    test(papel, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      const menu = page.getByRole("navigation", { name: "Principal" });
      await expect(menu.getByRole("link", { name: "Pipeline" })).toHaveCount(papel === "leitura" ? 0 : 1);
      await expect(menu.getByRole("link", { name: "Possíveis duplicados" })).toHaveCount(papel === "admin" ? 1 : 0);
      expect((await page.goto("/pipeline"))?.status()).toBe(papel === "leitura" ? 403 : 200);
      expect((await page.goto("/pipeline?modo=lista"))?.status()).toBe(papel === "leitura" ? 403 : 200);
      expect((await page.goto("/duplicados"))?.status()).toBe(papel === "admin" ? 200 : 403);
      if (papel === "vendas") {
        expect((await page.goto(`/leads/${DO_VITOR.id}`))?.status()).toBe(404);
      }
    });
  }
});

test.describe("pipeline na tela", () => {
  test("vendedora vê só os seus e move pelo teclado; perdido pede motivo", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await page.goto("/pipeline");
    await expect(page.getByText(`${DA_VERA.length} leads no quadro`)).toBeVisible();
    await expect(page.getByRole("link", { name: DO_VITOR.nome })).toHaveCount(0);
    await expect(page.getByText("Responsável", { exact: true })).toHaveCount(0);

    const lead = DA_VERA[0];
    const cartao = page.getByRole("article", { name: lead.nome });
    await cartao.getByRole("button", { name: /Mover para/ }).focus();
    await page.keyboard.press("Enter");
    await expect(cartao.getByRole("button", { name: "Tentativa de contato" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(cartao.getByRole("button", { name: /Mover para/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(cartao.getByRole("button", { name: "Reunião marcada" })).toBeFocused();
    await page.keyboard.press("Enter");
    const coluna = page.getByRole("region", { name: "Reunião marcada" });
    await expect(coluna.getByRole("article", { name: lead.nome })).toBeVisible();

    const movido = coluna.getByRole("article", { name: lead.nome });
    await movido.getByRole("button", { name: /Mover para/ }).click();
    await movido.getByRole("button", { name: "Negócio perdido" }).click();
    await expect(movido.getByRole("group", { name: "Por que o negócio foi perdido?" })).toBeVisible();
    await movido.getByRole("button", { name: "Confirmar: negócio perdido" }).click();
    await expect(movido.getByRole("alert")).toHaveText("Escolha o motivo da perda.");
    await movido.getByLabel("Outro").check();
    await movido.getByRole("button", { name: "Confirmar: negócio perdido" }).click();
    await expect(movido.getByRole("alert")).toContainText("escreva qual foi o motivo");
    await movido.getByLabel("Qual foi o motivo? (obrigatório)").fill("Fechou com a agência do primo");
    await movido.getByRole("button", { name: "Confirmar: negócio perdido" }).click();
    await expect(page.getByRole("region", { name: "Negócio perdido" }).getByRole("article", { name: lead.nome })).toBeVisible();
    expect(await sql("SELECT etapa, motivo_perda, motivo_perda_texto FROM painel_lead_etapa WHERE lead_id = $1", [lead.id])).toEqual([
      { etapa: "negocio_perdido", motivo_perda: "outro", motivo_perda_texto: "Fechou com a agência do primo" },
    ]);
  });

  test("suporte vê todos, com responsável, sem “Mover para”", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    await page.goto("/pipeline");
    await expect(page.getByText(`${LEADS.length} leads no quadro`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Mover para/ })).toHaveCount(0);
    await page.goto("/pipeline?modo=lista");
    await expect(page.getByText(`${LEADS.length} leads`, { exact: true })).toBeVisible();
  });

  test("lista: filtro de etapa e Fechado dos últimos 30 dias com opção de ver tudo", async ({ page }) => {
    await sql(
      `INSERT INTO painel_lead_etapa (lead_id, etapa, atualizado_em) VALUES ($1, 'negocio_fechado', now()), ($2, 'negocio_fechado', now() - interval '45 days')`,
      [SEM_DONO[0].id, SEM_DONO[1].id],
    );
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto("/pipeline?modo=lista&etapa=negocio_fechado");
    await expect(page.getByText("1 lead", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Ver todos" }).click();
    await expect(page.getByText("2 leads", { exact: true })).toBeVisible();
  });
});

test.describe("ficha: etapa, anotações e mescla", () => {
  test("etapa na ficha com histórico, sugestão de reunião e conflito", async ({ page, browser }) => {
    const agendado = DA_VERA.find((l) => l.status === "agendado")!;
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await page.goto(`/leads/${agendado.id}`);
    const bloco = page.getByRole("region", { name: "Etapa comercial" });
    await expect(bloco.getByText("Este lead já agendou o teste")).toBeVisible();
    await expect(bloco.getByText("Nenhuma mudança ainda.")).toBeVisible();

    // Outra pessoa muda antes (admin, em outra janela).
    const admin = await browser.newPage();
    await entrar(admin, EMAIL_DO_PAPEL.admin);
    expect(await enviar(admin, "put", `/api/leads/${agendado.id}/etapa`, { esperada: "nao_contatado", etapa: "tentativa_contato" })).toBe(200);

    await bloco.getByLabel("Mudar para").selectOption("reuniao_marcada");
    await bloco.getByRole("button", { name: "Salvar etapa" }).click();
    await expect(bloco.getByRole("alert")).toContainText("já tinha mudado para “Tentativa de contato” por Ana Admin");
    await expect(bloco.getByText("Ana Admin mudou de “Não contatado” para “Tentativa de contato”")).toBeVisible();

    await bloco.getByLabel("Mudar para").selectOption("reuniao_marcada");
    await bloco.getByRole("button", { name: "Salvar etapa" }).click();
    await expect(bloco.getByText("Etapa mudada para “Reunião marcada”.")).toBeVisible();
    await expect(bloco.getByText("Este lead já agendou o teste")).toHaveCount(0);
    // A situação do teste não mudou.
    expect(await sql("SELECT status FROM teste7d_inscricoes WHERE id = $1", [agendado.id])).toEqual([{ status: "agendado" }]);
  });

  test("suporte vê a etapa mas não tem o seletor", async ({ page }) => {
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    await page.goto(`/leads/${DA_VERA[0].id}`);
    const bloco = page.getByRole("region", { name: "Etapa comercial" });
    await expect(bloco.getByText("Seu papel vê a etapa comercial, mas não muda.")).toBeVisible();
    await expect(bloco.getByLabel("Mudar para")).toHaveCount(0);
  });

  test("anotações como texto, mais recente primeiro; HTML e fórmula não executam", async ({ page }) => {
    let dialogo = false;
    page.on("dialog", (d) => {
      dialogo = true;
      void d.dismiss();
    });
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await page.goto(`/leads/${DA_VERA[0].id}`);
    const bloco = page.getByRole("region", { name: "Anotações internas" });
    await bloco.getByLabel("Nova anotação interna").fill("Primeira ligação.\nPediu retorno amanhã.");
    await bloco.getByRole("button", { name: "Salvar anotação" }).click();
    await expect(bloco.getByText("Anotação salva.")).toBeVisible();
    const perigoso = '<img src=x onerror="alert(1)"><b>negrito</b> =HYPERLINK("http://mal")';
    await bloco.getByLabel("Nova anotação interna").fill(perigoso);
    await bloco.getByRole("button", { name: "Salvar anotação" }).click();
    const itens = bloco.getByRole("listitem");
    await expect(itens).toHaveCount(2);
    await expect(itens.nth(0)).toContainText(perigoso);
    await expect(itens.nth(0)).toContainText("Vera Vendas");
    await expect(itens.nth(1)).toContainText("Primeira ligação.\nPediu retorno amanhã.", { useInnerText: true });
    await expect(bloco.locator("img, b")).toHaveCount(0);
    expect(dialogo).toBe(false);
  });

  test("admin mescla pela ficha: lado a lado, sugestão, herança, redirecionamento e desfazer", async ({ page }) => {
    // Duplicado: mesmo WhatsApp de um lead da Vera, sem responsável.
    const principal = DA_VERA[1];
    const duplicado = SEM_DONO[4];
    await sql("UPDATE teste7d_inscricoes SET whatsapp = $2 WHERE id = $1", [duplicado.id, principal.whatsapp.slice(0, 4) + principal.whatsapp.slice(5)]);
    await sql("INSERT INTO painel_lead_anotacao (lead_id, usuario_id, texto) VALUES ($1, $2, 'anotação feita no duplicado')", [
      duplicado.id,
      USUARIOS_TESTE.ana.id,
    ]);

    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto("/duplicados");
    await expect(page.getByRole("heading", { name: /Mesmo WhatsApp · 2 cadastros/ })).toBeVisible();
    await page.goto(`/leads/${duplicado.id}`);
    const secao = page.getByRole("region", { name: "Cadastros mesclados" });
    await secao.getByRole("button", { name: "Mesclar com outro lead" }).click();
    await expect(secao.getByText("Possíveis duplicados deste lead")).toBeVisible();
    await secao.getByRole("button", { name: `Comparar com ${principal.nome}` }).click();
    const tabela = secao.getByRole("region", { name: "Os dois cadastros lado a lado" });
    await expect(tabela.getByRole("row", { name: /Responsável/ })).toContainText("Vera Vendas");
    // Sugere o principal (Vera; mais avançado ou mais antigo). Escolho explicitamente.
    await secao.getByRole("radio", { name: new RegExp(`Outro cadastro: ${principal.nome}`) }).check();
    await secao.getByRole("button", { name: "Confirmar mescla" }).click();
    await expect(page).toHaveURL(`/leads/${principal.id}`);

    const mesclados = page.getByRole("region", { name: "Cadastros mesclados" });
    await expect(mesclados.getByRole("article", { name: `Cadastro mesclado: ${duplicado.nome}` })).toBeVisible();
    await expect(page.getByRole("region", { name: "Anotações internas" }).getByText("anotação feita no duplicado")).toBeVisible();
    // Ficha do duplicado redireciona; lista não mostra.
    await page.goto(`/leads/${duplicado.id}`);
    await expect(page).toHaveURL(`/leads/${principal.id}`);
    await page.goto(`/leads?q=${duplicado.email}`);
    await expect(page.getByText("0 leads")).toBeVisible();

    await page.goto(`/leads/${principal.id}`);
    await page.getByRole("button", { name: `Desfazer mescla de ${duplicado.nome}` }).click();
    await page.getByRole("button", { name: "Sim, desfazer" }).click();
    await expect(page.getByText("Nenhum cadastro mesclado neste lead.")).toBeVisible();
    expect(await sql("SELECT 1 FROM painel_lead_mescla")).toEqual([]);
    expect((await sql("SELECT acao FROM painel_auditoria WHERE acao IN ('mesclar_leads', 'desfazer_mescla') ORDER BY id")).map((r) => (r as { acao: string }).acao)).toEqual([
      "mesclar_leads",
      "desfazer_mescla",
    ]);
  });

  test("vendedora não abre a ficha de um duplicado cujo principal não é dela", async ({ page }) => {
    await sql("INSERT INTO painel_lead_mescla (duplicado_id, principal_id) VALUES ($1, $2)", [DA_VERA[3].id, DO_VITOR.id]);
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    expect((await page.goto(`/leads/${DA_VERA[3].id}`))?.status()).toBe(404);
    expect(await ler(page, `/api/leads/${DA_VERA[3].id}`)).toBe(404);
  });
});

test("lista de leads: coluna e filtro “Etapa comercial”; “Situação do teste” no lugar de “Etapa”", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await sql("INSERT INTO painel_lead_etapa (lead_id, etapa) VALUES ($1, 'negociacao')", [SEM_DONO[0].id]);
  await entrar(page, EMAIL_DO_PAPEL.admin);
  await page.goto("/leads");
  const tabela = page.getByRole("region", { name: "Tabela de leads" });
  await expect(tabela.getByRole("columnheader", { name: "Situação do teste" })).toBeVisible();
  await expect(tabela.getByRole("columnheader", { name: "Etapa comercial" })).toBeVisible();
  await expect(tabela.getByRole("columnheader", { name: "Etapa", exact: true })).toHaveCount(0);
  await page.getByText("Filtros e ordem").click();
  await page.getByLabel("Etapa comercial").selectOption("negociacao");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByText("1 lead", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Situação do teste")).toBeVisible();
});

test("funil: bloco “Funil comercial” para todos os papéis; responsável só admin e suporte", async ({ page }) => {
  for (const papel of PAPEIS) {
    await page.context().clearCookies();
    await entrar(page, EMAIL_DO_PAPEL[papel]);
    await page.goto("/funil?periodo=tudo");
    await expect(page.getByRole("heading", { name: "Funil comercial" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Por responsável" })).toHaveCount(papel === "admin" || papel === "suporte" ? 1 : 0);
  }
});
