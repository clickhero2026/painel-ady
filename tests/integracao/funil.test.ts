import { beforeAll, describe, expect, it } from "vitest";
import { AMOSTRA_MINIMA, lerFiltrosFunil } from "@/lib/filtrosFunil";
import { csvComparativo, indicadoresDoFunil, TELAS_DA_ATIVACAO, type IndicadoresFunil } from "@/lib/funil";
import { CADASTROS_FUNIL, PESSOAIS_FUNIL, semearFunil, type CadastroFunil } from "../fixtures/funil";
import { limparTudo, sqlDono } from "./apoio";

/**
 * Os números do funil conferidos de duas formas independentes do módulo:
 * contagens em SQL escritas à parte (como o dono do banco) e contas em
 * JavaScript sobre o conjunto conhecido (tests/fixtures/funil.ts).
 */

const SETEMBRO = { de: "2026-09-01", ate: "2026-09-30" };
const ind = (params: Record<string, string>) => indicadoresDoFunil(lerFiltrosFunil(params));

beforeAll(async () => {
  await limparTudo();
  await semearFunil(sqlDono);
});

/** Contagem independente: dia de São Paulo comparado como texto, sem os limites em instante do módulo. */
async function contarNoBanco(params: Record<string, string>, agrupar?: "utm_content" | "lp_variant") {
  const where = ["TRUE"];
  const valores: unknown[] = [];
  const add = (v: unknown) => (valores.push(v), `$${valores.length}`);
  if (params.de) where.push(`to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') >= ${add(params.de)}`);
  if (params.ate) where.push(`to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') <= ${add(params.ate)}`);
  const colunas = { criativo: "utm_content", campanha: "utm_campaign", origem: "utm_source", midia: "utm_medium", versao: "lp_variant" };
  for (const [param, coluna] of Object.entries(colunas)) if (params[param]) where.push(`${coluna} = ${add(params[param])}`);
  const grupo = agrupar ?? "NULL::text";
  return sqlDono<{ grupo: string | null; cadastros: number; ativacoes: number; agendamentos: number }>(
    `SELECT ${grupo} AS grupo, count(*)::int AS cadastros,
            sum(CASE WHEN etapa2_concluida_em IS NULL THEN 0 ELSE 1 END)::int AS ativacoes,
            sum(CASE WHEN agendado_em IS NULL THEN 0 ELSE 1 END)::int AS agendamentos
       FROM teste7d_inscricoes WHERE ${where.join(" AND ")} GROUP BY 1`,
    valores,
  );
}

const semTaxas = (linhas: IndicadoresFunil["porCriativo"]) =>
  linhas
    .map((l) => ({ grupo: l.grupo, cadastros: l.cadastros, ativacoes: l.ativacoes, agendamentos: l.agendamentos }))
    .sort((a, b) => String(a.grupo).localeCompare(String(b.grupo)));

const CORTES: Record<string, string>[] = [
  {},
  SETEMBRO,
  { ...SETEMBRO, criativo: "T7D-R1-H01-VID" },
  { ...SETEMBRO, campanha: "camp-b", versao: "D" },
  { ...SETEMBRO, campanha: "camp-b", versao: "C" }, // combinação sem nenhum cadastro
  { ...SETEMBRO, origem: "instagram", midia: "cpc" },
  { de: "2026-09-05", ate: "2026-09-12", criativo: "T7D-R1-H02-IMG", campanha: "camp-a", midia: "paid" },
  { de: "2026-09-10", ate: "2026-09-10" },
  { de: "2026-09-15" },
  { ate: "2026-09-03", versao: "A" },
];

describe("números batem com a contagem independente", () => {
  for (const cortes of CORTES) {
    it(`cortes ${JSON.stringify(cortes)}`, async () => {
      const params = { periodo: "tudo", ...cortes };
      const r = await ind(params);
      const [total = { cadastros: 0, ativacoes: 0, agendamentos: 0 }] = await contarNoBanco(params);
      expect({ cadastros: r.resumo.cadastros, ativacoes: r.resumo.ativacoes, agendamentos: r.resumo.agendamentos }).toEqual({
        cadastros: total.cadastros,
        ativacoes: total.ativacoes ?? 0,
        agendamentos: total.agendamentos ?? 0,
      });
      expect(semTaxas(r.porCriativo)).toEqual(semTaxas((await contarNoBanco(params, "utm_content")) as never));
      expect(semTaxas(r.porVersao)).toEqual(semTaxas((await contarNoBanco(params, "lp_variant")) as never));
      expect(r.serie.reduce((s, d) => s + d.cadastros, 0)).toBe(total.cadastros);
      expect(r.abandono.concluiram).toBe(total.ativacoes ?? 0);
    });
  }

  it("setembro: totais conhecidos do conjunto de teste", async () => {
    const { resumo } = await ind(SETEMBRO);
    const doMes = CADASTROS_FUNIL.filter((c) => c.criadoEm.startsWith("2026-09"));
    expect(resumo.cadastros).toBe(doMes.length);
    expect(resumo.cadastros).toBe(48);
    expect(resumo.ativacoes).toBe(doMes.filter((c) => c.ativacaoH !== null).length);
    expect(resumo.agendamentos).toBe(doMes.filter((c) => c.agendamentoH !== null).length);
    expect(resumo.taxas.ativacao).toBeCloseTo(resumo.ativacoes / resumo.cadastros);
    expect(resumo.taxas.agendamento).toBeCloseTo(resumo.agendamentos / resumo.ativacoes);
    expect(resumo.taxas.geral).toBeCloseTo(resumo.agendamentos / resumo.cadastros);
  });

  it("tempo mediano entre etapas (conta em JavaScript)", async () => {
    const doMes = CADASTROS_FUNIL.filter((c) => c.criadoEm.startsWith("2026-09"));
    const medianaH = (v: number[]) => {
      const s = [...v].sort((a, b) => a - b);
      const m = s.length / 2;
      return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
    };
    const { medianas } = (await ind(SETEMBRO)).resumo;
    expect(medianas.ativacao).toBeCloseTo(medianaH(doMes.flatMap((c) => (c.ativacaoH === null ? [] : [c.ativacaoH]))) * 3600);
    expect(medianas.agendamento).toBeCloseTo(
      medianaH(doMes.flatMap((c) => (c.agendamentoH === null ? [] : [c.agendamentoH]))) * 3600,
    );
    expect(medianas.realizada).toBeNull();
  });

  it("abandono por pergunta (regra do site, em JavaScript)", async () => {
    // Mesma regra de telaRespondida em site-ady/src/lib/teste7dEtapa2.ts.
    const t = (v: unknown) => typeof v === "string" && v.trim() !== "";
    const respondida: ((r: CadastroFunil["respostas"]) => boolean)[] = [
      (r) => t(r.negocio_nome_oferta),
      (r) => t(r.cidade_bairro) || r.atende_todo_brasil === true,
      (r) => t(r.acao_desejada) && (r.acao_desejada !== "outro" || t(r.acao_desejada_outro)),
      (r) => t(r.experiencia_anuncios),
      (r) => t(r.acesso_redes),
      (r) => t(r.conta_anuncios),
      (r) => t(r.cartao_pagamento),
      (r) => t(r.arquivo_logo),
      (r) => t(r.reuniao_computador),
      () => false,
    ];
    const doMes = CADASTROS_FUNIL.filter((c) => c.criadoEm.startsWith("2026-09"));
    const pararam = TELAS_DA_ATIVACAO.map(() => 0);
    for (const c of doMes) if (c.ativacaoH === null) pararam[respondida.findIndex((f) => !f(c.respostas))]++;

    const { abandono } = await ind(SETEMBRO);
    expect(abandono.passos.map((p) => p.pararam)).toEqual(pararam);
    expect(abandono.passos[0].chegaram).toBe(doMes.length);
    // Cada passo: chegaram = os que chegaram ao anterior menos os que pararam nele.
    for (let i = 1; i < abandono.passos.length; i++) {
      expect(abandono.passos[i].chegaram).toBe(abandono.passos[i - 1].chegaram - abandono.passos[i - 1].pararam);
    }
    const ultimo = abandono.passos.at(-1)!;
    expect(ultimo.chegaram - ultimo.pararam).toBe(abandono.concluiram);
    // Os dois casos de resposta inválida contam como não respondida.
    expect(pararam[0]).toBeGreaterThan(0);
    expect(pararam[2]).toBeGreaterThan(0);
  });
});

describe("fuso de São Paulo", () => {
  it("cadastro às 23h30 de 10/09 cai no dia 10, não no 11 (UTC)", async () => {
    const dia10 = await ind({ de: "2026-09-10", ate: "2026-09-10" });
    const dia11 = await ind({ de: "2026-09-11", ate: "2026-09-11" });
    const ids10 = CADASTROS_FUNIL.filter((c) => c.criadoEm.startsWith("2026-09-10")).length;
    const ids11 = CADASTROS_FUNIL.filter((c) => c.criadoEm.startsWith("2026-09-11")).length;
    expect(dia10.resumo.cadastros).toBe(ids10);
    expect(dia11.resumo.cadastros).toBe(ids11);
    expect(dia10.serie).toEqual([{ dia: "2026-09-10", cadastros: ids10 }]);

    const mes = await ind(SETEMBRO);
    expect(mes.serie.find((d) => d.dia === "2026-09-10")?.cadastros).toBe(ids10);
    expect(mes.serie.find((d) => d.dia === "2026-09-11")?.cadastros).toBe(ids11);
  });

  it("31/08 às 23h59 fica fora de setembro e entra em agosto", async () => {
    expect((await ind({ de: "2026-08-31", ate: "2026-08-31" })).resumo.cadastros).toBe(1);
    expect((await ind(SETEMBRO)).serie[0]).toEqual({ dia: "2026-09-01", cadastros: expect.any(Number) });
  });

  it("série cobre o período inteiro, com zero nos dias sem cadastro", async () => {
    const { serie } = await ind(SETEMBRO);
    expect(serie).toHaveLength(30);
    expect(serie.at(-1)).toEqual({ dia: "2026-09-30", cadastros: 0 });
  });
});

describe("período vazio", () => {
  it("zero cadastros, taxas e medianas vazias, nada inventado", async () => {
    const r = await ind({ de: "2025-01-01", ate: "2025-01-07" });
    expect(r.resumo).toMatchObject({ cadastros: 0, ativacoes: 0, agendamentos: 0, realizadas: null, naoCompareceu: null });
    expect(r.resumo.taxas).toEqual({ ativacao: null, agendamento: null, realizada: null, geral: null });
    expect(r.resumo.medianas).toEqual({ ativacao: null, agendamento: null, realizada: null });
    expect(r.serie).toHaveLength(7);
    expect(r.serie.every((d) => d.cadastros === 0)).toBe(true);
    expect(r.porCriativo).toEqual([]);
    expect(r.porVersao).toEqual([]);
    expect(r.abandono.concluiram).toBe(0);
    expect(r.abandono.passos.every((p) => p.chegaram === 0 && p.pararam === 0)).toBe(true);
  });

  it("'tudo' sem nenhum cadastro com o corte: série vazia", async () => {
    const r = await ind({ periodo: "tudo", criativo: "NAO-EXISTE" });
    expect(r.resumo.cadastros).toBe(0);
    expect(r.serie).toEqual([]);
  });
});

describe("amostra pequena", () => {
  it(`CSV marca grupos com menos de ${AMOSTRA_MINIMA} cadastros`, async () => {
    const r = await ind(SETEMBRO);
    const csv = csvComparativo(r, AMOSTRA_MINIMA);
    const linhas = csv.replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(";"));
    const [cabecalho, ...dados] = linhas;
    const col = (nome: string) => cabecalho.indexOf(nome);
    expect(dados.length).toBe(r.porCriativo.length + r.porVersao.length);
    for (const l of dados) {
      expect(l[col("amostra_pequena")]).toBe(Number(l[col("cadastros")]) < AMOSTRA_MINIMA ? "sim" : "nao");
    }
    // Setembro tem 48 cadastros, mas nenhum criativo nem versão chega a 30.
    expect(r.resumo.cadastros).toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
    expect(dados.every((l) => l[col("amostra_pequena")] === "sim")).toBe(true);
  });
});

describe("dados de reunião", () => {
  it("sem nenhum resultado de reunião: realizadas e não compareceu = sem dados (null), nunca zero", async () => {
    const r = await ind(SETEMBRO);
    expect(r.resumo.realizadas).toBeNull();
    expect(r.resumo.naoCompareceu).toBeNull();
    expect(r.resumo.taxas.realizada).toBeNull();
    expect([...r.porCriativo, ...r.porVersao].every((l) => l.realizadas === null && l.naoCompareceu === null)).toBe(true);
    expect(csvComparativo(r, AMOSTRA_MINIMA)).toContain(";sem dados;sem dados;sem dados;");
  });

  it("com resultados: conta realizada (status ou realizada_em) e não compareceu; recorte sem resultado segue sem dados", async () => {
    const agendados = CADASTROS_FUNIL.filter((c) => c.agendamentoH !== null && c.criadoEm.startsWith("2026-09") && c.criativo);
    const [a, b, c] = agendados.filter((x) => x.criativo === "T7D-R1-H01-VID");
    expect(c).toBeDefined();
    try {
      await sqlDono("UPDATE teste7d_inscricoes SET status = 'realizado', realizada_em = agendado_em + interval '24 hours' WHERE id = $1", [a.id]);
      await sqlDono("UPDATE teste7d_inscricoes SET realizada_em = agendado_em + interval '48 hours' WHERE id = $1", [b.id]);
      await sqlDono("UPDATE teste7d_inscricoes SET status = 'nao_compareceu' WHERE id = $1", [c.id]);

      const r = await ind(SETEMBRO);
      expect(r.resumo.realizadas).toBe(2);
      expect(r.resumo.naoCompareceu).toBe(1);
      expect(r.resumo.taxas.realizada).toBeCloseTo(2 / r.resumo.agendamentos);
      expect(r.resumo.medianas.realizada).toBeCloseTo(36 * 3600);

      const h01 = r.porCriativo.find((l) => l.grupo === "T7D-R1-H01-VID")!;
      expect(h01).toMatchObject({ realizadas: 2, naoCompareceu: 1 });
      // Os outros criativos não têm nenhum resultado de reunião: continuam "sem dados".
      for (const l of r.porCriativo.filter((x) => x.grupo !== "T7D-R1-H01-VID")) expect(l.realizadas).toBeNull();

      // Corte que só pega cadastros sem reunião: sem dados.
      expect((await ind({ ...SETEMBRO, criativo: "T7D-R1-H03-CAR" })).resumo.realizadas).toBeNull();
    } finally {
      await sqlDono(
        "UPDATE teste7d_inscricoes SET status = 'agendado', realizada_em = NULL WHERE id = ANY($1::uuid[])",
        [[a.id, b.id, c.id]],
      );
    }
  });
});

describe("ordenação das tabelas", () => {
  it("por cadastros (padrão, decrescente), por nome e por taxa; sem dados e grupo vazio por último", async () => {
    const padrao = await ind(SETEMBRO);
    const cad = padrao.porCriativo.map((l) => l.cadastros);
    expect(cad).toEqual([...cad].sort((a, b) => b - a));

    const nome = await ind({ ...SETEMBRO, oc: "grupo", dc: "asc" });
    expect(nome.porCriativo.map((l) => l.grupo)).toEqual(["T7D-R1-H01-VID", "T7D-R1-H02-IMG", "T7D-R1-H03-CAR", null]);
    const nomeDesc = await ind({ ...SETEMBRO, oc: "grupo", dc: "desc" });
    expect(nomeDesc.porCriativo.map((l) => l.grupo)).toEqual(["T7D-R1-H03-CAR", "T7D-R1-H02-IMG", "T7D-R1-H01-VID", null]);

    const versoes = (await ind(SETEMBRO)).porVersao.map((l) => l.grupo);
    expect(versoes).toEqual(["A", "B", "C", "D", "E", "F", null]);

    const taxa = (await ind({ ...SETEMBRO, ov: "taxa_geral", dv: "desc" })).porVersao.map((l) => l.taxas.geral ?? -1);
    expect(taxa).toEqual([...taxa].sort((a, b) => b - a));
  });
});

describe("privacidade", () => {
  it("nenhum dado pessoal nos indicadores nem no CSV", async () => {
    for (const params of [{ periodo: "tudo" }, SETEMBRO, { de: "2026-09-10", ate: "2026-09-10" }]) {
      const r = await ind(params);
      const texto = JSON.stringify(r) + csvComparativo(r, AMOSTRA_MINIMA);
      for (const s of [...PESSOAIS_FUNIL, "IPHASH-SECRETO", "UA-SECRETO", "FBCLID-SECRETO", "Negócio", "Fortaleza"]) {
        expect(texto).not.toContain(s);
      }
    }
  });
});

describe("CSV", () => {
  it("cabeçalho, BOM, vírgula decimal e criativo com cara de fórmula neutralizado", async () => {
    const id = "20000000-0000-4000-8000-000000000099";
    await sqlDono(
      `INSERT INTO teste7d_inscricoes (id, created_at, nome, email, whatsapp, utm_content)
       VALUES ($1, '2026-09-02T10:00:00-03:00', 'X', 'formula@exemplo.com.br', '5585980000999', '=HYPERLINK("http://x";"y")')`,
      [id],
    );
    try {
      const csv = csvComparativo(await ind(SETEMBRO), AMOSTRA_MINIMA);
      expect(csv.startsWith("﻿corte;grupo;cadastros;")).toBe(true);
      expect(csv).toContain(`criativo;"'=HYPERLINK(""http://x"";""y"")";1;0;0;0;;0;sem dados`);
      expect(csv).toMatch(/criativo;T7D-R1-H01-VID;\d+;\d+;\d+(,\d)?;/);
    } finally {
      await sqlDono("DELETE FROM teste7d_inscricoes WHERE id = $1", [id]);
    }
  });
});
