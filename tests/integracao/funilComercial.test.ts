import { beforeEach, describe, expect, it } from "vitest";
import { LINHA_DO_FUNIL } from "@/config/pipeline";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { acumuladosProtegidos, funilComercial, type FunilComercial } from "@/lib/funilComercial";
import type { QuemConsulta } from "@/lib/leads";
import { mesclar } from "@/lib/mescla";
import { mudarEtapa, type PedidoDeEtapa } from "@/lib/pipeline";
import { LEADS, semear, USUARIOS_TESTE } from "../fixtures/leads";
import { limparTudo, sqlDono } from "./apoio";

const ana: QuemConsulta = { id: USUARIOS_TESTE.ana.id, papel: "admin" };
const tudo = lerFiltrosFunil({ periodo: "tudo" });
const DIA = 86_400;

/**
 * Roteiro fixo (o resto dos 30 leads fica sem registro = não contatado):
 *   L0: não contatado → reunião marcada (pulou tentativa) → negociação
 *   L1: não contatado → tentativa → perdido (sem interesse)
 *   L2: não contatado → fechado (pulou tudo)
 *   L3: não contatado → fechado → negociação (reaberto)
 *   L4: não contatado → negociação → perdido (outro, com texto)
 * Dias (desde o cadastro) de cada mudança, para o tempo mediano.
 */
const ROTEIRO: [number, PedidoDeEtapa["etapa"], number, string?, string?][][] = [
  [[0, "reuniao_marcada", 2], [0, "negociacao", 3]],
  [[1, "tentativa_contato", 1], [1, "negocio_perdido", 4, "sem_interesse"]],
  [[2, "negocio_fechado", 5]],
  [[3, "negocio_fechado", 1], [3, "negociacao", 11]],
  [[4, "negociacao", 3], [4, "negocio_perdido", 5, "outro", "Comprou de um concorrente"]],
];

async function executarRoteiro() {
  for (const passos of ROTEIRO) {
    let atual: PedidoDeEtapa["esperada"] = "nao_contatado";
    for (const [i, etapa, , motivo, motivoTexto] of passos) {
      await mudarEtapa(ana, LEADS[i].id, { esperada: atual, etapa, motivo, motivoTexto });
      atual = etapa;
    }
  }
  // Datas conhecidas no histórico (o dono do banco pode; o painel_app não).
  for (const passos of ROTEIRO) {
    const lead = LEADS[passos[0][0]];
    const ids = await sqlDono<{ id: string }>("SELECT id FROM painel_lead_etapa_historico WHERE lead_id = $1 ORDER BY id", [lead.id]);
    for (const [k, { id }] of ids.entries()) {
      await sqlDono(
        `UPDATE painel_lead_etapa_historico h SET criado_em = i.created_at + make_interval(days => $2)
           FROM teste7d_inscricoes i WHERE h.id = $1 AND i.id = h.lead_id`,
        [id, passos[k][2]],
      );
    }
  }
}

beforeEach(async () => {
  await limparTudo();
  await semear(sqlDono);
  await executarRoteiro();
});

const leadsDoResultado = (r: FunilComercial) => JSON.stringify(r);

describe("funil comercial (admin)", () => {
  it("etapa de hoje bate com contagem independente em SQL, inclusive leads sem registro", async () => {
    const r = await funilComercial(tudo, "admin");
    const sql = await sqlDono<{ etapa: string; n: number }>(
      `SELECT coalesce(e.etapa, 'nao_contatado') AS etapa, count(*)::int AS n
         FROM teste7d_inscricoes i LEFT JOIN painel_lead_etapa e ON e.lead_id = i.id GROUP BY 1`,
    );
    const esperado = Object.fromEntries(sql.map((x) => [x.etapa, x.n]));
    expect(Object.fromEntries(r.atual.filter((a) => a.leads).map((a) => [a.etapa, a.leads]))).toEqual(esperado);
    expect(esperado).toEqual({ nao_contatado: 25, negociacao: 2, negocio_fechado: 1, negocio_perdido: 2 });
    expect(r.total).toBe(30);
  });

  it("chegaram a pelo menos cada etapa: quem pulou conta nas anteriores; reaberto conta até onde chegou", async () => {
    const r = await funilComercial(tudo, "admin");
    expect(r.chegaram.map((c) => c.leads)).toEqual([30, 5, 4, 4, 2, 2]);
    // Contagem independente: por EXISTS em cada etapa da linha (hoje ou no histórico), sem greatest/max.
    for (const [k, etapa] of LINHA_DO_FUNIL.entries()) {
      const posteriores = LINHA_DO_FUNIL.slice(k);
      const [{ n }] = await sqlDono<{ n: number }>(
        `SELECT count(*)::int AS n FROM teste7d_inscricoes i
          WHERE $2 = 0
             OR EXISTS (SELECT 1 FROM painel_lead_etapa e WHERE e.lead_id = i.id AND e.etapa = ANY($1))
             OR EXISTS (SELECT 1 FROM painel_lead_etapa_historico h WHERE h.lead_id = i.id AND (h.etapa_de = ANY($1) OR h.etapa_para = ANY($1)))`,
        [posteriores, k],
      );
      expect(r.chegaram[k].leads, etapa).toBe(n);
    }
    expect(r.chegaram.map((c) => c.passagem)).toEqual([5 / 30, 4 / 5, 1, 2 / 4, 1, null]);
  });

  it("tempo mediano em cada etapa, do histórico (período aberto não entra)", async () => {
    const r = await funilComercial(tudo, "admin");
    const t = Object.fromEntries(r.tempos.map((x) => [x.etapa, [x.passagens, x.mediana === null ? null : Math.round(x.mediana / DIA)]]));
    expect(t).toEqual({
      nao_contatado: [5, 2], // 2, 1, 5, 1, 3 dias
      tentativa_contato: [1, 3],
      reuniao_marcada: [1, 1],
      negociacao: [1, 2],
      negocio_provavel: [0, null],
      negocio_fechado: [1, 10],
      negocio_perdido: [0, null],
    });
  });

  it("perdidos: total, por motivo e pela etapa em que estavam", async () => {
    const { perdidos } = await funilComercial(tudo, "admin");
    expect(perdidos.total).toBe(2);
    expect(perdidos.porMotivo.filter((m) => m.leads).map((m) => [m.motivo, m.leads])).toEqual([
      ["sem_interesse", 1],
      ["outro", 1],
    ]);
    expect(perdidos.porEtapa.filter((m) => m.leads).map((m) => [m.etapa, m.leads])).toEqual([
      ["tentativa_contato", 1],
      ["negociacao", 1],
    ]);
  });

  it("cortes por situação do teste e por responsável somam o total; responsável só para admin e suporte", async () => {
    const r = await funilComercial(tudo, "admin");
    expect(r.cortes.situacao.linhas.reduce((s, l) => s + l.leads, 0)).toBe(30);
    expect(r.cortes.responsavel!.linhas.reduce((s, l) => s + l.leads, 0)).toBe(30);
    const vera = r.cortes.responsavel!.linhas.find((l) => l.grupo === "Vera Vendas")!;
    // L0..L4 são da Vera: fechados = L2 e L3; perdidos = L1 e L4.
    expect(vera).toMatchObject({ leads: 12, fechados: 2, perdidos: 2, negociacao: 4, reuniao: 4, amostraPequena: true });
    expect(r.cortes.origem.linhas).toHaveLength(2); // facebook / paid / camp-a e camp-b
    expect((await funilComercial(tudo, "suporte")).cortes.responsavel).toBeDefined();
    expect((await funilComercial(tudo, "vendas")).cortes.responsavel).toBeUndefined();
    expect((await funilComercial(tudo, "leitura")).cortes.responsavel).toBeUndefined();
  });

  it("mesmos cortes do funil: criativo filtra pela coorte; mesclado não conta", async () => {
    const r = await funilComercial(lerFiltrosFunil({ periodo: "tudo", criativo: "T7D-R1-H01-VID" }), "admin");
    expect(r.total).toBe(10);
    expect(r.amostraPequena).toBe(true);
    await mesclar(ana, LEADS[5].id, LEADS[2].id); // o fechado vira duplicado
    const depois = await funilComercial(tudo, "admin");
    expect(depois.total).toBe(29);
    expect(depois.atual.find((a) => a.etapa === "negocio_fechado")!.leads).toBe(0);
  });

  it("nenhum dado pessoal na resposta, para nenhum papel", async () => {
    for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
      const texto = leadsDoResultado(await funilComercial(tudo, papel));
      for (const l of LEADS) {
        expect(texto).not.toContain(l.nome);
        expect(texto).not.toContain(l.email);
        expect(texto).not.toContain(l.whatsapp);
        expect(texto).not.toContain(l.token);
      }
      expect(texto).not.toContain("Comprou de um concorrente");
    }
  });
});

describe("funil comercial para “leitura”", () => {
  const visivelPequeno = (v: number | null) => v !== null && v > 0 && v < 5;

  it("nenhuma célula de 1 a 4 e nada descobrível por subtração", async () => {
    const r = await funilComercial(tudo, "leitura");
    expect(r.ocultaAbaixoDe).toBe(5);
    const celulas = [
      ...r.atual.map((a) => a.leads),
      ...r.chegaram.map((c) => c.leads),
      ...r.tempos.map((t) => t.passagens),
      r.perdidos.total,
      ...r.perdidos.porMotivo.map((m) => m.leads),
      ...r.perdidos.porEtapa.map((m) => m.leads),
      ...Object.values(r.cortes).flatMap((c) => [
        ...c!.linhas.flatMap((l) => [l.leads, l.reuniao, l.negociacao, l.fechados, l.perdidos]),
        ...(c!.outras ? [c!.outras.leads, c!.outras.reuniao, c!.outras.negociacao, c!.outras.fechados, c!.outras.perdidos] : []),
      ]),
    ];
    expect(celulas.filter(visivelPequeno)).toEqual([]);

    // Etapa de hoje: total - visíveis = soma das ocultas, que não pode ser 1 a 4.
    const ocultas = r.total! - r.atual.reduce((s, a) => s + (a.leads ?? 0), 0);
    expect(visivelPequeno(ocultas)).toBe(false);
    // Chegaram: diferenças entre valores mostrados vizinhos também não.
    const mostrados = r.chegaram.map((c) => c.leads).filter((v): v is number => v !== null);
    for (let k = 1; k < mostrados.length; k++) expect(visivelPequeno(mostrados[k - 1] - mostrados[k])).toBe(false);
    // Os 5 não contatados que saíram não deixam a etapa "fechado" (1) aparecer.
    expect(r.atual.find((a) => a.etapa === "negocio_fechado")!.leads).toBeNull();
    expect(r.perdidos.total).toBeNull();
    expect(r.tempos.find((t) => t.etapa === "nao_contatado")).toMatchObject({ passagens: 5 });
    expect(r.tempos.find((t) => t.etapa === "tentativa_contato")).toMatchObject({ passagens: null, mediana: null });
  });

  it("admin vê as mesmas células sem ocultação", async () => {
    const r = await funilComercial(tudo, "admin");
    expect(r.ocultaAbaixoDe).toBeNull();
    expect(r.atual.find((a) => a.etapa === "negocio_fechado")!.leads).toBe(1);
  });

  it("acumulados: proteção de cada valor e de cada diferença", () => {
    expect(acumuladosProtegidos([30, 5, 4, 4, 2, 2], 5, true)).toEqual([30, 5, null, null, null, null]);
    expect(acumuladosProtegidos([30, 28, 20, 20, 0, 0], 5, true)).toEqual([30, null, 20, 20, 0, 0]);
    expect(acumuladosProtegidos([3, 1, 0, 0, 0, 0], 5, false)).toEqual([null, null, null, null, null, null]);
    expect(acumuladosProtegidos([3, 1, 0], 0, true)).toEqual([3, 1, 0]);
  });
});
