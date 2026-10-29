import { beforeAll, describe, expect, it } from "vitest";
import { lerFiltros, POR_PAGINA } from "@/lib/filtrosLeads";
import { abrirFicha, leadsVisiveis, linkDeAtivacao, listarLeads, opcoesDeFiltro, SemAcessoALeads } from "@/lib/leads";
import type { Papel } from "@/lib/papeis";
import { LEADS, leadsDe, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { db, limparTudo, sqlDono } from "./apoio";

const quem = (u: keyof typeof USUARIOS_TESTE) => ({ id: USUARIOS_TESTE[u].id, papel: USUARIOS_TESTE[u].papel as Papel });
const admin = quem("ana");
const suporte = quem("sergio");
const vera = quem("vera");
const vitor = quem("vitor");
const leitura = quem("leo");

const filtros = (params: Record<string, string> = {}, papel: Papel = "admin") => lerFiltros(params, papel);
const ids = async (usuario = admin, params: Record<string, string> = {}) =>
  (await listarLeads(usuario, filtros({ ...params, pagina: params.pagina ?? "1" }, usuario.papel))).itens.map((l) => l.id);
const todos = async (usuario = admin, params: Record<string, string> = {}) => {
  const primeira = await listarLeads(usuario, filtros(params, usuario.papel));
  const resto = [];
  for (let p = 2; p <= primeira.paginas; p++) {
    resto.push(...(await listarLeads(usuario, filtros({ ...params, pagina: String(p) }, usuario.papel))).itens);
  }
  return [...primeira.itens, ...resto];
};

beforeAll(async () => {
  await limparTudo();
  await semear(sqlDono);
});

describe("o banco do teste é o do painel_app", () => {
  it("painel_app não lê colunas sensíveis nem escreve em colunas não liberadas", async () => {
    await expect(db().query("SELECT ip_hash FROM teste7d_inscricoes LIMIT 1")).rejects.toThrow(/permission denied/);
    await expect(db().query("SELECT fbclid FROM teste7d_inscricoes LIMIT 1")).rejects.toThrow(/permission denied/);
    await expect(db().query("SELECT * FROM teste7d_inscricoes LIMIT 1")).rejects.toThrow(/permission denied/);
    await expect(db().query("UPDATE teste7d_inscricoes SET nome = 'x'")).rejects.toThrow(/permission denied/);
  });
});

describe("leadsVisiveis", () => {
  it("admin e suporte veem todos", async () => {
    expect((await todos(admin)).length).toBe(LEADS.length);
    expect((await todos(suporte)).length).toBe(LEADS.length);
  });

  it("vendas vê só os seus", async () => {
    expect(new Set((await todos(vera)).map((l) => l.id))).toEqual(new Set(leadsDe("vera").map((l) => l.id)));
    expect(new Set((await todos(vitor)).map((l) => l.id))).toEqual(new Set(leadsDe("vitor").map((l) => l.id)));
  });

  it("leitura não tem acesso a lead individual nenhum", async () => {
    await expect(listarLeads(leitura, filtros({}, "leitura"))).rejects.toThrow(SemAcessoALeads);
    await expect(abrirFicha(leitura, LEADS[0].id, "tela")).rejects.toThrow(SemAcessoALeads);
    await expect(linkDeAtivacao(leitura, LEADS[0].id)).rejects.toThrow(SemAcessoALeads);
    await expect(opcoesDeFiltro(leitura)).rejects.toThrow(SemAcessoALeads);
    expect(() => leadsVisiveis({ id: "x", papel: "leitura" }, { add: () => "" } as never)).toThrow(SemAcessoALeads);
  });

  it("vendedor não acha lead alheio pela busca (nome, e-mail ou WhatsApp)", async () => {
    const alheio = leadsDe("vitor")[0];
    expect(await ids(vera, { q: alheio.nome })).toEqual([]);
    expect(await ids(vera, { q: alheio.email })).toEqual([]);
    expect(await ids(vera, { q: alheio.whatsapp.slice(-8) })).toEqual([]);
    expect(await ids(vitor, { q: alheio.nome })).toEqual([alheio.id]);
  });

  it("vendedor não usa filtro de responsável para ver os leads de outro", async () => {
    const f = lerFiltros({ responsavel: USUARIOS_TESTE.vitor.id }, "vendas");
    expect(f.responsavel).toBeUndefined();
    expect((await listarLeads(vera, f)).total).toBe(leadsDe("vera").length);
  });

  it("vendedor não vê a visão Sem responsável; suporte também não", () => {
    expect(lerFiltros({ visao: "sem_responsavel" }, "vendas").visao).toBeUndefined();
    expect(lerFiltros({ visao: "sem_responsavel" }, "suporte").visao).toBeUndefined();
    expect(lerFiltros({ visao: "sem_responsavel" }, "admin").visao).toBe("sem_responsavel");
  });

  it("opções de filtro saem só dos leads visíveis", async () => {
    const soDoVitor = await opcoesDeFiltro(vitor);
    const esperados = [...new Set(leadsDe("vitor").map((l) => l.utm_content))].sort();
    expect(soDoVitor.criativos).toEqual(esperados);
    expect(soDoVitor.responsaveis).toEqual([]);
  });
});

describe("filtros, ordenação e paginação", () => {
  it("pagina de 25 em 25 e a última página tem o resto", async () => {
    const p1 = await listarLeads(admin, filtros());
    expect(p1.itens).toHaveLength(POR_PAGINA);
    expect(p1.total).toBe(30);
    expect(p1.paginas).toBe(2);
    const p2 = await listarLeads(admin, filtros({ pagina: "2" }));
    expect(p2.itens).toHaveLength(5);
    expect(new Set([...p1.itens, ...p2.itens].map((l) => l.id)).size).toBe(30);
    // Página além do fim cai na última.
    expect((await listarLeads(admin, filtros({ pagina: "99" }))).pagina).toBe(2);
  });

  it("padrão: mais recentes primeiro", async () => {
    const lista = await todos(admin);
    expect(lista.map((l) => l.id)).toEqual([...LEADS].sort((a, b) => a.dias_atras - b.dias_atras).map((l) => l.id));
  });

  it("ordena por nome nos dois sentidos", async () => {
    const nomes = (await todos(admin, { ordem: "nome", dir: "asc" })).map((l) => l.nome);
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })));
    const desc = (await todos(admin, { ordem: "nome", dir: "desc" })).map((l) => l.nome);
    expect(desc).toEqual([...nomes].reverse());
  });

  it.each([
    ["status", "agendado", (l: (typeof LEADS)[number]) => l.status === "agendado"],
    ["criativo", "T7D-R1-H02-IMG", (l: (typeof LEADS)[number]) => l.utm_content === "T7D-R1-H02-IMG"],
    ["campanha", "camp-b", (l: (typeof LEADS)[number]) => l.utm_campaign === "camp-b"],
    ["versao", "C", (l: (typeof LEADS)[number]) => l.lp_variant === "C"],
  ])("filtro %s", async (campo, valor, regra) => {
    const esperado = LEADS.filter(regra).map((l) => l.id).sort();
    expect((await todos(admin, { [campo]: valor })).map((l) => l.id).sort()).toEqual(esperado);
  });

  it("filtros combinados", async () => {
    const esperado = LEADS.filter((l) => l.utm_campaign === "camp-a" && l.status === "inscrito").map((l) => l.id).sort();
    expect((await todos(admin, { campanha: "camp-a", status: "inscrito" })).map((l) => l.id).sort()).toEqual(esperado);
  });

  it("período (datas de São Paulo, 'até' inclusivo)", async () => {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const lista = await todos(admin, { de: hoje, ate: hoje });
    expect(lista.every((l) => Date.now() - new Date(l.created_at).getTime() < 86_400_000)).toBe(true);
    expect(lista.length).toBeGreaterThanOrEqual(1);
    expect(await todos(admin, { de: "2000-01-01", ate: "2000-01-31" })).toEqual([]);
  });

  it("responsável: de alguém e 'sem' (inclui quem tem responsável desativado)", async () => {
    expect((await todos(admin, { responsavel: USUARIOS_TESTE.vitor.id })).length).toBe(3);
    const sem = await todos(admin, { responsavel: "sem" });
    expect(sem.length).toBe(leadsDe(null).length + leadsDe("inativo").length);
    expect(sem.every((l) => l.responsavel_nome === null)).toBe(true);
  });

  it("busca por nome, e-mail e WhatsApp (com máscara)", async () => {
    const alvo = LEADS[4];
    expect(await ids(admin, { q: "elisa" })).toEqual([alvo.id]);
    expect(await ids(admin, { q: alvo.email.toUpperCase() })).toEqual([alvo.id]);
    const n = alvo.whatsapp;
    expect(await ids(admin, { q: `(${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}` })).toEqual([alvo.id]);
  });

  it("busca com % e _ é literal", async () => {
    expect(await ids(admin, { q: "%" })).toEqual([]);
    expect(await ids(admin, { q: "_" })).toEqual([]);
  });

  it("valores inválidos na URL são ignorados", async () => {
    const f = lerFiltros({ status: "hackeado", versao: "Z", ordem: "1;DROP", pagina: "-3", de: "ontem", responsavel: "x" }, "admin");
    expect(f).toEqual({ ordem: "cadastro", dir: "desc", pagina: 1 });
  });
});

describe("visões", () => {
  it("Cadastros parados: inscrito e ativação preenchida, mais antigos primeiro", async () => {
    const lista = await todos(admin, { visao: "parados" });
    expect(lista.every((l) => l.status === "inscrito" || l.status === "ativacao_preenchida")).toBe(true);
    expect(lista.length).toBe(LEADS.filter((l) => l.status !== "agendado").length);
    const tempos = lista.map((l) => new Date(l.parado_desde).getTime());
    expect(tempos).toEqual([...tempos].sort((a, b) => a - b));
  });

  it("Sem reunião marcada: quem não agendou", async () => {
    const lista = await todos(admin, { visao: "sem_reuniao" });
    expect(lista.map((l) => l.id).sort()).toEqual(LEADS.filter((l) => l.status !== "agendado").map((l) => l.id).sort());
  });

  it("Agendados esta semana: sem dados de reunião hoje, e funciona quando houver", async () => {
    const vazia = await listarLeads(admin, filtros({ visao: "agendados_semana" }));
    expect(vazia.total).toBe(0);
    expect(vazia.temDadosDeReuniao).toBe(false);

    await sqlDono("UPDATE teste7d_inscricoes SET reuniao_em = now() WHERE id = $1", [LEADS[2].id]);
    await sqlDono("UPDATE teste7d_inscricoes SET reuniao_em = now() + interval '30 days' WHERE id = $1", [LEADS[7].id]);
    try {
      const cheia = await listarLeads(admin, filtros({ visao: "agendados_semana" }));
      expect(cheia.itens.map((l) => l.id)).toEqual([LEADS[2].id]);
      expect(cheia.temDadosDeReuniao).toBe(true);
      // O vendedor não "descobre" que existe reunião em lead alheio.
      expect((await listarLeads(vitor, filtros({}, "vendas"))).temDadosDeReuniao).toBe(false);
    } finally {
      await sqlDono("UPDATE teste7d_inscricoes SET reuniao_em = NULL");
    }
  });

  it("Sem responsável (admin): sem dono ou com dono desativado", async () => {
    const lista = await todos(admin, { visao: "sem_responsavel" });
    expect(lista.length).toBe(leadsDe(null).length + leadsDe("inativo").length);
  });

  it("campos de reunião vazios voltam como null (a tela mostra 'sem dados')", async () => {
    const lista = await todos(admin);
    expect(lista.every((l) => l.reuniao_em === null)).toBe(true);
  });
});

describe("ficha e link de ativação", () => {
  const proprio = leadsDe("vera")[0];
  const alheio = leadsDe("vitor")[0];

  it("vendedor abre a ficha do seu lead e não a de lead alheio (null = 404)", async () => {
    expect((await abrirFicha(vera, proprio.id, "tela"))?.nome).toBe(proprio.nome);
    expect(await abrirFicha(vera, alheio.id, "tela")).toBeNull();
    expect(await abrirFicha(vera, "nao-e-uuid", "tela")).toBeNull();
    expect(await abrirFicha(admin, "00000000-0000-4000-8000-999999999999", "tela")).toBeNull();
  });

  it("ficha nunca traz ip_hash, user_agent, fbclid nem o token", async () => {
    const ficha = (await abrirFicha(suporte, proprio.id, "api"))!;
    const texto = JSON.stringify(ficha);
    for (const proibido of ["ip_hash", "user_agent", "fbclid", "token", "SECRETO", proprio.token]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("abrir ficha grava ver_lead (e não grava nada quando não acha)", async () => {
    await sqlDono("DELETE FROM painel_auditoria");
    await abrirFicha(vera, proprio.id, "tela");
    await abrirFicha(vera, alheio.id, "tela");
    const rows = await sqlDono<{ usuario_id: string; lead_id: string; detalhe: unknown }>(
      "SELECT usuario_id, lead_id, detalhe FROM painel_auditoria WHERE acao = 'ver_lead'",
    );
    expect(rows).toEqual([{ usuario_id: vera.id, lead_id: proprio.id, detalhe: { via: "tela" } }]);
  });

  it("link de ativação: admin, suporte e o responsável; alheio não; auditoria sem o token", async () => {
    await sqlDono("DELETE FROM painel_auditoria");
    const esperado = `https://lp.useady.com.br/ativar-conta?t=${proprio.token}`;
    expect(await linkDeAtivacao(admin, proprio.id)).toBe(esperado);
    expect(await linkDeAtivacao(suporte, proprio.id)).toBe(esperado);
    expect(await linkDeAtivacao(vera, proprio.id)).toBe(esperado);
    expect(await linkDeAtivacao(vitor, proprio.id)).toBeNull();

    const rows = await sqlDono<{ acao: string; detalhe: unknown }>("SELECT acao, detalhe FROM painel_auditoria");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.acao === "copiar_link")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(proprio.token);
  });

  it("lead de vendedor desativado some para ele (e aparece sem responsável)", async () => {
    const lead = leadsDe("inativo")[0];
    expect(await abrirFicha(quem("inativo"), lead.id, "tela")).not.toBeNull(); // o escopo é por responsável…
    // …mas o vendedor desativado não passa do login/proxy; para os outros, o lead aparece sem responsável.
    expect((await abrirFicha(admin, lead.id, "tela"))?.responsavel_nome).toBeNull();
  });
});
