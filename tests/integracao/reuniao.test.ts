import { beforeEach, describe, expect, it } from "vitest";
import { lerFiltros } from "@/lib/filtrosLeads";
import { contadoresDoMenu, listarLeads, SemAcessoALeads } from "@/lib/leads";
import { desfazerMarcacao, ErroReuniao, marcacaoDesfazivel, marcarDesfecho } from "@/lib/reuniao";
import { LEADS, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { auditoria, db, limparTudo, sqlDono } from "./apoio";

const sergio = USUARIOS_TESTE.sergio.id;
const agendados = LEADS.filter((l) => l.status === "agendado");
const [lead] = agendados;

async function noBanco(id: string) {
  const [r] = await sqlDono<{ status: string; realizada_em: Date | null }>(
    "SELECT status, realizada_em FROM teste7d_inscricoes WHERE id = $1",
    [id],
  );
  return r;
}

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
});

describe("marcar", () => {
  it("realizada: status e realizada_em = agora, com auditoria", async () => {
    await marcarDesfecho(lead.id, "realizado", sergio);
    const r = await noBanco(lead.id);
    expect(r.status).toBe("realizado");
    expect(Date.now() - new Date(r.realizada_em!).getTime()).toBeLessThan(60_000);
    const [log] = await auditoria("marcar_realizada");
    expect(log).toMatchObject({ usuario_id: sergio, detalhe: { de: "agendado", para: "realizado" } });
  });

  it("não compareceu: só o status", async () => {
    await marcarDesfecho(lead.id, "nao_compareceu", sergio);
    expect(await noBanco(lead.id)).toEqual({ status: "nao_compareceu", realizada_em: null });
    expect(await auditoria("marcar_nao_compareceu")).toHaveLength(1);
  });

  for (const status of ["inscrito", "ativacao_preenchida", "realizado", "nao_compareceu"]) {
    it(`transição inválida: a partir de ${status} não grava nada`, async () => {
      const alvo = LEADS.find((l) => l.status === status) ?? lead;
      await sqlDono("UPDATE teste7d_inscricoes SET status = $2 WHERE id = $1", [alvo.id, status]);
      const antes = await noBanco(alvo.id);
      await expect(marcarDesfecho(alvo.id, "realizado", sergio)).rejects.toMatchObject({ motivo: "conflito" });
      expect(await noBanco(alvo.id)).toEqual(antes);
      expect(await auditoria("marcar_realizada")).toEqual([]);
    });
  }

  it("lead que não existe", async () => {
    await expect(marcarDesfecho("00000000-0000-4000-8000-999999999999", "realizado", sergio)).rejects.toMatchObject({
      motivo: "nao_encontrado",
    });
  });

  it("duas marcações ao mesmo tempo: só uma grava; a outra recebe a mensagem de conflito", async () => {
    const resultados = await Promise.allSettled([
      marcarDesfecho(lead.id, "realizado", sergio),
      marcarDesfecho(lead.id, "nao_compareceu", USUARIOS_TESTE.ana.id),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0].reason).toBeInstanceOf(ErroReuniao);
    expect(falhas[0].reason.message).toMatch(/não está mais como agendado/);
    const logs = [...(await auditoria("marcar_realizada")), ...(await auditoria("marcar_nao_compareceu"))];
    expect(logs).toHaveLength(1);
    expect((await noBanco(lead.id)).status).toBe(logs[0].detalhe.para);
  });

  it("o painel_app não escreve em outras colunas da reunião", async () => {
    await expect(db().query("UPDATE teste7d_inscricoes SET reuniao_em = now() WHERE id = $1", [lead.id])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("desfazer", () => {
  it("dentro de 24 horas: volta para agendado e limpa realizada_em", async () => {
    await marcarDesfecho(lead.id, "realizado", sergio);
    const m = await marcacaoDesfazivel(lead.id, "realizado");
    expect(m).toMatchObject({ desfecho: "realizado" });
    expect(m!.desfazerAte.getTime() - m!.marcadaEm.getTime()).toBe(24 * 3_600_000);

    await desfazerMarcacao(lead.id, USUARIOS_TESTE.ana.id);
    expect(await noBanco(lead.id)).toEqual({ status: "agendado", realizada_em: null });
    const [log] = await auditoria("desfazer_marcacao");
    expect(log).toMatchObject({ usuario_id: USUARIOS_TESTE.ana.id, detalhe: { de: "realizado", para: "agendado" } });
    // Depois de desfeito, não há mais o que desfazer.
    expect(await marcacaoDesfazivel(lead.id, "agendado")).toBeNull();
    await expect(desfazerMarcacao(lead.id, sergio)).rejects.toMatchObject({ motivo: "conflito" });
    // E dá para marcar de novo.
    await marcarDesfecho(lead.id, "nao_compareceu", sergio);
    expect(await marcacaoDesfazivel(lead.id, "nao_compareceu")).toMatchObject({ desfecho: "nao_compareceu" });
  });

  it("depois de 24 horas: o botão some e o servidor recusa", async () => {
    await marcarDesfecho(lead.id, "nao_compareceu", sergio);
    await sqlDono("UPDATE painel_auditoria SET criado_em = now() - interval '24 hours 1 minute' WHERE acao = 'marcar_nao_compareceu'");
    expect(await marcacaoDesfazivel(lead.id, "nao_compareceu")).toBeNull();
    await expect(desfazerMarcacao(lead.id, sergio)).rejects.toMatchObject({ motivo: "prazo" });
    expect((await noBanco(lead.id)).status).toBe("nao_compareceu");
    expect(await auditoria("desfazer_marcacao")).toEqual([]);
  });

  it("23h59 depois ainda dá", async () => {
    await marcarDesfecho(lead.id, "realizado", sergio);
    await sqlDono("UPDATE painel_auditoria SET criado_em = now() - interval '23 hours 59 minutes' WHERE acao = 'marcar_realizada'");
    expect(await marcacaoDesfazivel(lead.id, "realizado")).not.toBeNull();
    await desfazerMarcacao(lead.id, sergio);
    expect((await noBanco(lead.id)).status).toBe("agendado");
  });

  it("sem marcação pelo painel (status mudado por fora): nada a desfazer", async () => {
    await sqlDono("UPDATE teste7d_inscricoes SET status = 'realizado' WHERE id = $1", [lead.id]);
    expect(await marcacaoDesfazivel(lead.id, "realizado")).toBeNull();
    await expect(desfazerMarcacao(lead.id, sergio)).rejects.toMatchObject({ motivo: "conflito" });
  });

  it("o lead mudou de status depois da marcação (ex. reagendou pelo site): desfazer recusa", async () => {
    await marcarDesfecho(lead.id, "nao_compareceu", sergio);
    await sqlDono("UPDATE teste7d_inscricoes SET status = 'agendado' WHERE id = $1", [lead.id]);
    expect(await marcacaoDesfazivel(lead.id, "agendado")).toBeNull();
    await expect(desfazerMarcacao(lead.id, sergio)).rejects.toThrow(/não está mais em “Não compareceu”/);
  });

  it("dois desfazer ao mesmo tempo: só um grava", async () => {
    await marcarDesfecho(lead.id, "realizado", sergio);
    const r = await Promise.allSettled([desfazerMarcacao(lead.id, sergio), desfazerMarcacao(lead.id, USUARIOS_TESTE.ana.id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await auditoria("desfazer_marcacao")).toHaveLength(1);
  });
});

describe("visão 'Reuniões para fechar'", () => {
  it("só agendados sem desfecho, do agendamento mais antigo para o mais novo; suporte e admin", async () => {
    await marcarDesfecho(lead.id, "realizado", sergio);
    const suporte = { id: sergio, papel: "suporte" as const };
    const pagina = await listarLeads(suporte, lerFiltros({ visao: "para_fechar" }, "suporte"));
    expect(new Set(pagina.itens.map((l) => l.id))).toEqual(new Set(agendados.slice(1).map((l) => l.id)));
    const datas = pagina.itens.map((l) => new Date(l.agendado_em!).getTime());
    expect(datas).toEqual([...datas].sort((a, b) => a - b));
    expect(pagina.itens.every((l) => l.reuniao_em === null)).toBe(true);
    expect((await contadoresDoMenu("suporte")).paraFechar).toBe(agendados.length - 1);

    // Vendas não tem a visão (lerFiltros descarta; a consulta recusa).
    expect(lerFiltros({ visao: "para_fechar" }, "vendas").visao).toBeUndefined();
    await expect(
      listarLeads({ id: USUARIOS_TESTE.vera.id, papel: "vendas" }, { ...lerFiltros({}, "vendas"), visao: "para_fechar" }),
    ).rejects.toThrow(SemAcessoALeads);
  });
});
