import { beforeEach, describe, expect, it } from "vitest";
import { anotacoesDoLead, anotar } from "@/lib/anotacoes";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { lerFiltros } from "@/lib/filtrosLeads";
import { lerFiltrosPipeline } from "@/lib/filtrosPipeline";
import { indicadoresDoFunil } from "@/lib/funil";
import { funilComercial } from "@/lib/funilComercial";
import { abrirFicha, contadoresDoMenu, listarLeads, principalVisivelDe, type QuemConsulta } from "@/lib/leads";
import {
  cadastrosMescladosEm,
  candidatosParaMescla,
  compararParaMescla,
  desfazerMescla,
  duplicadosSugeridosPara,
  mesclar,
  possiveisDuplicados,
} from "@/lib/mescla";
import { origemDosLeads } from "@/lib/origem";
import { perfilDosLeads } from "@/lib/perfil";
import { mudarEtapa, quadroDoPipeline } from "@/lib/pipeline";
import { LEADS, leadsDe, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { auditoria, limparTudo, sqlDono } from "./apoio";

const quem = (u: keyof typeof USUARIOS_TESTE): QuemConsulta => ({ id: USUARIOS_TESTE[u].id, papel: USUARIOS_TESTE[u].papel });
const ana = quem("ana");
const vera = quem("vera");
const sergio = quem("sergio");
const SEM_DONO = LEADS.filter((l) => l.dono === null);
const DA_VERA = leadsDe("vera");
const tudo = lerFiltrosFunil({ periodo: "tudo" });

async function mescladosNoBanco() {
  return sqlDono<{ duplicado_id: string; principal_id: string }>(
    "SELECT duplicado_id, principal_id FROM painel_lead_mescla ORDER BY duplicado_id",
  );
}

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
});

describe("regras da mescla", () => {
  it("só admin", async () => {
    await expect(mesclar(sergio, SEM_DONO[0].id, SEM_DONO[1].id)).rejects.toMatchObject({ motivo: "sem_permissao" });
    await expect(mesclar(vera, DA_VERA[0].id, DA_VERA[1].id)).rejects.toMatchObject({ motivo: "sem_permissao" });
    expect(await mescladosNoBanco()).toEqual([]);
  });

  it("não mescla consigo mesmo, nem com quem já é duplicado (como duplicado ou como principal)", async () => {
    const [a, b, c] = SEM_DONO;
    await expect(mesclar(ana, a.id, a.id)).rejects.toThrow(/com ele mesmo/);
    await mesclar(ana, a.id, b.id);
    await expect(mesclar(ana, c.id, b.id)).rejects.toThrow(/já foi mesclado/);
    await expect(mesclar(ana, b.id, c.id)).rejects.toThrow(/principal já foi mesclado/);
    expect(await mescladosNoBanco()).toEqual([{ duplicado_id: b.id, principal_id: a.id }]);
    // O banco também recusa (CHECK).
    await expect(sqlDono("INSERT INTO painel_lead_mescla (duplicado_id, principal_id) VALUES ($1, $1)", [c.id])).rejects.toThrow();
  });

  it("principal sem responsável herda o do duplicado (com auditoria); com responsável, mantém o seu", async () => {
    const semDono = SEM_DONO[0];
    const r = await mesclar(ana, semDono.id, DA_VERA[0].id);
    expect(r.herdouResponsavel).toEqual({ id: vera.id, nome: "Vera Vendas" });
    expect(await sqlDono("SELECT usuario_id FROM painel_lead_responsavel WHERE lead_id = $1", [semDono.id])).toEqual([{ usuario_id: vera.id }]);
    expect((await auditoria("atribuir_lead")).at(-1)?.detalhe).toMatchObject({ motivo: "mescla", novo: { id: vera.id } });
    // Agora a vendedora vê o principal.
    expect(await abrirFicha(vera, semDono.id, "api")).not.toBeNull();

    const r2 = await mesclar(ana, DA_VERA[1].id, leadsDe("vitor")[0].id);
    expect(r2.herdouResponsavel).toBeNull();
    expect(await sqlDono("SELECT usuario_id FROM painel_lead_responsavel WHERE lead_id = $1", [DA_VERA[1].id])).toEqual([{ usuario_id: vera.id }]);
  });

  it("responsável desativado conta como sem responsável: herda o válido; duplicado com desativado não passa nada", async () => {
    const doInativo = leadsDe("inativo");
    await mesclar(ana, doInativo[0].id, DA_VERA[2].id);
    expect(await sqlDono("SELECT usuario_id FROM painel_lead_responsavel WHERE lead_id = $1", [doInativo[0].id])).toEqual([{ usuario_id: vera.id }]);
    const r = await mesclar(ana, SEM_DONO[3].id, doInativo[1].id);
    expect(r.herdouResponsavel).toBeNull();
  });

  it("o principal mantém a própria etapa e origem", async () => {
    await mudarEtapa(ana, SEM_DONO[1].id, { esperada: "nao_contatado", etapa: "negociacao" });
    await sqlDono("UPDATE teste7d_inscricoes SET utm_source = 'google' WHERE id = $1", [SEM_DONO[1].id]);
    await mesclar(ana, SEM_DONO[0].id, SEM_DONO[1].id);
    const ficha = await abrirFicha(ana, SEM_DONO[0].id, "api");
    expect(ficha).toMatchObject({ etapa_comercial: "nao_contatado", utm_source: "facebook" });
  });

  it("encadeamento: os duplicados de um principal mesclado passam para o novo principal; desfazer devolve", async () => {
    const [a, b, c, d] = SEM_DONO;
    await mesclar(ana, b.id, a.id); // a → b
    await mesclar(ana, b.id, d.id); // d → b
    const r = await mesclar(ana, c.id, b.id); // b → c: a e d vão para c
    expect(r.reapontados.sort()).toEqual([a.id, d.id].sort());
    expect(await mescladosNoBanco()).toEqual(
      [
        { duplicado_id: a.id, principal_id: c.id },
        { duplicado_id: b.id, principal_id: c.id },
        { duplicado_id: d.id, principal_id: c.id },
      ].sort((x, y) => x.duplicado_id.localeCompare(y.duplicado_id)),
    );

    const desfeito = await desfazerMescla(ana, b.id);
    expect(desfeito).toMatchObject({ principal: c.id });
    expect(desfeito.devolvidos.sort()).toEqual([a.id, d.id].sort());
    expect(await mescladosNoBanco()).toEqual(
      [
        { duplicado_id: a.id, principal_id: b.id },
        { duplicado_id: d.id, principal_id: b.id },
      ].sort((x, y) => x.duplicado_id.localeCompare(y.duplicado_id)),
    );
    const [logM] = await auditoria("desfazer_mescla");
    expect(logM).toMatchObject({ usuario_id: ana.id, detalhe: { principal: c.id, duplicado: b.id } });
    expect(await auditoria("mesclar_leads")).toHaveLength(3);

    await expect(desfazerMescla(ana, b.id)).rejects.toThrow(/não está mesclado/);
    await expect(desfazerMescla(ana, "00000000-0000-4000-8000-999999999999")).rejects.toMatchObject({ motivo: "nao_encontrado" });
    await expect(desfazerMescla(sergio, a.id)).rejects.toMatchObject({ motivo: "sem_permissao" });
  });

  it("ficha do duplicado: some (404) e aponta para o principal, se visível", async () => {
    const [a, b] = SEM_DONO;
    await mesclar(ana, a.id, b.id);
    expect(await abrirFicha(ana, b.id, "api")).toBeNull();
    expect(await principalVisivelDe(ana, b.id)).toBe(a.id);
    expect(await principalVisivelDe(sergio, b.id)).toBe(a.id);
    // Vendedora não vê o principal (sem responsável): sem redirecionamento.
    expect(await principalVisivelDe(vera, b.id)).toBeNull();
  });

  it("o principal mostra os mesclados, com as anotações dos dois", async () => {
    const [a, b] = SEM_DONO;
    await anotar(ana, b.id, "anotação no duplicado");
    await anotar(ana, a.id, "anotação no principal");
    await mesclar(ana, a.id, b.id);
    expect((await cadastrosMescladosEm(ana, a.id)).map((m) => m.id)).toEqual([b.id]);
    expect((await anotacoesDoLead(ana, a.id))!.map((x) => x.texto)).toEqual(["anotação no principal", "anotação no duplicado"]);
    // Duplicado não aceita etapa nem anotação nova.
    await expect(anotar(ana, b.id, "x")).rejects.toMatchObject({ motivo: "nao_encontrado" });
    await expect(mudarEtapa(ana, b.id, { esperada: "nao_contatado", etapa: "negociacao" })).rejects.toMatchObject({ motivo: "nao_encontrado" });
  });
});

describe("o duplicado sai de TODAS as listas e contagens", () => {
  it("lista, pipeline, funil, funil comercial, perfil, origem e contadores", async () => {
    const dup = SEM_DONO[1]; // sem responsável
    const antes = {
      lista: (await listarLeads(ana, lerFiltros({}, "admin"))).total,
      quadro: (await quadroDoPipeline(ana, lerFiltrosPipeline({}, "admin"))).reduce((s, c) => s + c.total, 0),
      funil: (await indicadoresDoFunil(tudo)).resumo.cadastros,
      comercial: (await funilComercial(tudo, "admin")).total,
      perfil: (await perfilDosLeads(tudo, "admin")).cadastros,
      origem: (await origemDosLeads(tudo, "admin")).total.cadastros,
      menu: await contadoresDoMenu("admin"),
      busca: (await listarLeads(ana, lerFiltros({ q: dup.email }, "admin"))).total,
    };
    await mesclar(ana, SEM_DONO[0].id, dup.id);
    expect((await listarLeads(ana, lerFiltros({}, "admin"))).total).toBe(antes.lista - 1);
    expect((await quadroDoPipeline(ana, lerFiltrosPipeline({}, "admin"))).reduce((s, c) => s + c.total, 0)).toBe(antes.quadro - 1);
    expect((await indicadoresDoFunil(tudo)).resumo.cadastros).toBe(antes.funil - 1);
    expect((await funilComercial(tudo, "admin")).total).toBe(antes.comercial! - 1);
    expect((await perfilDosLeads(tudo, "admin")).cadastros).toBe(antes.perfil! - 1);
    expect((await origemDosLeads(tudo, "admin")).total.cadastros).toBe(antes.origem! - 1);
    expect((await contadoresDoMenu("admin")).semResponsavel).toBe(antes.menu.semResponsavel! - 1);
    expect(antes.busca).toBe(1);
    expect((await listarLeads(ana, lerFiltros({ q: dup.email }, "admin"))).total).toBe(0);

    // Desfazer devolve tudo.
    await desfazerMescla(ana, dup.id);
    expect((await indicadoresDoFunil(tudo)).resumo.cadastros).toBe(antes.funil);
    expect((await listarLeads(ana, lerFiltros({}, "admin"))).total).toBe(antes.lista);
  });

  it("“Reuniões para fechar” também não conta o duplicado agendado", async () => {
    const agendado = SEM_DONO.find((l) => l.status === "agendado")!;
    const antes = (await contadoresDoMenu("suporte")).paraFechar!;
    await mesclar(ana, SEM_DONO.find((l) => l.id !== agendado.id)!.id, agendado.id);
    expect((await contadoresDoMenu("suporte")).paraFechar).toBe(antes - 1);
  });
});

describe("busca, comparação e sugestão", () => {
  it("busca por nome, e-mail ou WhatsApp, sem o próprio lead e sem os já mesclados", async () => {
    const [a, b, c] = SEM_DONO;
    expect((await candidatosParaMescla(ana, a.id, b.email)).map((x) => x.id)).toEqual([b.id]);
    expect((await candidatosParaMescla(ana, a.id, c.whatsapp.slice(-6))).map((x) => x.id)).toEqual([c.id]);
    expect(await candidatosParaMescla(ana, a.id, a.email)).toEqual([]);
    await mesclar(ana, c.id, b.id);
    expect(await candidatosParaMescla(ana, a.id, b.email)).toEqual([]);
    await expect(candidatosParaMescla(vera, a.id, "a")).rejects.toMatchObject({ motivo: "sem_permissao" });
  });

  it("comparação sugere o mais avançado (etapa comercial, depois situação do teste, depois o mais antigo)", async () => {
    const [a, b] = [LEADS[18], LEADS[23]]; // ambos "inscrito"; b é o cadastro mais antigo
    const agendado = LEADS[17];
    expect(a.status).toBe(b.status);
    expect((await compararParaMescla(ana, a.id, b.id))!.sugerido).toBe(b.id);
    expect((await compararParaMescla(ana, a.id, agendado.id))!.sugerido).toBe(agendado.id);
    await mudarEtapa(ana, a.id, { esperada: "nao_contatado", etapa: "negociacao" });
    const c = await compararParaMescla(ana, a.id, agendado.id);
    expect(c!.sugerido).toBe(a.id);
    expect(c!.a).toMatchObject({ id: a.id, nome: a.nome, email: a.email, etapa_comercial: "negociacao" });
    expect(await compararParaMescla(ana, a.id, a.id)).toBeNull();
  });

  it("possíveis duplicados: mesmo WhatsApp normalizado (com e sem nono dígito) ou mesmo nome normalizado; nada é mesclado", async () => {
    const [a, b, c] = SEM_DONO;
    // b: mesmo número de a, sem o nono dígito.
    const semNono = a.whatsapp.slice(0, 4) + a.whatsapp.slice(5);
    await sqlDono("UPDATE teste7d_inscricoes SET whatsapp = $2 WHERE id = $1", [b.id, semNono]);
    // c: mesmo nome de a, com acento e maiúsculas diferentes.
    await sqlDono("UPDATE teste7d_inscricoes SET nome = $2 WHERE id = $1", [c.id, `  ${a.nome.toUpperCase()}.`]);
    await sqlDono("UPDATE teste7d_inscricoes SET nome = 'Zélia Quaresma' WHERE id = $1", [a.id]);
    await sqlDono("UPDATE teste7d_inscricoes SET nome = 'ZELIA  quaresma!' WHERE id = $1", [c.id]);

    const grupos = await possiveisDuplicados(ana);
    const ids = grupos.map((g) => g.leads.map((l) => l.id).sort());
    expect(ids).toContainEqual([a.id, b.id].sort());
    expect(grupos.some((g) => g.criterio === "nome" && g.leads.some((l) => l.id === c.id))).toBe(true);
    expect((await duplicadosSugeridosPara(ana, a.id)).map((x) => x.id).sort()).toEqual([b.id, c.id].sort());
    expect(await mescladosNoBanco()).toEqual([]);
    await expect(possiveisDuplicados(sergio)).rejects.toMatchObject({ motivo: "sem_permissao" });
  });
});
