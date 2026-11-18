import { beforeEach, describe, expect, it } from "vitest";
import { anotar } from "@/lib/anotacoes";
import { apagarLead, DEPENDENTES_DO_LEAD } from "@/lib/apagarLead";
import { atribuir, responsaveisPossiveis } from "@/lib/atribuicao";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { lerFiltros } from "@/lib/filtrosLeads";
import { lerFiltrosPipeline } from "@/lib/filtrosPipeline";
import { indicadoresDoFunil } from "@/lib/funil";
import { funilComercial } from "@/lib/funilComercial";
import { criarLeadManual } from "@/lib/leadManual";
import { abrirFicha, contadoresDoMenu, listarLeads, type QuemConsulta } from "@/lib/leads";
import { desfazerMescla, mesclar, possiveisDuplicados } from "@/lib/mescla";
import { origemDosLeads } from "@/lib/origem";
import type { Papel } from "@/lib/papeis";
import { perfilDosLeads } from "@/lib/perfil";
import { mudarEtapa, quadroDoPipeline } from "@/lib/pipeline";
import { marcarDesfecho } from "@/lib/reuniao";
import { alterarPapel, criarUsuario, definirAtivo, ErroUsuarios } from "@/lib/usuarios";
import { LEADS, leadsDe, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { auditoria, db, limparTudo, sqlDono } from "./apoio";

/**
 * Super admin (20261118_super_admin.sql) e "Apagar lead" (src/lib/apagarLead.ts).
 * O app roda como painel_app; o super admin é inserido pelo dono do banco,
 * como a migração faz (o painel_app não consegue: ver "trava no banco").
 */

const SUPER = { id: "10000000-0000-4000-8000-0000000000aa", email: "rafael@clickhero.com.br", nome: "Rafael" };
const quem = (u: keyof typeof USUARIOS_TESTE): QuemConsulta => ({ id: USUARIOS_TESTE[u].id, papel: USUARIOS_TESTE[u].papel });
const ana = quem("ana");
const vera = quem("vera");
const sergio = quem("sergio");
const leo = quem("leo");
const superAdmin: QuemConsulta = { id: SUPER.id, papel: "super_admin" };
const SEM_DONO = LEADS.filter((l) => l.dono === null);
const DA_VERA = leadsDe("vera");
const tudo = lerFiltrosFunil({ periodo: "tudo" });

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
  await sqlDono("INSERT INTO painel_usuarios (id, email, nome, papel, ativo) VALUES ($1, $2, $3, 'super_admin', true)", [
    SUPER.id,
    SUPER.email,
    SUPER.nome,
  ]);
});

async function existe(id: string) {
  return (await sqlDono("SELECT 1 FROM teste7d_inscricoes WHERE id = $1", [id])).length === 1;
}

async function dependentes(id: string) {
  const [linha] = await sqlDono<{ n: number }>(
    `SELECT (${DEPENDENTES_DO_LEAD.map(([t, c]) => `(SELECT count(*) FROM ${t} WHERE ${c} = $1)`).join(" + ")})::int AS n`,
    [id],
  );
  return linha.n;
}

/** Lead da Vera com responsável, etapa, histórico, anotação e (opcional) um duplicado mesclado nele. */
async function leadCompleto() {
  const lead = DA_VERA[0];
  await mudarEtapa(vera, lead.id, { esperada: "nao_contatado", etapa: "tentativa_contato" });
  await anotar(vera, lead.id, "Ligar amanhã");
  expect(await dependentes(lead.id)).toBe(4); // responsável, etapa, histórico, anotação
  return lead;
}

describe("apagar lead: quem pode", () => {
  it("admin, suporte, vendas e leitura recebem sem_permissao e nada é apagado", async () => {
    const lead = await leadCompleto();
    for (const usuario of [ana, sergio, vera, leo]) {
      await expect(apagarLead(usuario, lead.id, lead.email)).rejects.toMatchObject({ motivo: "sem_permissao" });
    }
    expect(await existe(lead.id)).toBe(true);
    expect(await dependentes(lead.id)).toBe(4);
    expect(await auditoria("apagar_lead")).toHaveLength(0);
  });

  it("o papel vale o do banco, não o que veio de fora (admin dizendo ser super_admin não passa)", async () => {
    const lead = DA_VERA[1];
    await expect(apagarLead({ id: ana.id, papel: "super_admin" }, lead.id, lead.email)).rejects.toMatchObject({
      motivo: "sem_permissao",
    });
    expect(await existe(lead.id)).toBe(true);
  });

  it("super admin desativado não apaga", async () => {
    await sqlDono("UPDATE painel_usuarios SET ativo = false WHERE id = $1", [SUPER.id]);
    await expect(apagarLead(superAdmin, DA_VERA[1].id, DA_VERA[1].email)).rejects.toMatchObject({ motivo: "sem_permissao" });
    expect(await existe(DA_VERA[1].id)).toBe(true);
  });
});

describe("apagar lead: o que acontece", () => {
  it("super admin apaga o lead e tudo o que depende dele; nada fica órfão", async () => {
    const lead = await leadCompleto();
    await apagarLead(superAdmin, lead.id, lead.email.toUpperCase());
    expect(await existe(lead.id)).toBe(false);
    expect(await dependentes(lead.id)).toBe(0);
    expect(await abrirFicha(ana, lead.id, "api")).toBeNull();
  });

  it("auditoria apagar_lead sem dados pessoais", async () => {
    const lead = await leadCompleto();
    await apagarLead(superAdmin, lead.id, lead.email);
    const registros = await sqlDono<{ usuario_id: string; lead_id: string; detalhe: Record<string, unknown> }>(
      "SELECT usuario_id, lead_id, detalhe FROM painel_auditoria WHERE acao = 'apagar_lead'",
    );
    expect(registros).toHaveLength(1);
    const [r] = registros;
    expect(r.usuario_id).toBe(SUPER.id);
    expect(r.lead_id).toBe(lead.id);
    expect(Object.keys(r.detalhe).sort()).toEqual(["created_at", "lp_variant", "status", "utm_campaign", "utm_content"]);
    expect(r.detalhe).toMatchObject({ status: lead.status, utm_content: lead.utm_content, utm_campaign: lead.utm_campaign, lp_variant: lead.lp_variant });
    // Nenhum registro de auditoria (de nenhuma ação) guarda nome, e-mail, WhatsApp ou token do lead.
    const todos = JSON.stringify(await sqlDono("SELECT detalhe FROM painel_auditoria"));
    for (const pessoal of [lead.nome, lead.email, lead.whatsapp, lead.token]) expect(todos).not.toContain(pessoal);
  });

  it("e-mail de confirmação errado: nada é apagado", async () => {
    const lead = DA_VERA[2];
    await expect(apagarLead(superAdmin, lead.id, "outro@exemplo.com.br")).rejects.toMatchObject({ motivo: "confirmacao" });
    expect(await existe(lead.id)).toBe(true);
  });

  it("lead inexistente ou id inválido: nao_encontrado", async () => {
    await expect(apagarLead(superAdmin, "10000000-0000-4000-8000-00000000ffff", "x@y.com")).rejects.toMatchObject({
      motivo: "nao_encontrado",
    });
    await expect(apagarLead(superAdmin, "nao-e-uuid", "x@y.com")).rejects.toMatchObject({ motivo: "nao_encontrado" });
  });

  it("mesclado: duplicado e principal com duplicados são recusados; depois de desfazer, apaga", async () => {
    const [principal, duplicado] = SEM_DONO;
    await mesclar(ana, principal.id, duplicado.id);
    await expect(apagarLead(superAdmin, duplicado.id, duplicado.email)).rejects.toMatchObject({ motivo: "invalido" });
    await expect(apagarLead(superAdmin, principal.id, principal.email)).rejects.toThrow(/1 cadastro mesclado/);
    expect(await existe(principal.id)).toBe(true);
    expect(await existe(duplicado.id)).toBe(true);

    await desfazerMescla(ana, duplicado.id);
    await apagarLead(superAdmin, principal.id, principal.email);
    expect(await existe(principal.id)).toBe(false);
    expect(await existe(duplicado.id)).toBe(true);
  });

  it("falha no meio (auditoria recusada): a transação é desfeita e nada é apagado", async () => {
    const lead = await leadCompleto();
    await sqlDono("REVOKE INSERT ON painel_auditoria FROM painel_app");
    try {
      await expect(apagarLead(superAdmin, lead.id, lead.email)).rejects.toThrow(/permission denied/);
    } finally {
      await sqlDono("GRANT INSERT ON painel_auditoria TO painel_app");
    }
    expect(await existe(lead.id)).toBe(true);
    expect(await dependentes(lead.id)).toBe(4);
  });

  it("chave estrangeira sem CASCADE no banco: nada é apagado", async () => {
    const lead = DA_VERA[3];
    await sqlDono("CREATE TABLE teste_dependente (lead_id uuid REFERENCES teste7d_inscricoes(id))");
    try {
      await sqlDono("INSERT INTO teste_dependente VALUES ($1)", [lead.id]);
      await expect(apagarLead(superAdmin, lead.id, lead.email)).rejects.toThrow();
      expect(await existe(lead.id)).toBe(true);
    } finally {
      await sqlDono("DROP TABLE teste_dependente");
    }
  });

  it("funil, funil comercial, perfil, origem, lista, pipeline e menu refletem a exclusão na hora", async () => {
    const lead = SEM_DONO[2];
    const contar = async () => ({
      lista: (await listarLeads(ana, lerFiltros({}, "admin"))).total,
      quadro: (await quadroDoPipeline(ana, lerFiltrosPipeline({}, "admin"))).reduce((s, c) => s + c.total, 0),
      funil: (await indicadoresDoFunil(tudo)).resumo.cadastros,
      comercial: (await funilComercial(tudo, "admin")).total!,
      perfil: (await perfilDosLeads(tudo, "admin")).cadastros!,
      origem: (await origemDosLeads(tudo, "admin")).total.cadastros!,
      semResponsavel: (await contadoresDoMenu("admin")).semResponsavel!,
    });
    const antes = await contar();
    await apagarLead(superAdmin, lead.id, lead.email);
    const depois = await contar();
    for (const chave of Object.keys(antes) as (keyof typeof antes)[]) expect(depois[chave], chave).toBe(antes[chave] - 1);
  });
});

describe("super admin: tudo o que o admin faz", () => {
  it("vê todos os leads, atribui, marca reunião, muda etapa, anota, mescla, vê duplicados e cadastra lead com responsável", async () => {
    const filtros = (p: Papel) => lerFiltros({}, p);
    expect((await listarLeads(superAdmin, filtros("super_admin"))).total).toBe((await listarLeads(ana, filtros("admin"))).total);
    expect(lerFiltros({ visao: "sem_responsavel" }, "super_admin").visao).toBe("sem_responsavel");
    expect(await contadoresDoMenu("super_admin")).toEqual(await contadoresDoMenu("admin"));

    const [a, b, c] = SEM_DONO;
    await atribuir([a.id], USUARIOS_TESTE.vera.id, SUPER.id);
    const agendado = LEADS.find((l) => l.status === "agendado")!;
    await marcarDesfecho(agendado.id, "realizado", SUPER.id);
    await mudarEtapa(superAdmin, b.id, { esperada: "nao_contatado", etapa: "negociacao" });
    await anotar(superAdmin, b.id, "Nota do super admin");
    await mesclar(superAdmin, b.id, c.id);
    expect(Array.isArray(await possiveisDuplicados(superAdmin))).toBe(true);
    const { id } = await criarLeadManual(superAdmin, {
      nome: "Lead Do Super",
      email: "lead.super@exemplo.com.br",
      whatsapp: "85999990000",
      responsavelId: USUARIOS_TESTE.vitor.id,
    });
    expect(await abrirFicha(superAdmin, id, "api")).toMatchObject({ responsavel_id: USUARIOS_TESTE.vitor.id });
  });

  it("pode ser responsável por lead (como admin), e aparece nas opções", async () => {
    expect((await responsaveisPossiveis()).map((r) => r.id)).toContain(SUPER.id);
    await atribuir([SEM_DONO[0].id], SUPER.id, ana.id);
    expect(await abrirFicha(ana, SEM_DONO[0].id, "api")).toMatchObject({ responsavel_nome: SUPER.nome });
  });

  it("gerencia usuários (cria, muda papel, desativa outros)", async () => {
    const criado = await criarUsuario({ email: "nova@useady.com.br", nome: null, papel: "vendas" }, SUPER.id);
    await alterarPapel(criado.id, "suporte", SUPER.id);
    await definirAtivo(criado.id, false, SUPER.id);
    expect(await auditoria("usuario_desativado")).toHaveLength(1);
  });
});

describe("super admin: ninguém mexe pelo painel", () => {
  it("admin não rebaixa, não desativa, não promove ninguém a super admin e não cria super admin", async () => {
    await expect(alterarPapel(SUPER.id, "admin", ana.id)).rejects.toThrow(ErroUsuarios);
    await expect(alterarPapel(SUPER.id, "leitura", ana.id)).rejects.toThrow("super admin");
    await expect(definirAtivo(SUPER.id, false, ana.id)).rejects.toThrow("super admin");
    await expect(alterarPapel(USUARIOS_TESTE.vera.id, "super_admin", ana.id)).rejects.toThrow(ErroUsuarios);
    await expect(
      criarUsuario({ email: "outro.super@useady.com.br", nome: null, papel: "super_admin" }, ana.id),
    ).rejects.toThrow(ErroUsuarios);
    // Nem o próprio super admin se rebaixa pelo painel.
    await expect(alterarPapel(SUPER.id, "admin", SUPER.id)).rejects.toThrow("super admin");
    const [linha] = await sqlDono<{ papel: string; ativo: boolean }>("SELECT papel, ativo FROM painel_usuarios WHERE id = $1", [SUPER.id]);
    expect(linha).toEqual({ papel: "super_admin", ativo: true });
    expect(await auditoria("usuario_papel_alterado")).toHaveLength(0);
  });

  it("trava no banco: o painel_app não muda papel, acesso nem e-mail do super admin, não apaga, não cria e não promove", async () => {
    const bloqueado = /super admin|super_admin/;
    await expect(db().query("UPDATE painel_usuarios SET papel = 'admin' WHERE id = $1", [SUPER.id])).rejects.toThrow(bloqueado);
    await expect(db().query("UPDATE painel_usuarios SET ativo = false WHERE id = $1", [SUPER.id])).rejects.toThrow(bloqueado);
    await expect(db().query("UPDATE painel_usuarios SET email = 'x@y.com' WHERE id = $1", [SUPER.id])).rejects.toThrow(bloqueado);
    await expect(db().query("DELETE FROM painel_usuarios WHERE id = $1", [SUPER.id])).rejects.toThrow(bloqueado);
    await expect(
      db().query("INSERT INTO painel_usuarios (email, papel) VALUES ('novo.super@useady.com.br', 'super_admin')"),
    ).rejects.toThrow(bloqueado);
    await expect(db().query("UPDATE painel_usuarios SET papel = 'super_admin' WHERE id = $1", [ana.id])).rejects.toThrow(
      bloqueado,
    );
    // O que o login faz continua funcionando.
    await db().query("UPDATE painel_usuarios SET ultimo_acesso_em = now() WHERE id = $1", [SUPER.id]);
    // O dono do banco (ajuste manual) pode.
    await sqlDono("UPDATE painel_usuarios SET nome = 'Rafael R' WHERE id = $1", [SUPER.id]);
    await sqlDono("UPDATE painel_usuarios SET ativo = false WHERE id = $1", [SUPER.id]);
    await sqlDono("UPDATE painel_usuarios SET ativo = true WHERE id = $1", [SUPER.id]);
  });

  it("no máximo um super admin (nem o dono do banco cria um segundo)", async () => {
    await expect(sqlDono("UPDATE painel_usuarios SET papel = 'super_admin' WHERE id = $1", [ana.id])).rejects.toThrow(
      /painel_usuarios_um_super_admin_uidx/,
    );
  });
});

describe("último admin ativo conta admin + super admin", () => {
  it("com o super admin ativo, o único admin comum pode ser rebaixado e desativado", async () => {
    await alterarPapel(ana.id, "leitura", SUPER.id);
    await alterarPapel(ana.id, "admin", SUPER.id);
    await definirAtivo(ana.id, false, SUPER.id);
    const [n] = await sqlDono<{ n: number }>(
      "SELECT count(*)::int AS n FROM painel_usuarios WHERE ativo AND papel IN ('admin', 'super_admin')",
    );
    expect(n.n).toBe(1);
  });

  it("sem super admin ativo, o último admin continua protegido (código e banco)", async () => {
    await sqlDono("UPDATE painel_usuarios SET ativo = false WHERE id = $1", [SUPER.id]);
    await expect(alterarPapel(ana.id, "leitura", ana.id)).rejects.toThrow("último admin");
    await expect(definirAtivo(ana.id, false, USUARIOS_TESTE.sergio.id)).rejects.toThrow("último admin");
    // Banco: mesmo por fora do código, o painel_app não zera os admins.
    await expect(db().query("UPDATE painel_usuarios SET papel = 'leitura' WHERE id = $1", [ana.id])).rejects.toThrow(
      /pelo menos um admin/,
    );
    // DELETE: um admin sem vínculos (a Ana é referenciada por atribuições) como o único ativo.
    const [{ id: unico }] = await sqlDono<{ id: string }>(
      "INSERT INTO painel_usuarios (email, papel) VALUES ('unico.admin@useady.com.br', 'admin') RETURNING id",
    );
    await sqlDono("UPDATE painel_usuarios SET ativo = false WHERE id = $1", [ana.id]);
    await expect(db().query("DELETE FROM painel_usuarios WHERE id = $1", [unico])).rejects.toThrow(/pelo menos um admin/);
    await sqlDono("UPDATE painel_usuarios SET ativo = true WHERE id = $1", [ana.id]);
    // Mudanças que não tiram admin passam.
    await db().query("UPDATE painel_usuarios SET papel = 'suporte' WHERE id = $1", [USUARIOS_TESTE.leo.id]);
  });
});
