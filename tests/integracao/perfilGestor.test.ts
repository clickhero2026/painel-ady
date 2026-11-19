import { beforeEach, describe, expect, it } from "vitest";
import { anotacoesDoLead, anotar, podeAnotar } from "@/lib/anotacoes";
import { apagarLead } from "@/lib/apagarLead";
import { atribuir, responsaveisPossiveis } from "@/lib/atribuicao";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { lerFiltros, podeFiltrarResponsavel } from "@/lib/filtrosLeads";
import { lerFiltrosPipeline } from "@/lib/filtrosPipeline";
import { funilComercial } from "@/lib/funilComercial";
import { criarLeadManual, podeCriarLead } from "@/lib/leadManual";
import { abrirFicha, contadoresDoMenu, linkDeAtivacao, listarLeads, type QuemConsulta } from "@/lib/leads";
import { desfazerMescla, mesclar, podeMesclar, possiveisDuplicados } from "@/lib/mescla";
import { origemDosLeads } from "@/lib/origem";
import { PAPEIS, PAPEIS_ATRIBUIVEIS, PAPEIS_RESPONSAVEL, podeAcessar, type Papel } from "@/lib/papeis";
import { perfilDosLeads } from "@/lib/perfil";
import { etapaDoLead, mudarEtapa, podeMudarEtapa, quadroDoPipeline } from "@/lib/pipeline";
import { alterarPapel, criarUsuario } from "@/lib/usuarios";
import { LEADS, leadsDe, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { auditoria, db, limparTudo, sqlDono } from "./apoio";

/**
 * Perfil gestor (20261119_perfil_gestor.sql): suporte + vendas em TODOS os
 * leads. Vê tudo, muda etapa, anota, cadastra lead manual (sem responsável).
 * Não atribui, não mescla, não exporta, não gerencia usuários, não apaga e
 * não é responsável por lead. O app roda como painel_app.
 */

const GESTOR = { id: "10000000-0000-4000-8000-0000000000bb", email: "gina@useady.com.br", nome: "Gina Gestora" };
const gestor: QuemConsulta = { id: GESTOR.id, papel: "gestor" };
const quem = (u: keyof typeof USUARIOS_TESTE): QuemConsulta => ({ id: USUARIOS_TESTE[u].id, papel: USUARIOS_TESTE[u].papel });
const ana = quem("ana");
const vera = quem("vera");
const SEM_DONO = LEADS.filter((l) => l.dono === null);
const tudo = lerFiltrosFunil({ periodo: "tudo" });

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
  await sqlDono("INSERT INTO painel_usuarios (id, email, nome, papel, ativo) VALUES ($1, $2, $3, 'gestor', true)", [
    GESTOR.id,
    GESTOR.email,
    GESTOR.nome,
  ]);
});

describe("gestor: papel e mapa de acesso", () => {
  it("é um papel do painel, atribuível pela tela, e não é responsável", () => {
    expect(PAPEIS).toContain("gestor");
    expect(PAPEIS_ATRIBUIVEIS).toContain("gestor");
    expect(PAPEIS_RESPONSAVEL as readonly Papel[]).not.toContain("gestor");
  });

  it("pode: leads, pipeline, etapa, anotar, reunião, lead manual, funil e perfil; não pode o resto", () => {
    const pode = ["inicio", "leads", "funil", "perfil", "marcarReuniao", "pipeline", "mudarEtapa", "anotar", "criarLead"] as const;
    const naoPode = ["exportarFunil", "exportarOrigem", "usuarios", "atribuir", "mesclar", "apagarLead"] as const;
    for (const area of pode) expect(podeAcessar("gestor", area), area).toBe(true);
    for (const area of naoPode) expect(podeAcessar("gestor", area), area).toBe(false);
    expect(podeMudarEtapa("gestor")).toBe(true);
    expect(podeAnotar("gestor")).toBe(true);
    expect(podeCriarLead("gestor")).toBe(true);
    expect(podeMesclar("gestor")).toBe(false);
    expect(podeFiltrarResponsavel("gestor")).toBe(true);
  });
});

describe("gestor: vê e trabalha em TODOS os leads", () => {
  it("lista e pipeline com os mesmos leads do admin (sem os mesclados)", async () => {
    const [principal, duplicado] = SEM_DONO;
    await mesclar(ana, principal.id, duplicado.id);
    const total = (u: QuemConsulta) => listarLeads(u, lerFiltros({}, u.papel)).then((p) => p.total);
    expect(await total(gestor)).toBe(await total(ana));
    const quadro = (u: QuemConsulta) =>
      quadroDoPipeline(u, lerFiltrosPipeline({}, u.papel)).then((c) => c.reduce((s, x) => s + x.total, 0));
    expect(await quadro(gestor)).toBe(await quadro(ana));
    // O mesclado como duplicado continua fora (ficha = null → 404 na tela e na API).
    expect(await abrirFicha(gestor, duplicado.id, "api")).toBeNull();
    expect(await abrirFicha(gestor, principal.id, "api")).not.toBeNull();
  });

  it("lê ficha, dados pessoais e link de ativação de lead de vendedor e de lead sem responsável", async () => {
    for (const lead of [leadsDe("vera")[0], leadsDe("vitor")[0], SEM_DONO[0]]) {
      const ficha = await abrirFicha(gestor, lead.id, "api");
      expect(ficha, lead.nome).toMatchObject({ id: lead.id, email: lead.email, nome: lead.nome });
      expect(await linkDeAtivacao(gestor, lead.id)).toMatch(/\?t=./);
    }
  });

  it("muda a etapa de lead da Vera, do Vitor e sem responsável, com histórico e auditoria", async () => {
    const alvos = [leadsDe("vera")[1], leadsDe("vitor")[1], SEM_DONO[1]];
    for (const lead of alvos) {
      await mudarEtapa(gestor, lead.id, { esperada: "nao_contatado", etapa: "tentativa_contato" });
      expect((await etapaDoLead(gestor, lead.id))?.etapa).toBe("tentativa_contato");
    }
    const historico = await sqlDono<{ lead_id: string }>(
      "SELECT lead_id FROM painel_lead_etapa_historico WHERE usuario_id = $1",
      [GESTOR.id],
    );
    expect(historico.map((h) => h.lead_id).sort()).toEqual(alvos.map((l) => l.id).sort());
    const logs = await auditoria("mudar_etapa");
    expect(logs.filter((l) => l.usuario_id === GESTOR.id)).toHaveLength(3);
    // O responsável não muda.
    expect(await abrirFicha(ana, alvos[0].id, "api")).toMatchObject({ responsavel_id: USUARIOS_TESTE.vera.id });
  });

  it("lê e escreve anotações em qualquer lead, com auditoria sem o texto", async () => {
    const lead = leadsDe("vitor")[2];
    await anotar(vera, leadsDe("vera")[2].id, "Nota da Vera");
    await anotar(gestor, lead.id, "Nota da gestora");
    expect((await anotacoesDoLead(gestor, lead.id))?.map((a) => a.texto)).toEqual(["Nota da gestora"]);
    expect((await anotacoesDoLead(gestor, leadsDe("vera")[2].id))?.map((a) => a.texto)).toEqual(["Nota da Vera"]);
    const logs = (await auditoria("anotar_lead")).filter((l) => l.usuario_id === GESTOR.id);
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0].detalhe)).not.toContain("gestora");
  });

  it("vê a visão 'Reuniões para fechar' e o contador dela, mas não a fila 'Sem responsável'", async () => {
    expect(lerFiltros({ visao: "para_fechar" }, "gestor").visao).toBe("para_fechar");
    expect(lerFiltros({ visao: "sem_responsavel" }, "gestor").visao).toBeUndefined();
    const contadores = await contadoresDoMenu("gestor");
    expect(contadores.paraFechar).toBe((await contadoresDoMenu("admin")).paraFechar);
    expect(contadores.semResponsavel).toBeUndefined();
  });

  it("indicadores agregados como o admin (sem ocultar células como 'leitura')", async () => {
    expect(await funilComercial(tudo, "gestor")).toEqual(await funilComercial(tudo, "admin"));
    expect(await perfilDosLeads(tudo, "gestor")).toEqual(await perfilDosLeads(tudo, "admin"));
    expect(await origemDosLeads(tudo, "gestor")).toEqual(await origemDosLeads(tudo, "admin"));
  });
});

describe("gestor: lead manual entra em 'Sem responsável'", () => {
  it("o gestor não vira responsável e o lead aparece na fila do admin", async () => {
    const antes = (await contadoresDoMenu("admin")).semResponsavel!;
    const { id } = await criarLeadManual(gestor, { nome: "Lead Da Gestora", email: "lead.gestora@exemplo.com.br", whatsapp: "85999991111" });
    expect(await abrirFicha(gestor, id, "api")).toMatchObject({ responsavel_id: null });
    expect(await sqlDono("SELECT 1 FROM painel_lead_responsavel WHERE lead_id = $1", [id])).toHaveLength(0);
    expect((await contadoresDoMenu("admin")).semResponsavel).toBe(antes + 1);
    const [log] = await auditoria("criar_lead");
    expect(log).toMatchObject({ usuario_id: GESTOR.id });
    expect(log.detalhe).toMatchObject({ responsavel_id: null });
  });

  it("pedir um responsável (nem ele mesmo) é recusado e nada é gravado", async () => {
    for (const responsavelId of [USUARIOS_TESTE.vera.id, GESTOR.id]) {
      await expect(
        criarLeadManual(gestor, { nome: "Lead X", email: "lead.x@exemplo.com.br", whatsapp: "85999992222", responsavelId }),
      ).rejects.toMatchObject({ erros: { responsavel: expect.stringContaining("gestor") } });
    }
    expect(await sqlDono("SELECT 1 FROM teste7d_inscricoes WHERE email = 'lead.x@exemplo.com.br'")).toHaveLength(0);
  });

  it("não aparece entre os possíveis responsáveis e não pode receber lead (nem pelo admin)", async () => {
    expect((await responsaveisPossiveis()).map((r) => r.id)).not.toContain(GESTOR.id);
    await expect(atribuir([SEM_DONO[0].id], GESTOR.id, ana.id)).rejects.toThrow(/não pode ser responsável/);
  });

  it("vendedor promovido a gestor: os leads dele voltam para 'Sem responsável'", async () => {
    const antes = (await contadoresDoMenu("admin")).semResponsavel!;
    await alterarPapel(USUARIOS_TESTE.vitor.id, "gestor", ana.id);
    expect((await contadoresDoMenu("admin")).semResponsavel).toBe(antes + leadsDe("vitor").length);
  });
});

describe("gestor: o que NÃO pode", () => {
  it("não mescla, não desfaz mescla, não vê duplicados e não apaga lead", async () => {
    const [a, b] = SEM_DONO;
    await expect(mesclar(gestor, a.id, b.id)).rejects.toThrow();
    await mesclar(ana, a.id, b.id);
    await expect(desfazerMescla(gestor, b.id)).rejects.toThrow();
    await expect(possiveisDuplicados(gestor)).rejects.toThrow();
    await expect(apagarLead(gestor, a.id, a.email)).rejects.toMatchObject({ motivo: "sem_permissao" });
    expect(await auditoria("desfazer_mescla")).toHaveLength(0);
  });

  it("o gestor pode ser criado e promovido pela tela de Usuários (admin), com auditoria", async () => {
    const criado = await criarUsuario({ email: "novo.gestor@useady.com.br", nome: null, papel: "gestor" }, ana.id);
    expect(criado.papel).toBe("gestor");
    await alterarPapel(USUARIOS_TESTE.leo.id, "gestor", ana.id);
    expect((await auditoria("usuario_papel_alterado"))[0].detalhe).toMatchObject({ de: "leitura", para: "gestor" });
  });

  it("o banco aceita 'gestor' e continua recusando papel inventado", async () => {
    await db().query("UPDATE painel_usuarios SET papel = 'gestor' WHERE id = $1", [USUARIOS_TESTE.sergio.id]);
    await expect(db().query("UPDATE painel_usuarios SET papel = 'chefe' WHERE id = $1", [USUARIOS_TESTE.sergio.id])).rejects.toThrow(
      /painel_usuarios_papel_check/,
    );
  });

  it("gestor não conta como admin na trava do último admin", async () => {
    await expect(alterarPapel(ana.id, "gestor", ana.id)).rejects.toThrow("último admin");
  });
});
