import { beforeEach, describe, expect, it } from "vitest";
import { atribuir, ErroAtribuicao, LeadNaoEncontrado, MAX_LEADS_POR_LOTE, responsaveisPossiveis } from "@/lib/atribuicao";
import { lerFiltros } from "@/lib/filtrosLeads";
import { abrirFicha, contadoresDoMenu, listarLeads } from "@/lib/leads";
import type { Papel } from "@/lib/papeis";
import { LEADS, leadsDe, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { auditoria, limparTudo, sqlDono } from "./apoio";

const quem = (u: keyof typeof USUARIOS_TESTE) => ({ id: USUARIOS_TESTE[u].id, papel: USUARIOS_TESTE[u].papel as Papel });
const ana = USUARIOS_TESTE.ana.id;
const vera = quem("vera");
const vitor = quem("vitor");

const semDono = LEADS.filter((l) => l.dono === null);
const doInativo = leadsDe("inativo");

async function responsavelNoBanco(leadId: string) {
  const [r] = await sqlDono<{ usuario_id: string; atribuido_por: string; atribuido_em: Date }>(
    "SELECT usuario_id, atribuido_por, atribuido_em FROM painel_lead_responsavel WHERE lead_id = $1",
    [leadId],
  );
  return r ?? null;
}

async function idsDaFila() {
  const filtros = lerFiltros({ visao: "sem_responsavel" }, "admin");
  const ids: string[] = [];
  for (let p = 1; ; p++) {
    const pagina = await listarLeads({ id: ana, papel: "admin" }, { ...filtros, pagina: p });
    ids.push(...pagina.itens.map((l) => l.id));
    if (p >= pagina.paginas) return { ids, pagina };
  }
}

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
});

describe("atribuir na ficha", () => {
  it("o vendedor só vê o lead depois da atribuição, e grava responsável e auditoria", async () => {
    const lead = semDono[0];
    expect(await abrirFicha(vera, lead.id, "api")).toBeNull();

    expect(await atribuir([lead.id], vera.id, ana)).toEqual({ alterados: 1, iguais: 0 });
    expect(await abrirFicha(vera, lead.id, "api")).not.toBeNull();
    const r = await responsavelNoBanco(lead.id);
    expect(r).toMatchObject({ usuario_id: vera.id, atribuido_por: ana });
    expect(Date.now() - new Date(r!.atribuido_em).getTime()).toBeLessThan(60_000);

    const [log] = await auditoria("atribuir_lead");
    expect(log).toMatchObject({
      usuario_id: ana,
      detalhe: { anterior: null, novo: { id: vera.id, nome: USUARIOS_TESTE.vera.nome }, lote: false },
    });
  });

  it("trocar de responsável: o anterior perde o acesso na hora", async () => {
    const lead = leadsDe("vera")[0];
    expect(await abrirFicha(vera, lead.id, "api")).not.toBeNull();
    await atribuir([lead.id], vitor.id, ana);
    expect(await abrirFicha(vera, lead.id, "api")).toBeNull();
    expect((await listarLeads(vera, lerFiltros({ q: lead.email }, "vendas"))).total).toBe(0);
    expect(await abrirFicha(vitor, lead.id, "api")).not.toBeNull();
    const [log] = await auditoria("atribuir_lead");
    expect(log.detalhe).toMatchObject({ anterior: { id: vera.id }, novo: { id: vitor.id } });
  });

  it("idempotente: repetir a mesma atribuição não muda nada nem duplica a auditoria", async () => {
    const lead = semDono[1];
    await atribuir([lead.id], vera.id, ana);
    const antes = await responsavelNoBanco(lead.id);
    expect(await atribuir([lead.id], vera.id, ana)).toEqual({ alterados: 0, iguais: 1 });
    expect(await responsavelNoBanco(lead.id)).toEqual(antes);
    expect(await auditoria("atribuir_lead")).toHaveLength(1);
  });

  it("remover o responsável volta o lead para a fila e grava auditoria (uma vez só)", async () => {
    const lead = leadsDe("vera")[1];
    await atribuir([lead.id], null, ana);
    expect(await responsavelNoBanco(lead.id)).toBeNull();
    expect(await abrirFicha(vera, lead.id, "api")).toBeNull();
    expect((await idsDaFila()).ids).toContain(lead.id);
    expect(await atribuir([lead.id], null, ana)).toEqual({ alterados: 0, iguais: 1 });
    const logs = await auditoria("atribuir_lead");
    expect(logs).toHaveLength(1);
    expect(logs[0].detalhe).toMatchObject({ anterior: { id: vera.id }, novo: null });
  });
});

describe("quem pode ser responsável", () => {
  it("só ativos com papel vendas ou admin", async () => {
    const nomes = (await responsaveisPossiveis()).map((r) => r.id).sort();
    expect(nomes).toEqual([USUARIOS_TESTE.ana.id, USUARIOS_TESTE.vera.id, USUARIOS_TESTE.vitor.id].sort());
  });

  for (const [caso, id] of [
    ["vendedor desativado", USUARIOS_TESTE.inativo.id],
    ["papel suporte", USUARIOS_TESTE.sergio.id],
    ["papel leitura", USUARIOS_TESTE.leo.id],
    ["usuário que não existe", "10000000-0000-4000-8000-000000000999"],
  ] as const) {
    it(`recusa ${caso}, sem gravar nada`, async () => {
      await expect(atribuir([semDono[0].id, semDono[1].id], id, ana)).rejects.toThrow(ErroAtribuicao);
      expect(await responsavelNoBanco(semDono[0].id)).toBeNull();
      expect(await auditoria("atribuir_lead")).toEqual([]);
    });
  }

  it("vendedor desativado no meio do caminho: a atribuição seguinte é recusada", async () => {
    await sqlDono("UPDATE painel_usuarios SET ativo = false WHERE id = $1", [vitor.id]);
    await expect(atribuir([semDono[0].id], vitor.id, ana)).rejects.toThrow(/só usuários ativos/);
  });
});

describe("lote", () => {
  it("vários leads, um já com o mesmo responsável: atualiza os outros e conta o igual", async () => {
    const lote = [...semDono.slice(0, 4).map((l) => l.id), leadsDe("vera")[0].id];
    expect(await atribuir(lote, vera.id, ana)).toEqual({ alterados: 4, iguais: 1 });
    for (const id of lote) expect(await abrirFicha(vera, id, "api")).not.toBeNull();
    const logs = await auditoria("atribuir_lead");
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => l.detalhe.lote === true)).toBe(true);
  });

  it("lote misto: lead de outro vendedor troca de dono (o outro perde)", async () => {
    const deVitor = leadsDe("vitor")[0];
    await atribuir([semDono[0].id, deVitor.id], vera.id, ana);
    expect(await abrirFicha(vitor, deVitor.id, "api")).toBeNull();
    expect(await abrirFicha(vera, deVitor.id, "api")).not.toBeNull();
  });

  it(`limite de ${MAX_LEADS_POR_LOTE}, ids repetidos contam uma vez, lead inexistente desfaz tudo`, async () => {
    const muitos = Array.from({ length: MAX_LEADS_POR_LOTE + 1 }, (_, i) => `00000000-0000-4000-8000-${String(900000000000 + i)}`);
    await expect(atribuir(muitos, vera.id, ana)).rejects.toThrow(/No máximo 100/);
    await expect(atribuir([], vera.id, ana)).rejects.toThrow(ErroAtribuicao);

    expect(await atribuir([semDono[0].id, semDono[0].id.toUpperCase()], vera.id, ana)).toEqual({ alterados: 1, iguais: 0 });

    await expect(atribuir([semDono[1].id, "00000000-0000-4000-8000-999999999999"], vera.id, ana)).rejects.toThrow(LeadNaoEncontrado);
    expect(await responsavelNoBanco(semDono[1].id)).toBeNull();
    expect(await auditoria("atribuir_lead")).toHaveLength(1);
  });

  it("duas atribuições ao mesmo tempo no mesmo lead: uma espera a outra e a auditoria encadeia", async () => {
    const lead = semDono[2];
    await Promise.all([atribuir([lead.id], vera.id, ana), atribuir([lead.id], vitor.id, ana)]);
    const logs = await auditoria("atribuir_lead");
    expect(logs).toHaveLength(2);
    expect(logs[0].detalhe.anterior).toBeNull();
    expect((logs[1].detalhe.anterior as { id: string }).id).toBe((logs[0].detalhe.novo as { id: string }).id);
    expect((await responsavelNoBanco(lead.id))!.usuario_id).toBe((logs[1].detalhe.novo as { id: string }).id);
  });
});

describe("fila 'Sem responsável'", () => {
  it("inclui sem dono e dono desativado, dos cadastros mais recentes para os mais antigos", async () => {
    const { ids, pagina } = await idsDaFila();
    expect(new Set(ids)).toEqual(new Set([...semDono, ...doInativo].map((l) => l.id)));
    const datas = pagina.itens.map((l) => new Date(l.created_at).getTime());
    expect(datas).toEqual([...datas].sort((a, b) => b - a));
  });

  it("lead de vendedor desativado sai da fila ao ser atribuído (anterior = o desativado)", async () => {
    const lead = doInativo[0];
    await atribuir([lead.id], vera.id, ana);
    expect((await idsDaFila()).ids).not.toContain(lead.id);
    const [log] = await auditoria("atribuir_lead");
    expect(log.detalhe.anterior).toMatchObject({ id: USUARIOS_TESTE.inativo.id });
  });

  it("responsável que mudou para um papel que não pode ser responsável: o lead volta para a fila", async () => {
    await sqlDono("UPDATE painel_usuarios SET papel = 'suporte' WHERE id = $1", [vitor.id]);
    const { ids } = await idsDaFila();
    for (const l of leadsDe("vitor")) expect(ids).toContain(l.id);
  });
});

describe("contadores do menu", () => {
  it("por papel: admin vê os dois, suporte só 'para fechar', vendas e leitura nenhum", async () => {
    const agendados = LEADS.filter((l) => l.status === "agendado").length;
    expect(await contadoresDoMenu("admin")).toEqual({ semResponsavel: semDono.length + doInativo.length, paraFechar: agendados });
    expect(await contadoresDoMenu("suporte")).toEqual({ paraFechar: agendados });
    expect(await contadoresDoMenu("vendas")).toEqual({});
    expect(await contadoresDoMenu("leitura")).toEqual({});

    await atribuir([semDono[0].id, semDono[1].id], vera.id, ana);
    expect((await contadoresDoMenu("admin")).semResponsavel).toBe(semDono.length + doInativo.length - 2);
  });
});
