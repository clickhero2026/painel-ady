import { beforeEach, describe, expect, it } from "vitest";
import { URL_ATIVAR_CONTA } from "@/config/contato";
import { MAX_ANOTACAO } from "@/config/pipeline";
import { anotacoesDoLead } from "@/lib/anotacoes";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { lerFiltros } from "@/lib/filtrosLeads";
import { lerFiltrosPipeline } from "@/lib/filtrosPipeline";
import { indicadoresDoFunil, opcoesDoFunil } from "@/lib/funil";
import { funilComercial } from "@/lib/funilComercial";
import { criarLeadManual, ErroLeadManual, MENSAGEM_EMAIL_EXISTENTE } from "@/lib/leadManual";
import {
  abrirFicha,
  contadoresDoMenu,
  linkDeAtivacao,
  listarLeads,
  mensagemDeAtivacao,
  opcoesDeFiltro,
  type QuemConsulta,
} from "@/lib/leads";
import { LIMITE_LEAD_MANUAL, podeTentarCriarLead } from "@/lib/limite";
import { mesclar, possiveisDuplicados } from "@/lib/mescla";
import { origemDosLeads } from "@/lib/origem";
import { perfilDosLeads } from "@/lib/perfil";
import { mudarEtapa, quadroDoPipeline } from "@/lib/pipeline";
import { LEADS, leadsDe, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { auditoria, db, limparTudo, sqlDono } from "./apoio";

const quem = (u: keyof typeof USUARIOS_TESTE): QuemConsulta => ({ id: USUARIOS_TESTE[u].id, papel: USUARIOS_TESTE[u].papel });
const ana = quem("ana");
const sergio = quem("sergio");
const vera = quem("vera");
const vitor = quem("vitor");
const leo = quem("leo");
const tudo = lerFiltrosFunil({ periodo: "tudo" });

const NOVO = { nome: "Maria Manual", email: "maria.manual@exemplo.com.br", whatsapp: "(85) 97777-1234" };

async function erroDe(promessa: Promise<unknown>): Promise<ErroLeadManual> {
  try {
    await promessa;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroLeadManual);
    return e as ErroLeadManual;
  }
  throw new Error("esperava ErroLeadManual");
}

const leadsNoBanco = async () => Number((await sqlDono<{ n: string }>("SELECT count(*) AS n FROM teste7d_inscricoes"))[0].n);

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
});

describe("quem cadastra", () => {
  it("vendas cria, fica responsável e passa a ver o lead; outro vendedor não vê", async () => {
    const { id } = await criarLeadManual(vera, NOVO, "tela");
    const [linha] = await sqlDono<Record<string, unknown>>(
      `SELECT nome, email, whatsapp, utm_source, utm_medium, utm_campaign, utm_content, lp_variant, status,
              consentimento_lgpd, etapa2_concluida_em, token_retomada, created_at > now() - interval '1 minute' AS agora
         FROM teste7d_inscricoes WHERE id = $1`,
      [id],
    );
    expect(linha).toMatchObject({
      nome: "Maria Manual",
      email: "maria.manual@exemplo.com.br",
      whatsapp: "5585977771234",
      utm_source: "manual",
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      lp_variant: null,
      status: "inscrito",
      consentimento_lgpd: false,
      etapa2_concluida_em: null,
      agora: true,
    });
    expect(linha.token_retomada).toMatch(/^[0-9a-f]{32}$/);
    expect(await sqlDono("SELECT usuario_id, atribuido_por FROM painel_lead_responsavel WHERE lead_id = $1", [id])).toEqual([
      { usuario_id: vera.id, atribuido_por: vera.id },
    ]);

    const ficha = await abrirFicha(vera, id, "tela");
    expect(ficha).toMatchObject({ id, cadastro_manual: true, responsavel_id: vera.id, etapa_comercial: "nao_contatado" });
    expect((await listarLeads(vera, lerFiltros({ q: "Maria Manual" }, "vendas"))).itens.map((l) => l.id)).toEqual([id]);

    expect(await abrirFicha(vitor, id, "tela")).toBeNull();
    expect(await linkDeAtivacao(vitor, id)).toBeNull();
    expect((await listarLeads(vitor, lerFiltros({ q: "Maria Manual" }, "vendas"))).total).toBe(0);
  });

  it("admin cria sem responsável (vai para a fila) e com responsável escolhido", async () => {
    const menu = await contadoresDoMenu("admin");
    const sem = await criarLeadManual(ana, { ...NOVO, responsavelId: "" });
    expect(await sqlDono("SELECT 1 FROM painel_lead_responsavel WHERE lead_id = $1", [sem.id])).toEqual([]);
    expect((await contadoresDoMenu("admin")).semResponsavel).toBe(menu.semResponsavel! + 1);
    expect(await abrirFicha(vera, sem.id, "api")).toBeNull();

    const com = await criarLeadManual(ana, { ...NOVO, email: "outra@exemplo.com.br", responsavelId: vitor.id.toUpperCase() });
    expect(await sqlDono("SELECT usuario_id, atribuido_por FROM painel_lead_responsavel WHERE lead_id = $1", [com.id])).toEqual([
      { usuario_id: vitor.id, atribuido_por: ana.id },
    ]);
    expect(await abrirFicha(vitor, com.id, "api")).not.toBeNull();

    // Admin também pode ser responsável.
    const doAdmin = await criarLeadManual(ana, { ...NOVO, email: "terceira@exemplo.com.br", responsavelId: ana.id });
    expect((await abrirFicha(ana, doAdmin.id, "api"))?.responsavel_id).toBe(ana.id);
  });

  it("admin não escolhe como responsável suporte, leitura, desativado nem quem não existe (nada é gravado)", async () => {
    const antes = await leadsNoBanco();
    for (const responsavelId of [sergio.id, leo.id, USUARIOS_TESTE.inativo.id, "10000000-0000-4000-8000-000000000099", "x"]) {
      const e = await erroDe(criarLeadManual(ana, { ...NOVO, responsavelId }));
      expect(e.motivo).toBe("invalido");
      expect(e.erros.responsavel).toBeTruthy();
    }
    expect(await leadsNoBanco()).toBe(antes);
    expect(await auditoria("criar_lead")).toEqual([]);
  });

  it("vendas não escolhe outro responsável (o próprio id é aceito)", async () => {
    const e = await erroDe(criarLeadManual(vera, { ...NOVO, responsavelId: vitor.id }));
    expect(e.erros.responsavel).toMatch(/fica com você/);
    const { id } = await criarLeadManual(vera, { ...NOVO, responsavelId: vera.id });
    expect((await abrirFicha(vera, id, "api"))?.responsavel_id).toBe(vera.id);
  });

  it("suporte e leitura: sem_permissao, nada é gravado", async () => {
    const antes = await leadsNoBanco();
    for (const u of [sergio, leo]) {
      expect((await erroDe(criarLeadManual(u, NOVO))).motivo).toBe("sem_permissao");
    }
    expect(await leadsNoBanco()).toBe(antes);
    expect(await auditoria("criar_lead")).toEqual([]);
  });
});

describe("validação", () => {
  it("WhatsApp inválido e nome curto: invalido com o erro de cada campo, nada gravado", async () => {
    const antes = await leadsNoBanco();
    const e = await erroDe(criarLeadManual(vera, { ...NOVO, nome: " M ", whatsapp: "(85) 1234" }));
    expect(e.motivo).toBe("invalido");
    expect(e.erros).toEqual({ nome: expect.stringMatching(/curto/), whatsapp: expect.stringMatching(/WhatsApp válido/) });
    expect((await erroDe(criarLeadManual(vera, { ...NOVO, email: "nao-e-email" }))).erros.email).toMatch(/válido/);
    expect(await leadsNoBanco()).toBe(antes);
  });

  it("anotação longa demais derruba tudo (transação)", async () => {
    const e = await erroDe(criarLeadManual(vera, { ...NOVO, anotacao: "x".repeat(MAX_ANOTACAO + 1) }));
    expect(e.erros.anotacao).toMatch(/até/);
    expect(await sqlDono("SELECT 1 FROM teste7d_inscricoes WHERE email = $1", [NOVO.email])).toEqual([]);
  });

  it("anotação inicial gravada pelo caminho das anotações (com auditoria anotar_lead sem o texto)", async () => {
    const { id } = await criarLeadManual(vera, { ...NOVO, anotacao: "  Veio pela indicação do João.\r\nLigar à tarde.  " });
    const anotacoes = await anotacoesDoLead(vera, id);
    expect(anotacoes).toHaveLength(1);
    expect(anotacoes![0]).toMatchObject({ texto: "Veio pela indicação do João.\nLigar à tarde.", autor: "Vera Vendas" });
    const [log] = await auditoria("anotar_lead");
    expect(log.detalhe).toEqual({ anotacao_id: anotacoes![0].id, tamanho: anotacoes![0].texto.length });
  });

  it("anotação vazia ou só espaços: nenhuma anotação", async () => {
    const { id } = await criarLeadManual(vera, { ...NOVO, anotacao: "   " });
    expect(await anotacoesDoLead(vera, id)).toEqual([]);
  });
});

describe("e-mail repetido", () => {
  it("com maiúsculas diferentes: email_existente; o vendedor dono recebe o id do lead", async () => {
    const { id } = await criarLeadManual(vera, NOVO);
    const e = await erroDe(criarLeadManual(vera, { ...NOVO, email: "  MARIA.Manual@Exemplo.com.BR ", whatsapp: "11 3333-4444" }));
    expect(e).toMatchObject({ motivo: "email_existente", message: MENSAGEM_EMAIL_EXISTENTE, leadExistente: id });
    expect((await erroDe(criarLeadManual(ana, NOVO))).leadExistente).toBe(id);
    expect(await sqlDono("SELECT count(*)::int AS n FROM teste7d_inscricoes WHERE lower(email) = $1", [NOVO.email])).toEqual([{ n: 1 }]);
  });

  it("e-mail de lead alheio (ou de cadastro do site que o vendedor não vê): só a mensagem, nenhum dado do dono", async () => {
    const alheio = leadsDe("vitor")[0];
    const e = await erroDe(criarLeadManual(vera, { ...NOVO, email: alheio.email.toUpperCase() }));
    expect(e.motivo).toBe("email_existente");
    expect(e.leadExistente).toBeNull();
    const tudoDoErro = JSON.stringify({ ...e, message: e.message });
    for (const dado of [alheio.id, alheio.nome, alheio.whatsapp, "Vitor"]) expect(tudoDoErro).not.toContain(dado);

    const semDono = LEADS.find((l) => l.dono === null)!;
    expect((await erroDe(criarLeadManual(vera, { ...NOVO, email: semDono.email }))).leadExistente).toBeNull();
    expect((await erroDe(criarLeadManual(ana, { ...NOVO, email: semDono.email }))).leadExistente).toBe(semDono.id);
  });

  it("e-mail de cadastro mesclado em outro: só a mensagem, mesmo para admin", async () => {
    const [a, b] = LEADS.filter((l) => l.dono === null);
    await mesclar(ana, a.id, b.id);
    const e = await erroDe(criarLeadManual(ana, { ...NOVO, email: b.email }));
    expect(e).toMatchObject({ motivo: "email_existente", leadExistente: null });
  });

  it("nada fica gravado na tentativa recusada (nem responsável, nem auditoria)", async () => {
    await expect(criarLeadManual(vera, { ...NOVO, email: LEADS[20].email, anotacao: "nota" })).rejects.toBeInstanceOf(ErroLeadManual);
    expect(await auditoria("criar_lead")).toEqual([]);
    expect(await sqlDono("SELECT 1 FROM painel_lead_anotacao")).toEqual([]);
  });
});

describe("auditoria, link e duplicados", () => {
  it("criar_lead só com via e responsavel_id; nenhum dado pessoal em nenhuma linha da auditoria", async () => {
    const { id } = await criarLeadManual(vera, { ...NOVO, anotacao: "Contato da feira" }, "tela");
    await criarLeadManual(ana, { ...NOVO, email: "sem.dono@exemplo.com.br" });
    const logs = await auditoria("criar_lead");
    expect(logs.map((l) => l.detalhe)).toEqual([
      { via: "tela", responsavel_id: vera.id },
      { via: "api", responsavel_id: null },
    ]);
    expect(logs.map((l) => l.usuario_id)).toEqual([vera.id, ana.id]);
    expect(await sqlDono("SELECT lead_id FROM painel_auditoria WHERE acao = 'criar_lead' ORDER BY id LIMIT 1")).toEqual([{ lead_id: id }]);
    const todas = JSON.stringify(await sqlDono("SELECT acao, detalhe FROM painel_auditoria"));
    for (const dado of ["Maria", "maria.manual", "sem.dono", "97777", "Contato da feira"]) expect(todas).not.toContain(dado);
  });

  it("token gerado pelo banco; linkDeAtivacao devolve o link e mensagemDeAtivacao a mensagem (as duas auditadas como copiar_link)", async () => {
    const { id } = await criarLeadManual(vera, NOVO);
    const [{ token_retomada: token }] = await sqlDono<{ token_retomada: string }>("SELECT token_retomada FROM teste7d_inscricoes WHERE id = $1", [id]);
    expect(await linkDeAtivacao(vera, id)).toBe(`${URL_ATIVAR_CONTA}?t=${token}`);
    expect(await mensagemDeAtivacao(vera, id, "Vera Vendas")).toBe(
      `Oi, Maria! Aqui é Vera, do ady. Esse é o link para ativar seu teste grátis de 7 dias: ${URL_ATIVAR_CONTA}?t=${token}`,
    );
    expect(await mensagemDeAtivacao(vitor, id, "Vitor")).toBeNull();
    const logs = await auditoria("copiar_link");
    expect(logs.map((l) => l.detalhe)).toEqual([null, { formato: "mensagem" }]);
    expect(JSON.stringify(logs)).not.toContain(token);
  });

  it("WhatsApp igual ao de outro lead grava normalmente e aparece em Possíveis duplicados", async () => {
    const outro = LEADS[25];
    const { id } = await criarLeadManual(ana, { ...NOVO, whatsapp: `+${outro.whatsapp}` });
    const grupos = await possiveisDuplicados(ana);
    const grupo = grupos.find((g) => g.leads.some((l) => l.id === id));
    expect(grupo?.criterio).toBe("whatsapp");
    expect(grupo!.leads.map((l) => l.id).sort()).toEqual([id, outro.id].sort());
  });
});

describe("estatísticas", () => {
  it("fora do funil, da origem, do perfil e das opções de criativo e campanha; dentro da lista, pipeline, menu e funil comercial", async () => {
    const antes = {
      funil: await indicadoresDoFunil(tudo),
      origem: await origemDosLeads(tudo, "admin"),
      perfil: (await perfilDosLeads(tudo, "admin")).cadastros,
      comercial: (await funilComercial(tudo, "admin")).total!,
      opcoes: await opcoesDoFunil("admin"),
      opcoesLista: await opcoesDeFiltro(ana),
      lista: (await listarLeads(ana, lerFiltros({}, "admin"))).total,
      quadro: (await quadroDoPipeline(ana, lerFiltrosPipeline({}, "admin"))).reduce((s, c) => s + c.total, 0),
      menu: (await contadoresDoMenu("admin")).semResponsavel!,
    };
    const { id } = await criarLeadManual(ana, NOVO);
    await mudarEtapa(ana, id, { esperada: "nao_contatado", etapa: "negociacao" });

    // Marketing: nada muda.
    const funil = await indicadoresDoFunil(tudo);
    expect(funil.resumo).toEqual(antes.funil.resumo);
    expect(funil.porCriativo).toEqual(antes.funil.porCriativo);
    expect(funil.porVersao).toEqual(antes.funil.porVersao);
    expect(funil.abandono).toEqual(antes.funil.abandono);
    const origem = await origemDosLeads(tudo, "admin");
    expect(origem.total).toEqual(antes.origem.total);
    expect(origem.semOrigem).toEqual(antes.origem.semOrigem);
    expect(origem.linhas.some((l) => l.grupo.startsWith("manual"))).toBe(false);
    expect((await perfilDosLeads(tudo, "admin")).cadastros).toBe(antes.perfil);
    const opcoes = await opcoesDoFunil("admin");
    expect(opcoes.criativos).toEqual(antes.opcoes.criativos);
    expect(opcoes.campanhas).toEqual(antes.opcoes.campanhas);
    expect(opcoes.campanhas).not.toContain("(sem origem)");
    expect(opcoes.origens).toContain("manual"); // dá para recortar o funil comercial por "manual"
    expect(await opcoesDeFiltro(ana)).toEqual(antes.opcoesLista);
    // Mesmo pedindo a origem "manual", o funil de marketing fica vazio.
    const soManual = lerFiltrosFunil({ periodo: "tudo", origem: "Manual" });
    expect((await indicadoresDoFunil(soManual)).resumo.cadastros).toBe(0);
    expect((await perfilDosLeads(soManual, "admin")).cadastros).toBe(0);

    // Operação: entra.
    expect((await listarLeads(ana, lerFiltros({}, "admin"))).total).toBe(antes.lista + 1);
    expect((await quadroDoPipeline(ana, lerFiltrosPipeline({}, "admin"))).reduce((s, c) => s + c.total, 0)).toBe(antes.quadro + 1);
    expect((await contadoresDoMenu("admin")).semResponsavel).toBe(antes.menu + 1);
    const comercial = await funilComercial(tudo, "admin");
    expect(comercial.total).toBe(antes.comercial + 1);
    expect(comercial.cortes.origem.linhas.find((l) => l.grupo.startsWith("manual"))).toMatchObject({ leads: 1, negociacao: 1 });
    const comercialManual = await funilComercial(soManual, "admin");
    expect(comercialManual.total).toBe(1);
    expect(comercialManual.atual.find((a) => a.etapa === "negociacao")?.leads).toBe(1);
  });

  it("utm_source de cadastro do site com outra grafia de 'manual' também conta como manual (mesma normalização)", async () => {
    const antes = (await indicadoresDoFunil(tudo)).resumo.cadastros;
    await sqlDono("UPDATE teste7d_inscricoes SET utm_source = '  MANUAL ' WHERE id = $1", [LEADS[29].id]);
    expect((await indicadoresDoFunil(tudo)).resumo.cadastros).toBe(antes - 1);
    expect((await abrirFicha(ana, LEADS[29].id, "api"))?.cadastro_manual).toBe(true);
    expect((await abrirFicha(ana, LEADS[28].id, "api"))?.cadastro_manual).toBe(false);
  });
});

describe("banco e limite", () => {
  it("painel_app só insere nome, e-mail, WhatsApp e utm_source (o resto é DEFAULT)", async () => {
    await expect(
      db().query("INSERT INTO teste7d_inscricoes (nome, email, whatsapp, status) VALUES ('A B', 'x@y.com', '5585999999999', 'agendado')"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db().query("INSERT INTO teste7d_inscricoes (nome, email, whatsapp, utm_campaign) VALUES ('A B', 'x@y.com', '5585999999999', 'c')"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db().query("INSERT INTO teste7d_inscricoes (nome, email, whatsapp, token_retomada) VALUES ('A B', 'x@y.com', '5585999999999', 'abc')"),
    ).rejects.toThrow(/permission denied/);
    await expect(db().query("DELETE FROM teste7d_inscricoes")).rejects.toThrow(/permission denied/);
    await expect(db().query("UPDATE teste7d_inscricoes SET utm_source = 'x'")).rejects.toThrow(/permission denied/);
  });

  it(`até ${LIMITE_LEAD_MANUAL.porUsuario} tentativas por usuário na janela; cada usuário tem a sua conta`, async () => {
    for (let k = 0; k < LIMITE_LEAD_MANUAL.porUsuario; k++) expect(await podeTentarCriarLead(vera.id)).toBe(true);
    expect(await podeTentarCriarLead(vera.id)).toBe(false);
    expect(await podeTentarCriarLead(vitor.id)).toBe(true);
  });
});
