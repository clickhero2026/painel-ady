import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { anotacoesDe, anotacoesDoLead, anotar, ErroAnotacao } from "@/lib/anotacoes";
import { lerFiltrosPipeline } from "@/lib/filtrosPipeline";
import { ErroEtapa, etapaDoLead, historicoDeEtapas, listaDoPipeline, mudarEtapa, quadroDoPipeline } from "@/lib/pipeline";
import type { QuemConsulta } from "@/lib/leads";
import { LEADS, leadsDe, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { auditoria, db, limparTudo, sqlDono } from "./apoio";

const quem = (u: keyof typeof USUARIOS_TESTE): QuemConsulta => ({ id: USUARIOS_TESTE[u].id, papel: USUARIOS_TESTE[u].papel });
const ana = quem("ana");
const sergio = quem("sergio");
const vera = quem("vera");
const leo = quem("leo");
const DA_VERA = leadsDe("vera")[0];
const DO_VITOR = leadsDe("vitor")[0];
const SEM_DONO = LEADS.filter((l) => l.dono === null);

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
});

describe("GRANTs do pipeline", () => {
  it("db/grants/painel_app.sql contém exatamente os GRANTs de painel_app_pipeline.sql", () => {
    const comandos = (arquivo: string) =>
      readFileSync(arquivo, "utf8")
        .split("\n")
        .filter((l) => !l.startsWith("--"))
        .join("\n")
        .split(";")
        .map((c) => c.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const geral = comandos("db/grants/painel_app.sql");
    for (const c of comandos("db/grants/painel_app_pipeline.sql")) expect(geral).toContain(c);
  });

  it("histórico e anotações: o painel_app não faz UPDATE nem DELETE", async () => {
    await mudarEtapa(ana, DA_VERA.id, { esperada: "nao_contatado", etapa: "tentativa_contato" });
    await anotar(ana, DA_VERA.id, "primeira");
    for (const tabela of ["painel_lead_etapa_historico", "painel_lead_anotacao"]) {
      await expect(db().query(`UPDATE ${tabela} SET criado_em = now()`)).rejects.toThrow(/permission denied/);
      await expect(db().query(`DELETE FROM ${tabela}`)).rejects.toThrow(/permission denied/);
    }
    await expect(db().query("DELETE FROM painel_lead_etapa")).rejects.toThrow(/permission denied/);
  });
});

describe("mudar etapa", () => {
  it("admin muda qualquer lead: grava etapa, histórico e auditoria; não mexe no status do site", async () => {
    const antes = await sqlDono<{ status: string; updated_at: Date }>("SELECT status, updated_at FROM teste7d_inscricoes WHERE id = $1", [SEM_DONO[0].id]);
    await mudarEtapa(ana, SEM_DONO[0].id, { esperada: "nao_contatado", etapa: "reuniao_marcada" });
    const etapa = await etapaDoLead(ana, SEM_DONO[0].id);
    expect(etapa).toMatchObject({ etapa: "reuniao_marcada", motivo_perda: null });
    expect(etapa!.historico).toHaveLength(1);
    expect(etapa!.historico[0]).toMatchObject({ etapa_de: "nao_contatado", etapa_para: "reuniao_marcada", usuario_nome: "Ana Admin" });
    const [log] = await auditoria("mudar_etapa");
    expect(log).toMatchObject({ usuario_id: ana.id, detalhe: { de: "nao_contatado", para: "reuniao_marcada", motivo: null } });
    expect(await sqlDono("SELECT status, updated_at FROM teste7d_inscricoes WHERE id = $1", [SEM_DONO[0].id])).toEqual(antes);
  });

  it("lead sem registro está em não contatado desde o cadastro", async () => {
    const etapa = await etapaDoLead(ana, DA_VERA.id);
    const [cad] = await sqlDono<{ created_at: Date }>("SELECT created_at FROM teste7d_inscricoes WHERE id = $1", [DA_VERA.id]);
    expect(etapa).toMatchObject({ etapa: "nao_contatado", historico: [] });
    expect(etapa!.desde).toEqual(cad.created_at);
  });

  it("vendas muda os seus; lead alheio ou sem responsável = não encontrado (nada gravado)", async () => {
    await mudarEtapa(vera, DA_VERA.id, { esperada: "nao_contatado", etapa: "tentativa_contato" });
    for (const alvo of [DO_VITOR, SEM_DONO[0]]) {
      await expect(mudarEtapa(vera, alvo.id, { esperada: "nao_contatado", etapa: "tentativa_contato" })).rejects.toMatchObject({
        motivo: "nao_encontrado",
      });
      expect(await etapaDoLead(vera, alvo.id)).toBeNull();
    }
    expect(await sqlDono("SELECT lead_id FROM painel_lead_etapa")).toEqual([{ lead_id: DA_VERA.id }]);
  });

  it("suporte e leitura não mudam (sem permissão); suporte vê", async () => {
    await expect(mudarEtapa(sergio, DA_VERA.id, { esperada: "nao_contatado", etapa: "negociacao" })).rejects.toMatchObject({
      motivo: "sem_permissao",
    });
    await expect(mudarEtapa(leo, DA_VERA.id, { esperada: "nao_contatado", etapa: "negociacao" })).rejects.toMatchObject({
      motivo: "sem_permissao",
    });
    expect((await etapaDoLead(sergio, DA_VERA.id))?.etapa).toBe("nao_contatado");
    expect(await sqlDono("SELECT 1 FROM painel_lead_etapa")).toEqual([]);
  });

  it("perdido exige motivo; “Outro” exige texto; os demais aceitam texto opcional", async () => {
    const perder = (motivo?: string, motivoTexto?: string) =>
      mudarEtapa(ana, DA_VERA.id, { esperada: "nao_contatado", etapa: "negocio_perdido", motivo, motivoTexto });
    await expect(perder()).rejects.toThrow(/motivo da perda/);
    await expect(perder("inventado")).rejects.toThrow(/motivo da perda/);
    await expect(perder("outro")).rejects.toThrow(/escreva qual foi o motivo/);
    await expect(perder("outro", "   ")).rejects.toThrow(/escreva qual foi o motivo/);
    await expect(perder("outro", "x".repeat(501))).rejects.toThrow(/até 500/);
    expect(await sqlDono("SELECT 1 FROM painel_lead_etapa_historico")).toEqual([]);

    await perder("outro", "  Fechou com o sobrinho  ");
    let e = await etapaDoLead(ana, DA_VERA.id);
    expect(e).toMatchObject({ etapa: "negocio_perdido", motivo_perda: "outro", motivo_perda_texto: "Fechou com o sobrinho" });
    // A auditoria leva a chave do motivo, não o texto.
    expect((await auditoria("mudar_etapa"))[0].detalhe).toEqual({ de: "nao_contatado", para: "negocio_perdido", motivo: "outro", com_texto: true });

    await mudarEtapa(ana, DA_VERA.id, { esperada: "negocio_perdido", etapa: "negociacao", motivo: "sumiu" });
    e = await etapaDoLead(ana, DA_VERA.id);
    // Reabrir: motivo some da etapa atual, histórico guarda tudo.
    expect(e).toMatchObject({ etapa: "negociacao", motivo_perda: null, motivo_perda_texto: null });
    expect(e!.historico.map((h) => [h.etapa_de, h.etapa_para, h.motivo_perda])).toEqual([
      ["negocio_perdido", "negociacao", null],
      ["nao_contatado", "negocio_perdido", "outro"],
    ]);

    await mudarEtapa(ana, SEM_DONO[1].id, { esperada: "nao_contatado", etapa: "negocio_perdido", motivo: "sem_interesse" });
    expect(await etapaDoLead(ana, SEM_DONO[1].id)).toMatchObject({ motivo_perda: "sem_interesse", motivo_perda_texto: null });
  });

  it("pode pular etapas, voltar, fechar e reabrir um fechado", async () => {
    const passos = ["negocio_fechado", "tentativa_contato", "negocio_fechado", "negocio_provavel"] as const;
    let atual: (typeof passos)[number] | "nao_contatado" = "nao_contatado";
    for (const p of passos) {
      await mudarEtapa(ana, DA_VERA.id, { esperada: atual, etapa: p });
      atual = p;
    }
    expect((await historicoDeEtapas([DA_VERA.id])).map((h) => h.etapa_para).reverse()).toEqual(passos);
  });

  it("mudar para a mesma etapa é recusado", async () => {
    await expect(mudarEtapa(ana, DA_VERA.id, { esperada: "nao_contatado", etapa: "nao_contatado" })).rejects.toMatchObject({
      motivo: "invalido",
    });
  });

  it("condicional: quem viu a etapa antiga recebe conflito com a etapa de agora e quem mudou", async () => {
    await mudarEtapa(vera, DA_VERA.id, { esperada: "nao_contatado", etapa: "tentativa_contato" });
    const erro = await mudarEtapa(ana, DA_VERA.id, { esperada: "nao_contatado", etapa: "negociacao" }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroEtapa);
    expect(erro.motivo).toBe("conflito");
    expect(erro.message).toMatch(/“Tentativa de contato” por Vera Vendas/);
    expect((await etapaDoLead(ana, DA_VERA.id))?.etapa).toBe("tentativa_contato");
  });

  it("duas mudanças ao mesmo tempo: só uma grava", async () => {
    const r = await Promise.allSettled([
      mudarEtapa(ana, DA_VERA.id, { esperada: "nao_contatado", etapa: "negociacao" }),
      mudarEtapa(vera, DA_VERA.id, { esperada: "nao_contatado", etapa: "tentativa_contato" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const falha = r.find((x): x is PromiseRejectedResult => x.status === "rejected")!;
    expect(falha.reason.motivo).toBe("conflito");
    expect(await historicoDeEtapas([DA_VERA.id])).toHaveLength(1);
    expect(await auditoria("mudar_etapa")).toHaveLength(1);
  });
});

describe("quadro e lista", () => {
  const filtros = (papel: QuemConsulta["papel"], q: Record<string, string> = {}) => lerFiltrosPipeline(q, papel);

  it("vendas vê só os seus (nenhum sem responsável); admin e suporte veem todos", async () => {
    const contar = async (u: QuemConsulta) => (await quadroDoPipeline(u, filtros(u.papel))).reduce((s, c) => s + c.total, 0);
    expect(await contar(vera)).toBe(leadsDe("vera").length);
    expect(await contar(ana)).toBe(LEADS.length);
    expect(await contar(sergio)).toBe(LEADS.length);
    const daVera = (await quadroDoPipeline(vera, filtros("vendas"))).flatMap((c) => c.cartoes.map((x) => x.id));
    expect(new Set(daVera)).toEqual(new Set(leadsDe("vera").map((l) => l.id)));
    // Vendas não recebe o nome do responsável; admin recebe.
    expect((await quadroDoPipeline(vera, filtros("vendas")))[0].cartoes[0].responsavel_nome).toBeNull();
    const cartaoDaVeraParaAna = (await quadroDoPipeline(ana, filtros("admin")))[0].cartoes.find((c) => c.id === DA_VERA.id);
    expect(cartaoDaVeraParaAna?.responsavel_nome).toBe("Vera Vendas");
  });

  it("leitura não tem acesso", async () => {
    await expect(quadroDoPipeline(leo, filtros("leitura"))).rejects.toThrow();
  });

  it("Fechado e Perdido: últimos 30 dias por padrão; “tudo” mostra todos", async () => {
    await mudarEtapa(ana, SEM_DONO[0].id, { esperada: "nao_contatado", etapa: "negocio_fechado" });
    await mudarEtapa(ana, SEM_DONO[1].id, { esperada: "nao_contatado", etapa: "negocio_fechado" });
    await sqlDono("UPDATE painel_lead_etapa SET atualizado_em = now() - interval '40 days' WHERE lead_id = $1", [SEM_DONO[1].id]);
    const fechado = async (q: Record<string, string>) => (await quadroDoPipeline(ana, filtros("admin", q))).find((c) => c.etapa === "negocio_fechado")!;
    expect((await fechado({})).total).toBe(1);
    expect((await fechado({})).recortada).toBe(true);
    expect((await fechado({ tudo: "1" })).total).toBe(2);
  });

  it("até 50 cartões por coluna, com “ver mais”", async () => {
    // 30 leads no total: força limite pequeno trocando o passo pela URL não é permitido (mínimo 50).
    const q = await quadroDoPipeline(ana, filtros("admin"));
    const nao = q.find((c) => c.etapa === "nao_contatado")!;
    expect(nao.total).toBe(30);
    expect(nao.cartoes).toHaveLength(30);
    expect(filtros("admin", { n_nao_contatado: "20" }).limites.nao_contatado).toBe(50);
    expect(filtros("admin", { n_nao_contatado: "120" }).limites.nao_contatado).toBe(150);
  });

  it("lista: filtro de etapa, busca, responsável e ordem", async () => {
    await mudarEtapa(ana, SEM_DONO[0].id, { esperada: "nao_contatado", etapa: "negociacao" });
    const negociacao = await listaDoPipeline(ana, filtros("admin", { modo: "lista", etapa: "negociacao" }));
    expect(negociacao.itens.map((i) => i.id)).toEqual([SEM_DONO[0].id]);
    const busca = await listaDoPipeline(ana, filtros("admin", { modo: "lista", q: DA_VERA.email }));
    expect(busca.itens.map((i) => i.id)).toEqual([DA_VERA.id]);
    const semDono = await listaDoPipeline(ana, filtros("admin", { modo: "lista", responsavel: "sem" }));
    expect(semDono.total).toBe(SEM_DONO.length + leadsDe("inativo").length);
    // Vendas não filtra por responsável (o filtro é descartado).
    expect(filtros("vendas", { responsavel: "sem" }).responsavel).toBeUndefined();
    const porNome = await listaDoPipeline(ana, filtros("admin", { modo: "lista", ordem: "nome" }));
    const nomes = porNome.itens.map((i) => i.nome);
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });
});

describe("anotações", () => {
  it("da mais recente para a mais antiga, com autor; texto guardado como veio (sem interpretar)", async () => {
    const perigoso = '<img src=x onerror="alert(1)">\n=HYPERLINK("http://mal")';
    await anotar(ana, DA_VERA.id, "primeira");
    await anotar(vera, DA_VERA.id, perigoso);
    await anotar(sergio, DA_VERA.id, "  terceira\r\ncom quebra  ");
    const lista = await anotacoesDoLead(vera, DA_VERA.id);
    expect(lista!.map((a) => [a.autor, a.texto])).toEqual([
      ["Sérgio Suporte", "terceira\ncom quebra"],
      ["Vera Vendas", perigoso],
      ["Ana Admin", "primeira"],
    ]);
  });

  it("auditoria anotar_lead sem o texto", async () => {
    await anotar(vera, DA_VERA.id, "texto secreto da anotação");
    const [log] = await auditoria("anotar_lead");
    expect(log.usuario_id).toBe(vera.id);
    expect(JSON.stringify(log.detalhe)).not.toContain("secreto");
    expect(log.detalhe).toMatchObject({ tamanho: "texto secreto da anotação".length });
  });

  it("vendas não lê nem anota lead alheio; leitura não anota; texto vazio ou longo recusado", async () => {
    await expect(anotar(vera, DO_VITOR.id, "oi")).rejects.toMatchObject({ motivo: "nao_encontrado" });
    expect(await anotacoesDoLead(vera, DO_VITOR.id)).toBeNull();
    await expect(anotar(leo, DA_VERA.id, "oi")).rejects.toMatchObject({ motivo: "sem_permissao" });
    await expect(anotar(ana, DA_VERA.id, "   ")).rejects.toBeInstanceOf(ErroAnotacao);
    await expect(anotar(ana, DA_VERA.id, "x".repeat(2001))).rejects.toThrow(/até 2000/);
    await anotar(ana, DA_VERA.id, "x".repeat(2000));
    expect(await anotacoesDe([DA_VERA.id])).toHaveLength(1);
  });
});
