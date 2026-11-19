import { expect, test } from "@playwright/test";
import { LEADS, leadsDe, USUARIOS_TESTE } from "../fixtures/leads";
import { EMAIL_DO_PAPEL, entrar, prepararEquipe, sql } from "./apoio";

/**
 * Perfil gestor: matriz papel × rota × API com os SEIS papéis, o fluxo do
 * gestor na tela (ficha de lead alheio, etapa, anotação, lead manual sem
 * responsável) e as capturas da tela de Usuários e da barra do gestor.
 * Gestor e super admin entram pelo dono do banco (como nas migrações).
 */

const ORIGEM = "http://localhost:3100";
const GESTOR = { id: "10000000-0000-4000-8000-0000000000bb", email: "gina@useady.com.br", nome: "Gina Gestora" };
const SUPER = { id: "10000000-0000-4000-8000-0000000000aa", email: "rafael@clickhero.com.br", nome: "Rafael Super" };

const EMAIL = { ...EMAIL_DO_PAPEL, super_admin: SUPER.email, gestor: GESTOR.email } as const;
type P = keyof typeof EMAIL;
const PAPEIS: P[] = ["super_admin", "admin", "gestor", "suporte", "vendas", "leitura"];

/** Lead do Vitor (alheio para a Vera), agendado: serve para ficha, etapa, anotação e reunião. */
const DO_VITOR = leadsDe("vitor")[0];
const SEM_DONO = LEADS.filter((l) => l.dono === null);

test.beforeEach(async () => {
  await prepararEquipe();
  for (const [u, papel] of [
    [SUPER, "super_admin"],
    [GESTOR, "gestor"],
  ] as const) {
    await sql("INSERT INTO painel_usuarios (id, email, nome, papel, ativo) VALUES ($1, $2, $3, $4, true)", [u.id, u.email, u.nome, papel]);
  }
});

const so = (...papeis: P[]) => (p: P) => papeis.includes(p);

/** Páginas: [caminho, quem recebe 200]; os outros recebem 403. */
const PAGINAS: [string, (p: P) => boolean][] = [
  ["/", () => true],
  ["/leads", so("super_admin", "admin", "gestor", "suporte", "vendas")],
  ["/pipeline", so("super_admin", "admin", "gestor", "suporte", "vendas")],
  ["/leads/novo", so("super_admin", "admin", "gestor", "vendas")],
  ["/funil", () => true],
  ["/perfil", () => true],
  ["/duplicados", so("super_admin", "admin")],
  ["/usuarios", so("super_admin", "admin")],
];

for (const papel of PAPEIS) {
  test(`matriz: ${papel} — páginas e APIs`, async ({ page }) => {
    await entrar(page, EMAIL[papel]);
    const req = page.request;
    const h = { Origin: ORIGEM };

    for (const [caminho, pode] of PAGINAS) {
      expect((await page.goto(caminho))?.status(), `${papel} ${caminho}`).toBe(pode(papel) ? 200 : 403);
    }

    // Lead alheio (do Vitor): ficha, API e link. Vendas (Vera) recebe 404; leitura 403.
    const veTodos = so("super_admin", "admin", "gestor", "suporte")(papel);
    const esperadoLeitura = veTodos ? 200 : papel === "vendas" ? 404 : 403;
    expect((await page.goto(`/leads/${DO_VITOR.id}`))?.status(), "ficha").toBe(esperadoLeitura);
    expect((await req.get(`/api/leads/${DO_VITOR.id}`)).status(), "GET lead").toBe(esperadoLeitura);
    expect((await req.post(`/api/leads/${DO_VITOR.id}/link-ativacao`, { headers: h })).status(), "link").toBe(esperadoLeitura);

    // Etapa comercial: admin, super admin e gestor em qualquer lead; vendas 404 no alheio; suporte e leitura 403.
    const etapa = await req.put(`/api/leads/${DO_VITOR.id}/etapa`, {
      headers: h,
      data: { esperada: "nao_contatado", etapa: "tentativa_contato" },
    });
    expect(etapa.status(), "etapa").toBe(so("super_admin", "admin", "gestor")(papel) ? 200 : papel === "vendas" ? 404 : 403);

    // Anotação: quem vê o lead escreve; vendas 404 no alheio; leitura 403.
    const nota = await req.post(`/api/leads/${DO_VITOR.id}/anotacoes`, { headers: h, data: { texto: `nota de ${papel}` } });
    expect(nota.status(), "anotação").toBe(veTodos ? 201 : papel === "vendas" ? 404 : 403);

    // Reunião realizada: admin, super admin, gestor e suporte.
    const reuniao = await req.post(`/api/leads/${DO_VITOR.id}/reuniao`, { headers: h, data: { desfecho: "realizado" } });
    expect(reuniao.status(), "reunião").toBe(veTodos ? 200 : 403);

    // Lead manual: admin, super admin, gestor e vendas (corpo vazio → 400 para quem pode).
    expect((await req.post("/api/leads", { headers: h, data: {} })).status(), "criar lead").toBe(
      so("super_admin", "admin", "gestor", "vendas")(papel) ? 400 : 403,
    );

    // Só admin e super admin: atribuir, mesclar, duplicados e exportar.
    const admin = so("super_admin", "admin")(papel);
    const [a, b] = SEM_DONO;
    expect((await req.put(`/api/leads/${a.id}/responsavel`, { headers: h, data: { usuarioId: null } })).status(), "atribuir").toBe(
      admin ? 200 : 403,
    );
    expect((await req.post("/api/leads/responsavel", { headers: h, data: {} })).status(), "atribuir em lote").toBe(admin ? 400 : 403);
    expect((await req.get(`/api/leads/${a.id}/mescla`)).status(), "candidatos à mescla").toBe(admin ? 200 : 403);
    expect((await req.post(`/api/leads/${a.id}/mescla`, { headers: h, data: {} })).status(), "mesclar").toBe(admin ? 400 : 403);
    // b não está mesclado: admin recebe 422 ("não está mesclado"); os outros, 403 antes de qualquer leitura.
    expect((await req.delete(`/api/leads/${b.id}/mescla`, { headers: h })).status(), "desfazer mescla").toBe(admin ? 422 : 403);
    expect((await req.get("/api/leads/duplicados")).status(), "duplicados").toBe(admin ? 200 : 403);
    expect((await req.post("/api/funil/exportar", { headers: h, form: { periodo: "tudo" } })).status(), "CSV funil").toBe(admin ? 200 : 403);
    expect((await req.post("/api/funil/origem/exportar", { headers: h, form: { periodo: "tudo" } })).status(), "CSV origem").toBe(
      admin ? 200 : 403,
    );

    // Apagar lead: só o super admin (e-mail errado de propósito → 422, nada apagado).
    expect((await req.delete(`/api/leads/${a.id}`, { headers: h, data: { email: "nao@confere.com" } })).status(), "apagar").toBe(
      papel === "super_admin" ? 422 : 403,
    );

    // Indicadores agregados: todos.
    for (const api of ["/api/funil?periodo=tudo", "/api/funil/origem?periodo=tudo", "/api/funil/comercial?periodo=tudo", "/api/perfil?periodo=tudo"]) {
      expect((await req.get(api)).status(), api).toBe(200);
    }
    expect((await req.get("/api/pipeline")).status(), "API pipeline").toBe(papel === "leitura" ? 403 : 200);

    // Nada foi apagado e o lead alheio continua do Vitor.
    expect(await sql("SELECT 1 FROM teste7d_inscricoes WHERE id = $1", [a.id])).toHaveLength(1);
    const [resp] = await sql<{ usuario_id: string }>("SELECT usuario_id FROM painel_lead_responsavel WHERE lead_id = $1", [DO_VITOR.id]);
    expect(resp.usuario_id).toBe(USUARIOS_TESTE.vitor.id);
  });
}

test("gestor: auditoria registra etapa, anotação, reunião, ficha e link, sem o texto da anotação", async ({ page }) => {
  await entrar(page, GESTOR.email);
  const h = { Origin: ORIGEM };
  await page.goto(`/leads/${DO_VITOR.id}`);
  await page.request.post(`/api/leads/${DO_VITOR.id}/link-ativacao`, { headers: h });
  await page.request.put(`/api/leads/${DO_VITOR.id}/etapa`, { headers: h, data: { esperada: "nao_contatado", etapa: "negociacao" } });
  await page.request.post(`/api/leads/${DO_VITOR.id}/anotacoes`, { headers: h, data: { texto: "segredo da gestora" } });
  await page.request.post(`/api/leads/${DO_VITOR.id}/reuniao`, { headers: h, data: { desfecho: "realizado" } });
  const logs = await sql<{ acao: string; detalhe: unknown }>(
    "SELECT acao, detalhe FROM painel_auditoria WHERE usuario_id = $1 AND lead_id = $2 ORDER BY id",
    [GESTOR.id, DO_VITOR.id],
  );
  expect(new Set(logs.map((l) => l.acao))).toEqual(new Set(["ver_lead", "copiar_link", "mudar_etapa", "anotar_lead", "marcar_realizada"]));
  expect(JSON.stringify(logs)).not.toContain("segredo");
});

for (const largura of [360, 1280] as const) {
  test(`gestor na tela (${largura}px): barra, ficha de lead alheio e lead manual sem responsável`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: largura === 1280 ? 860 : 800 });
    await entrar(page, GESTOR.email);
    const menu = page.getByRole("navigation", { name: "Principal" });
    if (largura === 360) await page.getByRole("button", { name: "Menu" }).click();
    for (const item of ["Início", "Leads", "Pipeline", "Reuniões para fechar", "Funil", "Perfil"]) {
      await expect(menu.getByRole("link", { name: item })).toBeVisible();
    }
    for (const item of ["Possíveis duplicados", "Usuários"]) await expect(menu.getByRole("link", { name: item })).toHaveCount(0);
    await page.screenshot({ path: `docs/capturas/gestor-barra-${largura}.png`, fullPage: largura === 1280 });
    if (largura === 360) await page.keyboard.press("Escape");

    // Ficha de lead da Vera: etapa e anotação, sem atribuir, sem mescla e sem zona de perigo.
    const daVera = leadsDe("vera")[1];
    await page.goto(`/leads/${daVera.id}`);
    await expect(page.getByRole("heading", { name: daVera.nome, level: 1 })).toBeVisible();
    await expect(page.getByText(daVera.email)).toBeVisible();
    await expect(page.getByRole("button", { name: /Atribuir|Trocar responsável/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Zona de perigo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Mesclar/ })).toHaveCount(0);
    await page.getByLabel("Nova anotação interna").fill(`Gestora passou por aqui (${largura})`);
    await page.getByRole("button", { name: "Salvar anotação" }).click();
    await expect(page.getByText(`Gestora passou por aqui (${largura})`)).toBeVisible();

    // Lead manual: entra em "Sem responsável", sem escolha de responsável na tela.
    await page.goto("/leads/novo");
    await expect(page.getByText("O lead entra sem responsável")).toBeVisible();
    await expect(page.getByLabel("Responsável", { exact: true })).toHaveCount(0);
    await page.getByLabel("Nome", { exact: true }).fill(`Lead Gestora ${largura}`);
    await page.getByLabel("WhatsApp, com DDD").fill("(85) 97777-0000");
    await page.getByLabel("E-mail", { exact: true }).fill(`gestora.${largura}@exemplo.com.br`);
    await page.getByRole("button", { name: "Cadastrar lead" }).click();
    await expect(page.getByRole("heading", { name: `Lead Gestora ${largura}`, level: 1 })).toBeVisible();
    const [criado] = await sql<{ id: string }>("SELECT id FROM teste7d_inscricoes WHERE email = $1", [`gestora.${largura}@exemplo.com.br`]);
    expect(await sql("SELECT 1 FROM painel_lead_responsavel WHERE lead_id = $1", [criado.id])).toHaveLength(0);
  });

  test(`Usuários (${largura}px): seletor oferece Gestor; selo e texto do gestor na lista`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: largura === 1280 ? 860 : 800 });
    await entrar(page, EMAIL_DO_PAPEL.admin, "/usuarios");
    await expect(page.getByLabel("Papel", { exact: true }).locator("option")).toHaveText(["Admin", "Gestor", "Suporte", "Vendas", "Leitura"]);
    const linha = page.getByRole("listitem").filter({ hasText: GESTOR.nome });
    // Selo (o texto "Gestor" também é uma opção do seletor da linha).
    await expect(linha.locator("span").getByText("Gestor", { exact: true })).toBeVisible();
    await expect(linha.getByText(/vê todos os leads/)).toBeVisible();
    await expect(linha.getByLabel(`Papel de ${GESTOR.nome}`, { exact: true })).toHaveValue("gestor");
    await page.screenshot({ path: `docs/capturas/usuarios-gestor-${largura}.png`, fullPage: true });

    // Promover o Léo a gestor pela tela.
    const leo = page.getByRole("listitem").filter({ hasText: "Léo Leitura" });
    await leo.getByLabel("Papel de Léo Leitura", { exact: true }).selectOption("gestor");
    await leo.getByRole("button", { name: "Salvar papel de Léo Leitura" }).click();
    await expect(leo.getByText("Papel atualizado.")).toBeVisible();
    const [linhaLeo] = await sql<{ papel: string }>("SELECT papel FROM painel_usuarios WHERE id = $1", [USUARIOS_TESTE.leo.id]);
    expect(linhaLeo.papel).toBe("gestor");
  });
}
