import { beforeAll, describe, expect, it } from "vitest";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import type { Papel } from "@/lib/papeis";
import { AMOSTRA_MINIMA_GRUPO, DIFERENCA_RELEVANTE, MINIMO_LEITURA, perfilDosLeads, type PerfilDosLeads } from "@/lib/perfil";
import { CADASTROS_PERFIL, CRIATIVOS_PERFIL, PESSOAIS_PERFIL, semearPerfil } from "../fixtures/perfil";
import { limparTudo, sqlDono } from "./apoio";

/**
 * O perfil conferido contra contagens em SQL escritas à parte (como o dono
 * do banco) sobre o conjunto conhecido de tests/fixtures/perfil.ts.
 */

const JULHO = { de: "2026-07-01", ate: "2026-07-31" };
const perfil = (params: Record<string, string>, papel: Papel = "admin") =>
  perfilDosLeads(lerFiltrosFunil({ periodo: "tudo", ...params }), papel);

beforeAll(async () => {
  await limparTudo();
  await semearPerfil(sqlDono);
});

/** Valor de cada pergunta, escrito de outro jeito (sem as expressões do módulo). */
const EXPRESSOES: Record<string, string> = {
  atende_todo_brasil: "CASE WHEN atende_todo_brasil THEN 'sim' WHEN length(trim(cidade_bairro)) > 0 THEN 'cidade' END",
  ...Object.fromEntries(
    ["acao_desejada", "experiencia_anuncios", "acesso_redes", "conta_anuncios", "cartao_pagamento", "arquivo_logo", "reuniao_computador"].map(
      (c) => [c, `CASE WHEN length(trim(${c})) > 0 THEN ${c} END`],
    ),
  ),
};

async function contarNoBanco(params: Record<string, string>, campo: string) {
  const where = ["TRUE"];
  const valores: unknown[] = [];
  const add = (v: unknown) => (valores.push(v), `$${valores.length}`);
  if (params.de) where.push(`to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') >= ${add(params.de)}`);
  if (params.ate) where.push(`to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') <= ${add(params.ate)}`);
  const colunas = { criativo: "utm_content", campanha: "utm_campaign", versao: "lp_variant" };
  for (const [param, coluna] of Object.entries(colunas)) if (params[param]) where.push(`${coluna} = ${add(params[param])}`);
  return sqlDono<{ valor: string | null; cadastros: number; agendou: number; nao_agendou: number }>(
    `SELECT ${EXPRESSOES[campo]} AS valor, count(*)::int AS cadastros,
            sum(CASE WHEN etapa2_concluida_em IS NOT NULL AND agendado_em IS NOT NULL THEN 1 ELSE 0 END)::int AS agendou,
            sum(CASE WHEN etapa2_concluida_em IS NOT NULL AND agendado_em IS NULL THEN 1 ELSE 0 END)::int AS nao_agendou
       FROM teste7d_inscricoes WHERE ${where.join(" AND ")} GROUP BY 1`,
    valores,
  );
}

const CORTES: Record<string, string>[] = [
  {},
  JULHO,
  { criativo: CRIATIVOS_PERFIL[0] },
  { campanha: "camp-y", versao: "B" },
  { de: "2026-07-05", ate: "2026-07-15", criativo: CRIATIVOS_PERFIL[1], campanha: "camp-x" },
  { campanha: "camp-sem-resposta" },
  { campanha: "camp-nao-existe", versao: "A" }, // sem nenhum cadastro
];

describe("números batem com a contagem independente", () => {
  for (const cortes of CORTES) {
    it(`cortes ${JSON.stringify(cortes)}`, async () => {
      const r = await perfil(cortes);
      for (const p of r.perguntas) {
        const banco = await contarNoBanco(cortes, p.campo);
        const de = (valor: string | null, col: "cadastros" | "agendou" | "nao_agendou") =>
          banco.find((b) => b.valor === valor)?.[col] ?? 0;
        const soma = (col: "cadastros" | "agendou" | "nao_agendou") => banco.reduce((s, b) => s + b[col], 0);

        expect(r.cadastros).toBe(soma("cadastros"));
        expect(r.agendaram).toBe(soma("agendou"));
        expect(r.naoAgendaram).toBe(soma("nao_agendou"));
        expect(r.completaram).toBe(soma("agendou") + soma("nao_agendou"));

        const d = p.distribuicao;
        expect(d.total).toBe(soma("cadastros"));
        expect(d.naoResponderam).toBe(de(null, "cadastros"));
        expect(d.respondidos).toBe(soma("cadastros") - de(null, "cadastros"));
        // Toda chave gravada aparece (inclusive as sem mapa).
        for (const b of banco.filter((x) => x.valor !== null)) expect(d.opcoes.map((o) => o.chave)).toContain(b.valor);
        for (const o of d.opcoes) {
          expect(o.pessoas, `${p.campo}=${o.chave}`).toBe(de(o.chave, "cadastros"));
          expect(o.percentual).toBe(d.respondidos ? o.pessoas! / d.respondidos : null);
        }

        const c = p.comparacao;
        const respAg = soma("agendou") - de(null, "agendou");
        const respNag = soma("nao_agendou") - de(null, "nao_agendou");
        expect(c.agendou).toEqual({ total: soma("agendou"), respondidos: respAg, naoResponderam: de(null, "agendou") });
        expect(c.naoAgendou).toEqual({ total: soma("nao_agendou"), respondidos: respNag, naoResponderam: de(null, "nao_agendou") });
        expect(c.amostraPequena).toBe(Math.min(respAg, respNag) < AMOSTRA_MINIMA_GRUPO);
        for (const l of c.linhas) {
          expect(l.agendou.pessoas).toBe(de(l.chave, "agendou"));
          expect(l.naoAgendou.pessoas).toBe(de(l.chave, "nao_agendou"));
          const a = respAg ? de(l.chave, "agendou") / respAg : null;
          const b = respNag ? de(l.chave, "nao_agendou") / respNag : null;
          expect(l.agendou.percentual).toBe(a);
          expect(l.naoAgendou.percentual).toBe(b);
          expect(l.diferenca).toBe(a === null || b === null ? null : a - b);
        }
      }
    });
  }

  it("julho: totais conhecidos do conjunto de teste", async () => {
    const r = await perfil(JULHO);
    expect(r).toMatchObject({ cadastros: 130, completaram: 90, agendaram: 45, naoAgendaram: 45, ocultaAbaixoDe: null });
    expect(r.cadastros).toBe(CADASTROS_PERFIL.length);
  });

  it("suporte e vendas veem os mesmos números do admin", async () => {
    const admin = await perfil(JULHO, "admin");
    expect(await perfil(JULHO, "suporte")).toEqual(admin);
    expect(await perfil(JULHO, "vendas")).toEqual(admin);
  });
});

describe("pergunta sem respostas e recorte vazio", () => {
  it("campanha só com quem não respondeu: 0 responderam, percentual vazio, todos em 'não responderam'", async () => {
    const r = await perfil({ campanha: "camp-sem-resposta" });
    expect(r.cadastros).toBe(10);
    for (const p of r.perguntas) {
      expect(p.distribuicao).toMatchObject({ total: 10, respondidos: 0, naoResponderam: 10 });
      expect(p.distribuicao.opcoes.every((o) => o.pessoas === 0 && o.percentual === null)).toBe(true);
      expect(p.comparacao.linhas.every((l) => l.diferenca === null && !l.destaque)).toBe(true);
    }
    for (const t of r.termos) expect(t).toMatchObject({ respondidos: 0, naoResponderam: 10, termos: [], outros: 0 });
  });

  it("recorte sem cadastro: tudo zero, nada inventado", async () => {
    const r = await perfil({ de: "2020-01-01", ate: "2020-01-31" });
    expect(r).toMatchObject({ cadastros: 0, completaram: 0, agendaram: 0, naoAgendaram: 0 });
    expect(r.perguntas.flatMap((p) => p.distribuicao.opcoes).every((o) => o.pessoas === 0)).toBe(true);
  });
});

describe("chaves sem mapa", () => {
  it("aparecem com a chave crua, marcadas, sem quebrar", async () => {
    const r = await perfil(JULHO);
    const acesso = r.perguntas.find((p) => p.campo === "acesso_redes")!;
    expect(acesso.distribuicao.opcoes.find((o) => o.chave === "chave_antiga")).toMatchObject({
      texto: "chave_antiga",
      semMapa: true,
      pessoas: 3,
    });
    const acao = r.perguntas.find((p) => p.campo === "acao_desejada")!;
    expect(acao.distribuicao.opcoes.find((o) => o.chave === "zz_nova")).toMatchObject({ texto: "zz_nova", semMapa: true, pessoas: 1 });
    // As do mapa vêm com o texto humano.
    expect(acao.distribuicao.opcoes.find((o) => o.chave === "whatsapp")).toMatchObject({ texto: "Me chamar no WhatsApp", semMapa: false });
  });
});

describe("comparação agendou × não agendou", () => {
  it("amostra suficiente: destaca só diferenças de 10 p.p. ou mais", async () => {
    const r = await perfil(JULHO);
    const conta = r.perguntas.find((p) => p.campo === "conta_anuncios")!;
    expect(conta.comparacao.amostraPequena).toBe(false);
    const sim = conta.comparacao.linhas.find((l) => l.chave === "sim")!;
    // Agendou: 36 de 45 têm conta; não agendou: 15 de 45.
    expect(sim.agendou).toEqual({ pessoas: 36, percentual: 36 / 45 });
    expect(sim.naoAgendou).toEqual({ pessoas: 15, percentual: 15 / 45 });
    expect(sim.destaque).toBe(true);
    const linhas = r.perguntas.flatMap((p) => p.comparacao.linhas);
    expect(linhas.some((l) => !l.destaque && l.diferenca !== null)).toBe(true);
    for (const l of linhas) expect(l.destaque).toBe(l.diferenca !== null && Math.abs(l.diferenca) >= DIFERENCA_RELEVANTE - 1e-9);
  });

  it("amostra pequena (um criativo, 15 em cada grupo): nada destacado", async () => {
    const r = await perfil({ criativo: CRIATIVOS_PERFIL[0] });
    expect(r).toMatchObject({ agendaram: 15, naoAgendaram: 15 });
    for (const p of r.perguntas) {
      expect(p.comparacao.amostraPequena).toBe(true);
      expect(p.comparacao.linhas.some((l) => l.destaque)).toBe(false);
    }
    // A diferença continua calculada (só não é destacada).
    const conta = r.perguntas.find((p) => p.campo === "conta_anuncios")!;
    expect(Math.abs(conta.comparacao.linhas.find((l) => l.chave === "sim")!.diferenca!)).toBeGreaterThan(DIFERENCA_RELEVANTE);
  });
});

describe("cidades e negócios", () => {
  it("normaliza (caixa, acento, pontuação, espaços) e conta; únicos vão para 'outros'", async () => {
    const r = await perfil(JULHO);
    const cidade = r.termos.find((t) => t.campo === "cidade_bairro")!;
    expect(cidade.termos).toEqual([
      { termo: "fortaleza aldeota", pessoas: 30 },
      { termo: "sao paulo", pessoas: 20 },
      { termo: "recife", pessoas: 6 },
      { termo: "crato", pessoas: 4 },
      { termo: "quixada", pessoas: 2 },
    ]);
    const respondidos = CADASTROS_PERFIL.filter((c) => typeof c.r.cidade_bairro === "string").length;
    expect(cidade).toMatchObject({ respondidos, naoResponderam: 130 - respondidos, outros: respondidos - 62, minimoPorTermo: 2 });

    const negocio = r.termos.find((t) => t.campo === "negocio_nome_oferta")!;
    expect(negocio.termos).toEqual([
      { termo: "doces", pessoas: 25 },
      { termo: "roupas femininas", pessoas: 15 },
      { termo: "pet shop", pessoas: 8 },
      { termo: "acai", pessoas: 3 },
    ]);
    // "   " não conta como resposta; "..." conta, mas não vira termo.
    const respNegocio = CADASTROS_PERFIL.filter((c) => typeof c.r.negocio_nome_oferta === "string").length - 1;
    expect(negocio).toMatchObject({ respondidos: respNegocio, outros: respNegocio - 51 });
  });

  it("leitura: termo só com 5 ou mais pessoas", async () => {
    const r = await perfil(JULHO, "leitura");
    const cidade = r.termos.find((t) => t.campo === "cidade_bairro")!;
    expect(cidade.termos.map((t) => t.termo)).toEqual(["fortaleza aldeota", "sao paulo", "recife"]);
    expect(cidade.minimoPorTermo).toBe(MINIMO_LEITURA);
    expect(cidade.outros).toBe(cidade.respondidos! - 56);
    const negocio = r.termos.find((t) => t.campo === "negocio_nome_oferta")!;
    expect(negocio.termos.map((t) => t.termo)).toEqual(["doces", "roupas femininas", "pet shop"]);
  });
});

// ── Leitura: células pequenas ocultas no servidor ──

/** Todos os números de pessoas do resultado, com o caminho. */
function numeros(r: PerfilDosLeads): [string, number | null][] {
  const saida: [string, number | null][] = [
    ["cadastros", r.cadastros],
    ["completaram", r.completaram],
    ["agendaram", r.agendaram],
    ["naoAgendaram", r.naoAgendaram],
  ];
  for (const p of r.perguntas) {
    const d = p.distribuicao;
    saida.push([`${p.campo}.respondidos`, d.respondidos], [`${p.campo}.(nao responderam)`, d.naoResponderam]);
    for (const o of d.opcoes) saida.push([`${p.campo}.${o.chave}`, o.pessoas]);
    for (const g of ["agendou", "naoAgendou"] as const) {
      saida.push([`${p.campo}.${g}.total`, p.comparacao[g].total], [`${p.campo}.${g}.(nao responderam)`, p.comparacao[g].naoResponderam]);
      for (const l of p.comparacao.linhas) saida.push([`${p.campo}.${g}.${l.chave}`, l[g].pessoas]);
    }
  }
  for (const t of r.termos) {
    saida.push([`${t.campo}.respondidos`, t.respondidos], [`${t.campo}.outros`, t.outros]);
    for (const x of t.termos) saida.push([`${t.campo}.${x.termo}`, x.pessoas]);
  }
  return saida;
}

/** O que ficou oculto numa partição (células que somam um total visível) não pode somar 1 a 4. */
function semDiferencaReveladora(celulasAdmin: number[], celulasLeitura: (number | null)[], onde: string) {
  const oculto = celulasAdmin.reduce((s, n, k) => s + (celulasLeitura[k] === null ? n : 0), 0);
  expect(oculto === 0 || oculto >= MINIMO_LEITURA, `${onde}: oculto soma ${oculto}`).toBe(true);
}

describe("leitura: células com menos de 5 pessoas ocultas no servidor", () => {
  const CORTES_PEQUENOS: Record<string, string>[] = [JULHO, { criativo: CRIATIVOS_PERFIL[0] }, { criativo: CRIATIVOS_PERFIL[0], versao: "A" }, { campanha: "camp-y", versao: "B" }];

  for (const cortes of CORTES_PEQUENOS) {
    it(`cortes ${JSON.stringify(cortes)}`, async () => {
      const admin = await perfil(cortes, "admin");
      const leitura = await perfil(cortes, "leitura");
      expect(leitura.ocultaAbaixoDe).toBe(MINIMO_LEITURA);

      const a = numeros(admin);
      const l = new Map(numeros(leitura));
      let ocultos = 0;
      for (const [onde, n] of a) {
        if (!l.has(onde)) continue; // termo que, para leitura, foi para "outros"
        const v = l.get(onde)!;
        expect(v === null || v === 0 || v >= MINIMO_LEITURA, `${onde} = ${v}`).toBe(true);
        if (v === null) ocultos++;
        // "Outros" de leitura pode somar mais termos (os que ficaram com menos de 5).
        else if (!onde.endsWith(".outros")) expect(v, onde).toBe(n);
        if (n !== null && n > 0 && n < MINIMO_LEITURA) expect(v, `${onde} devia estar oculto`).toBeNull();
      }
      if (cortes !== JULHO) expect(ocultos).toBeGreaterThan(0);

      // Percentual some junto com o número.
      for (const p of leitura.perguntas) {
        for (const o of p.distribuicao.opcoes) if (o.pessoas === null) expect(o.percentual).toBeNull();
        for (const x of p.comparacao.linhas) {
          if (x.agendou.pessoas === null || x.naoAgendou.pessoas === null) expect(x.diferenca).toBeNull();
        }
      }

      // Nada sai pela diferença do total.
      for (const [k, p] of leitura.perguntas.entries()) {
        const pa = admin.perguntas[k];
        if (p.distribuicao.total !== null) {
          semDiferencaReveladora(
            [...pa.distribuicao.opcoes.map((o) => o.pessoas!), pa.distribuicao.naoResponderam!],
            [...p.distribuicao.opcoes.map((o) => o.pessoas), p.distribuicao.naoResponderam],
            `${p.campo} distribuição`,
          );
        }
        for (const g of ["agendou", "naoAgendou"] as const) {
          if (p.comparacao[g].total === null) continue;
          semDiferencaReveladora(
            [...pa.comparacao.linhas.map((x) => x[g].pessoas!), pa.comparacao[g].naoResponderam!],
            [...p.comparacao.linhas.map((x) => x[g].pessoas), p.comparacao[g].naoResponderam],
            `${p.campo} ${g}`,
          );
        }
      }
      if (leitura.completaram !== null) {
        semDiferencaReveladora([admin.agendaram!, admin.naoAgendaram!], [leitura.agendaram, leitura.naoAgendaram], "grupos");
      }
      for (const [k, t] of leitura.termos.entries()) {
        const ta = admin.termos[k];
        const naLista = t.termos.reduce((s, x) => s + x.pessoas, 0);
        semDiferencaReveladora(
          [naLista, ta.respondidos! - naLista, ta.naoResponderam!],
          [naLista, t.outros, t.naoResponderam],
          `${t.campo} termos`,
        );
      }
    });
  }
});

describe("privacidade", () => {
  it("nenhum dado pessoal nem resposta única de texto livre, em nenhum papel", async () => {
    for (const papel of ["admin", "suporte", "vendas", "leitura"] as const) {
      for (const cortes of [{}, JULHO, { criativo: CRIATIVOS_PERFIL[0], versao: "A" }] as Record<string, string>[]) {
        const texto = JSON.stringify(await perfil(cortes, papel));
        for (const s of PESSOAIS_PERFIL) expect(texto, `${papel}: ${s}`).not.toContain(s);
        expect(texto).not.toMatch(/atelie|sitio isolado/);
      }
    }
  });
});
