import { expect, test, type Page } from "@playwright/test";
import { LEADS, leadsDe, USUARIOS_TESTE } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

const ORIGEM = "http://localhost:3100";
const SEM_DONO = LEADS.filter((l) => l.dono === null);
const AGENDADOS = LEADS.filter((l) => l.status === "agendado");
const DA_VERA_AGENDADO = leadsDe("vera").find((l) => l.status === "agendado")!;
const NA_FILA = SEM_DONO.length + leadsDe("inativo").length;

const api = (page: Page, metodo: "put" | "post" | "delete", url: string, data?: unknown) =>
  page.request[metodo](url, { headers: { Origin: ORIGEM }, data }).then((r) => r.status());

test.beforeEach(async () => {
  await prepararEquipe();
});

test.describe("API por papel", () => {
  // [PUT responsável, POST lote, POST reunião, DELETE reunião]
  const esperado = {
    admin: [200, 200, 200, 200],
    suporte: [403, 403, 200, 200],
    vendas: [403, 403, 403, 403],
    leitura: [403, 403, 403, 403],
  } as const;
  const leadDaReuniao = { admin: AGENDADOS[2], suporte: AGENDADOS[3], vendas: DA_VERA_AGENDADO, leitura: AGENDADOS[4] };

  for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
    test(papel, async ({ page }) => {
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      const vera = USUARIOS_TESTE.vera.id;
      const reuniao = `/api/leads/${leadDaReuniao[papel].id}/reuniao`;
      const obtido = [
        await api(page, "put", `/api/leads/${SEM_DONO[0].id}/responsavel`, { usuarioId: vera }),
        await api(page, "post", "/api/leads/responsavel", { leads: [SEM_DONO[1].id], usuarioId: vera }),
        await api(page, "post", reuniao, { desfecho: "realizado" }),
        await api(page, "delete", reuniao),
      ];
      expect(obtido).toEqual(esperado[papel]);
      // 403 não grava nada.
      const gravou = (await sql("SELECT 1 FROM painel_lead_responsavel WHERE lead_id = $1", [SEM_DONO[0].id])).length === 1;
      expect(gravou).toBe(papel === "admin");
    });
  }

  test("sem login 401; sem Origin do painel 403; pedido inválido 400; lead inexistente 404; responsável inválido 422", async ({ page }) => {
    expect((await page.request.put(`/api/leads/${SEM_DONO[0].id}/responsavel`, { headers: { Origin: ORIGEM }, data: {} })).status()).toBe(401);
    expect((await page.request.post(`/api/leads/${AGENDADOS[0].id}/reuniao`, { headers: { Origin: ORIGEM }, data: {} })).status()).toBe(401);
    await entrar(page, EMAIL_DO_PAPEL.admin);
    expect((await page.request.post("/api/leads/responsavel", { data: { leads: [SEM_DONO[0].id], usuarioId: null } })).status()).toBe(403);
    expect((await page.request.post(`/api/leads/${AGENDADOS[0].id}/reuniao`, { data: { desfecho: "realizado" } })).status()).toBe(403);
    expect(await api(page, "post", `/api/leads/${AGENDADOS[0].id}/reuniao`, { desfecho: "remarcado" })).toBe(400);
    expect(await api(page, "put", "/api/leads/00000000-0000-4000-8000-999999999999/responsavel", { usuarioId: null })).toBe(404);
    expect(await api(page, "put", `/api/leads/${SEM_DONO[0].id}/responsavel`, { usuarioId: USUARIOS_TESTE.sergio.id })).toBe(422);
    expect(await api(page, "put", `/api/leads/${SEM_DONO[0].id}/responsavel`, { usuarioId: USUARIOS_TESTE.inativo.id })).toBe(422);
    const muitos = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(900000000000 + i)}`);
    const r = await page.request.post("/api/leads/responsavel", { headers: { Origin: ORIGEM }, data: { leads: muitos, usuarioId: null } });
    expect(r.status()).toBe(400);
    expect((await r.json()).mensagem).toMatch(/No máximo 100/);
    // Marcar de novo o que não está mais agendado: 409 com mensagem.
    expect(await api(page, "post", `/api/leads/${AGENDADOS[0].id}/reuniao`, { desfecho: "realizado" })).toBe(200);
    const conflito = await page.request.post(`/api/leads/${AGENDADOS[0].id}/reuniao`, { headers: { Origin: ORIGEM }, data: { desfecho: "nao_compareceu" } });
    expect(conflito.status()).toBe(409);
    expect((await conflito.json()).mensagem).toMatch(/não está mais como agendado/);
  });
});

test.describe("na tela, por papel", () => {
  for (const papel of ["admin", "suporte", "vendas"] as const) {
    test(`ficha de um lead agendado: ${papel}`, async ({ page }) => {
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      await page.goto(`/leads/${DA_VERA_AGENDADO.id}`);
      await expect(page.getByRole("heading", { name: DA_VERA_AGENDADO.nome, level: 1 })).toBeVisible();
      const atendimento = page.getByRole("region", { name: "Atendimento" });
      await expect(atendimento).toHaveCount(papel === "vendas" ? 0 : 1);
      await expect(page.getByLabel("Responsável", { exact: true })).toHaveCount(papel === "admin" ? 1 : 0);
      await expect(page.getByRole("button", { name: "Reunião realizada" })).toHaveCount(papel === "vendas" ? 0 : 1);
      await expect(page.getByRole("button", { name: "Não compareceu" })).toHaveCount(papel === "vendas" ? 0 : 1);
    });
  }

  test("lista: só o admin tem a seleção em lote", async ({ page }) => {
    for (const papel of ["admin", "suporte", "vendas"] as const) {
      await page.context().clearCookies();
      await entrar(page, EMAIL_DO_PAPEL[papel]);
      await page.goto("/leads");
      await expect(page.getByRole("button", { name: "Atribuir aos selecionados" })).toHaveCount(papel === "admin" ? 1 : 0);
      await expect(page.getByRole("checkbox", { name: /^Selecionar (?!todos)/ })).toHaveCount(papel === "admin" ? 25 : 0); // só as visíveis (tabela ou cartões)
    }
  });

  test("contadores no menu por papel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const menu = page.getByRole("navigation", { name: "Principal" });
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await expect(menu.getByRole("link", { name: `Leads ${NA_FILA} sem responsável` })).toBeVisible();
    await expect(menu.getByRole("link", { name: `Reuniões para fechar ${AGENDADOS.length} pendentes` })).toBeVisible();

    await page.context().clearCookies();
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    await expect(menu.getByRole("link", { name: "Leads", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: `Reuniões para fechar ${AGENDADOS.length} pendentes` })).toBeVisible();

    await page.context().clearCookies();
    await entrar(page, EMAIL_DO_PAPEL.vendas);
    await expect(menu.getByRole("link", { name: "Leads", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: /Reuniões para fechar/ })).toHaveCount(0);
  });
});

test.describe("atribuição", () => {
  test("ficha: admin atribui; a vendedora passa a ver; trocar tira o acesso dela", async ({ page, browser }) => {
    const lead = SEM_DONO[0];
    const vera = await browser.newPage();
    await entrar(vera, EMAIL_DO_PAPEL.vendas);
    expect((await vera.request.get(`/leads/${lead.id}`)).status()).toBe(404);

    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto(`/leads/${lead.id}`);
    await expect(page.getByText("Responsável: sem responsável")).toBeVisible();
    await page.getByLabel("Responsável", { exact: true }).selectOption({ label: "Vera Vendas (Vendas)" });
    await page.getByRole("button", { name: "Salvar responsável" }).click();
    await expect(page.getByText("Responsável salvo.")).toBeVisible();
    await expect(page.getByText("Responsável: Vera Vendas")).toBeVisible();
    expect((await vera.request.get(`/leads/${lead.id}`)).status()).toBe(200);

    // Repetir: nada muda e não duplica a auditoria.
    await page.getByRole("button", { name: "Salvar responsável" }).click();
    await expect(page.getByText("Nada mudou: o lead já estava assim.")).toBeVisible();

    await page.getByLabel("Responsável", { exact: true }).selectOption({ label: "Vitor Vendas (Vendas)" });
    await page.getByRole("button", { name: "Salvar responsável" }).click();
    await expect(page.getByText("Responsável: Vitor Vendas")).toBeVisible();
    expect((await vera.request.get(`/leads/${lead.id}`)).status()).toBe(404);

    await page.getByLabel("Responsável", { exact: true }).selectOption({ label: "Sem responsável" });
    await page.getByRole("button", { name: "Salvar responsável" }).click();
    await expect(page.getByText("Responsável removido.")).toBeVisible();

    const logs = await sql<{ detalhe: { anterior: { nome: string } | null; novo: { nome: string } | null } }>(
      "SELECT detalhe FROM painel_auditoria WHERE acao = 'atribuir_lead' AND lead_id = $1 ORDER BY id",
      [lead.id],
    );
    expect(logs.map((l) => [l.detalhe.anterior?.nome ?? null, l.detalhe.novo?.nome ?? null])).toEqual([
      [null, "Vera Vendas"],
      ["Vera Vendas", "Vitor Vendas"],
      ["Vitor Vendas", null],
    ]);
    await vera.close();
  });

  test("lote pelo teclado em 360px, com um lead já atribuído; contador cai", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await sql("INSERT INTO painel_lead_responsavel (lead_id, usuario_id) VALUES ($1, $2)", [SEM_DONO[0].id, USUARIOS_TESTE.vera.id]);
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto("/leads");
    const [a, b] = [SEM_DONO[0], SEM_DONO[1]];
    for (const l of [a, b]) {
      const caixa = page.getByRole("checkbox", { name: `Selecionar ${l.nome}` });
      await caixa.focus();
      await page.keyboard.press("Space");
      await expect(caixa).toBeChecked();
    }
    await expect(page.getByText("2 leads selecionados.")).toBeVisible();
    await page.getByLabel("Responsável para os selecionados").selectOption({ label: "Vera Vendas (Vendas)" });
    await page.getByRole("button", { name: "Atribuir aos selecionados" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 lead atualizado; 1 já estava assim.")).toBeVisible();
    await expect(page.getByText("Nenhum lead selecionado.")).toBeVisible();
    expect(await sql("SELECT 1 FROM painel_auditoria WHERE acao = 'atribuir_lead'")).toHaveLength(1);

    // "Selecionar todos desta página" na fila e remover.
    await page.goto("/leads?visao=sem_responsavel");
    await page.getByLabel("Selecionar todos desta página").check();
    await expect(page.getByText(`${NA_FILA - 2} leads selecionados.`)).toBeVisible();
    await page.getByLabel("Responsável para os selecionados").selectOption({ label: "Vitor Vendas (Vendas)" });
    await page.getByRole("button", { name: "Atribuir aos selecionados" }).click();
    await expect(page.getByText(`${NA_FILA - 2} leads atualizados.`)).toBeVisible();
    await expect(page.getByText("Nenhum lead encontrado com estes filtros.")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 860 });
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Leads 0 sem responsável" })).toBeVisible();
  });
});

test.describe("reunião", () => {
  test("suporte: confirmar, cancelar, marcar e desfazer, com auditoria", async ({ page }) => {
    const lead = AGENDADOS[3];
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    await page.goto(`/leads/${lead.id}`);
    await expect(page.getByText("Data da reunião: sem dados.")).toBeVisible();

    await page.getByRole("button", { name: "Reunião realizada" }).click();
    await expect(page.getByText("Marcar a reunião como realizada?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sim, marcar “Reunião realizada”" })).toBeFocused();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("button", { name: "Reunião realizada" })).toBeFocused();
    expect((await sql<{ status: string }>("SELECT status FROM teste7d_inscricoes WHERE id = $1", [lead.id]))[0].status).toBe("agendado");

    await page.getByRole("button", { name: "Reunião realizada" }).click();
    await page.getByRole("button", { name: "Sim, marcar “Reunião realizada”" }).click();
    await expect(page.getByText("Marcado: Reunião realizada.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reunião realizada" })).toHaveCount(0);
    await expect(page.getByText(/Dá para desfazer até/)).toBeVisible();

    await page.getByRole("button", { name: "Desfazer marcação" }).click();
    await expect(page.getByText("Marcação desfeita: o lead voltou para Agendado.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Não compareceu" })).toBeVisible();

    const acoes = await sql<{ acao: string; usuario_id: string }>(
      "SELECT acao, usuario_id FROM painel_auditoria WHERE lead_id = $1 AND acao <> 'ver_lead' ORDER BY id",
      [lead.id],
    );
    expect(acoes).toEqual([
      { acao: "marcar_realizada", usuario_id: USUARIOS_TESTE.sergio.id },
      { acao: "desfazer_marcacao", usuario_id: USUARIOS_TESTE.sergio.id },
    ]);
  });

  test("duas pessoas: quem chega depois recebe a mensagem clara, sem sobrescrever", async ({ page }) => {
    const lead = AGENDADOS[4];
    await entrar(page, EMAIL_DO_PAPEL.admin);
    await page.goto(`/leads/${lead.id}`);
    // Outra pessoa marca antes (direto na API, com a mesma sessão).
    expect(await api(page, "post", `/api/leads/${lead.id}/reuniao`, { desfecho: "realizado" })).toBe(200);
    await page.getByRole("button", { name: "Não compareceu" }).click();
    await page.getByRole("button", { name: "Sim, marcar “Não compareceu”" }).click();
    await expect(page.getByText("Não foi gravado: este lead não está mais como agendado (agora está em “Reunião realizada”)")).toBeVisible();
    expect((await sql<{ status: string }>("SELECT status FROM teste7d_inscricoes WHERE id = $1", [lead.id]))[0].status).toBe("realizado");
  });

  test("desfazer some depois de 24 horas", async ({ page }) => {
    const lead = AGENDADOS[5];
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    expect(await api(page, "post", `/api/leads/${lead.id}/reuniao`, { desfecho: "nao_compareceu" })).toBe(200);
    await page.goto(`/leads/${lead.id}`);
    await expect(page.getByRole("button", { name: "Desfazer marcação" })).toBeVisible();
    await sql("UPDATE painel_auditoria SET criado_em = now() - interval '25 hours' WHERE lead_id = $1 AND acao = 'marcar_nao_compareceu'", [lead.id]);
    await page.reload();
    await expect(page.getByRole("button", { name: "Desfazer marcação" })).toHaveCount(0);
    await expect(page.getByText(/Desfecho já marcado/)).toBeVisible();
    expect(await api(page, "delete", `/api/leads/${lead.id}/reuniao`)).toBe(409);
  });

  test("visão 'Reuniões para fechar': agendados, sem data de reunião, e destaque quando a reunião já passou", async ({ page }) => {
    await sql("UPDATE teste7d_inscricoes SET reuniao_em = now() - interval '2 hours' WHERE id = $1", [AGENDADOS[1].id]);
    await entrar(page, EMAIL_DO_PAPEL.suporte);
    await page.setViewportSize({ width: 1280, height: 860 });
    const menu = page.getByRole("navigation", { name: "Principal" });
    await menu.getByRole("link", { name: /Reuniões para fechar/ }).click();
    await expect(page).toHaveURL(/visao=para_fechar/);
    await expect(menu.getByRole("link", { name: /Reuniões para fechar/ })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Leads", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByText(`${AGENDADOS.length} leads em “Reuniões para fechar”`)).toBeVisible();
    const tabela = page.getByRole("region", { name: "Tabela de leads" });
    await expect(tabela.getByText("sem data de reunião")).toHaveCount(AGENDADOS.length - 1);
    await expect(tabela.getByText("já passou")).toHaveCount(1);
    // Ordem: agendamento mais antigo primeiro (o fixture agenda 2h depois do cadastro; cadastro mais antigo = mais dias atrás).
    const nomes = await tabela.locator("tbody tr td:nth-child(1)").allInnerTexts();
    expect(nomes).toEqual([...AGENDADOS].sort((x, y) => y.dias_atras - x.dias_atras).map((l) => l.nome));
  });
});
