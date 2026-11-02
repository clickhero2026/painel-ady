import { beforeAll, describe, expect, it } from "vitest";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { mascararOrigem, ORIGEM_MASCARADA, opcoesDoFunil, SEM_ORIGEM } from "@/lib/funil";
import { csvOrigem, origemDosLeads, type LinhaOrigem } from "@/lib/origem";
import type { Papel } from "@/lib/papeis";
import { EMAIL_NO_UTM, FORMULA, semearOrigem, TOTAL_ORIGEM, pessoalOrigem } from "../fixtures/origem";
import { limparTudo, sqlDono } from "./apoio";

const OUTUBRO = { de: "2026-10-01", ate: "2026-10-31" };
const origem = (params: Record<string, string>, papel: Papel = "admin") =>
  origemDosLeads(lerFiltrosFunil({ ...OUTUBRO, ...params }), papel);
const achar = (linhas: LinhaOrigem[], grupo: string) => linhas.find((l) => l.grupo === grupo);

/** Normalização escrita de outro jeito, sem as expressões do módulo. */
const NORM = (c: string) => `coalesce(nullif(array_to_string(array_remove(regexp_split_to_array(lower(${c}), '\\s+'), ''), ' '), ''), '${SEM_ORIGEM}')`;

async function contarNoBanco(colunas: string[], where = "TRUE", valores: unknown[] = []) {
  const chave = colunas.map(NORM).join(` || ' / ' || `);
  return sqlDono<{ grupo: string; cadastros: number; ativacoes: number; agendamentos: number }>(
    `SELECT ${chave} AS grupo, count(*)::int AS cadastros,
            sum((etapa2_concluida_em IS NOT NULL)::int)::int AS ativacoes,
            sum((agendado_em IS NOT NULL)::int)::int AS agendamentos
       FROM teste7d_inscricoes WHERE ${where} GROUP BY 1`,
    valores,
  );
}

beforeAll(async () => {
  await limparTudo();
  await semearOrigem(sqlDono);
});

describe("números batem com a contagem independente", () => {
  const VISOES = {
    source: ["utm_source"],
    source_medium: ["utm_source", "utm_medium"],
    campaign: ["utm_campaign"],
    completa: ["utm_source", "utm_medium", "utm_campaign"],
  };
  for (const [vo, colunas] of Object.entries(VISOES)) {
    it(`visão ${vo}`, async () => {
      const r = await origem({ vo });
      const banco = await contarNoBanco(colunas);
      const fila = r.linhas.map((l) => [l.grupo, l.cadastros, l.ativacoes, l.agendamentos]);
      for (const b of banco) {
        // O grupo com e-mail é mascarado; o resto bate linha a linha.
        if (b.grupo.includes(EMAIL_NO_UTM)) continue;
        expect(fila).toContainEqual([b.grupo, b.cadastros, b.ativacoes, b.agendamentos]);
      }
      expect(r.total.cadastros).toBe(TOTAL_ORIGEM);
      expect(r.linhas.reduce((s, l) => s + l.cadastros, 0)).toBe(TOTAL_ORIGEM);
    });
  }
});

describe("normalização", () => {
  it('"Meta", "meta" e " META " agrupam juntos', async () => {
    const r = await origem({});
    expect(achar(r.linhas, "meta / ga2 / ad16")?.cadastros).toBe(12);
    expect(r.linhas.filter((l) => l.grupo.toLowerCase().includes("meta / ga2 / ad16"))).toHaveLength(1);
  });

  it("espaços internos colapsados", async () => {
    expect(achar((await origem({})).linhas, "meta / ga3 / promo natal")?.cadastros).toBe(6);
  });

  it('nulo, vazio e só espaços viram "(sem origem)", sem descartar', async () => {
    const r = await origem({});
    const sem = `${SEM_ORIGEM} / ${SEM_ORIGEM} / ${SEM_ORIGEM}`;
    expect(achar(r.linhas, sem)?.cadastros).toBe(7);
    expect(r.semOrigem).toEqual({ cadastros: 7, percentual: 7 / TOTAL_ORIGEM });
  });

  it("clicar na linha filtra pelo valor normalizado, inclusive (sem origem)", async () => {
    const r = await origem({ vo: "source" });
    const meta = achar(r.linhas, "meta")!;
    expect(meta.filtro).toEqual({ origem: "meta" });
    const filtrado = await origem({ ...meta.filtro });
    expect(filtrado.total.cadastros).toBe(21);
    const sem = await origem({ origem: SEM_ORIGEM });
    expect(sem.total.cadastros).toBe(7);
    // Filtro escrito de outro jeito cai no mesmo grupo.
    expect((await origem({ origem: " META " })).total.cadastros).toBe(21);
  });

  it("as opções do corte vêm normalizadas e sem dado pessoal", async () => {
    const o = await opcoesDoFunil("admin");
    expect(o.origens).toContain("meta");
    expect(o.origens).not.toContain("Meta");
    expect(o.origens).toContain(SEM_ORIGEM);
    expect(o.campanhas).not.toContain(EMAIL_NO_UTM);
  });
});

describe("dados pessoais e fórmula", () => {
  it("e-mail no UTM sai mascarado e não vira filtro", async () => {
    const r = await origem({});
    expect(JSON.stringify(r)).not.toContain(EMAIL_NO_UTM);
    const l = r.linhas.find((x) => x.campaign === ORIGEM_MASCARADA)!;
    expect(l.cadastros).toBe(1);
    expect(l.filtro).toBeNull();
  });

  it("máscara: telefone e token sim; id de anúncio e campanha comum não", () => {
    expect(mascararOrigem("5585999998888")).toBe(ORIGEM_MASCARADA);
    expect(mascararOrigem("85999998888")).toBe(ORIGEM_MASCARADA);
    expect(mascararOrigem("a".repeat(32))).toBe(ORIGEM_MASCARADA);
    expect(mascararOrigem("23851234567890123")).toBe("23851234567890123");
    expect(mascararOrigem("ad16")).toBe("ad16");
  });

  it("CSV: BOM, separador ; e fórmula protegida", async () => {
    const { csv } = await csvOrigem(lerFiltrosFunil(OUTUBRO), "admin");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split("\r\n")[0]).toContain("source;medium;campaign;cadastros");
    expect(csv).toContain(`"'${FORMULA.toLowerCase().replace(/"/g, '""')}"`);
    expect(csv).not.toMatch(/;=hyperlink/);
    expect(csv).not.toContain(EMAIL_NO_UTM);
    for (let n = 0; n < TOTAL_ORIGEM; n++) for (const p of pessoalOrigem(n)) expect(csv).not.toContain(p);
  });
});

describe("amostra pequena, vazio, filtros e fuso", () => {
  it("amostra pequena abaixo de 30, no limite não", async () => {
    const r = await origem({});
    expect(r.linhas.every((l) => l.amostraPequena === l.cadastros < 30)).toBe(true);
    expect(achar((await origem({ vo: "source" })).linhas, "meta")?.amostraPequena).toBe(true);
  });

  it("período vazio", async () => {
    const r = await origem({ de: "2020-01-01", ate: "2020-01-07" });
    expect(r.vazio).toBe(true);
    expect(r.linhas).toEqual([]);
    expect(r.total.cadastros).toBe(0);
    expect(r.semOrigem.cadastros).toBe(0);
  });

  it("filtros combinados batem com o SQL independente", async () => {
    const r = await origem({ origem: "meta", midia: "ga2", campanha: "ad17" });
    const banco = await contarNoBanco(
      ["utm_source"],
      `${NORM("utm_source")} = 'meta' AND ${NORM("utm_medium")} = 'ga2' AND ${NORM("utm_campaign")} = 'ad17'`,
    );
    expect(r.total.cadastros).toBe(banco[0].cadastros);
    expect(r.total.cadastros).toBe(3);
  });

  it("fuso: 23h30 de São Paulo fica no próprio dia", async () => {
    expect((await origem({ de: "2026-10-10", ate: "2026-10-10", origem: "tiktok" })).total.cadastros).toBe(1);
    expect((await origem({ de: "2026-10-11", ate: "2026-10-11", origem: "tiktok" })).total.cadastros).toBe(1);
  });

  it("ordena e pagina em 25", async () => {
    const asc = await origem({ oo: "cadastros", odo: "asc" });
    const n = asc.linhas.map((l) => l.cadastros);
    expect(n).toEqual([...n].sort((a, b) => a - b));

    const muitos = Array.from({ length: 30 }, (_, i) => i);
    for (const i of muitos) {
      await sqlDono(
        `INSERT INTO teste7d_inscricoes (id, created_at, nome, email, whatsapp, utm_source, utm_medium, utm_campaign)
         VALUES (gen_random_uuid(), '2027-01-05T12:00:00-03:00', 'Pag', $1, $2, 'pag', 'x', $3)`,
        [`pag${i}@exemplo.com.br`, `55860000${String(i).padStart(5, "0")}`, `c${i}`],
      );
    }
    const JAN = { de: "2027-01-01", ate: "2027-01-31" };
    const p1 = await origem(JAN);
    expect(p1.linhas).toHaveLength(25);
    expect(p1.pagina).toMatchObject({ atual: 1, total: 2, linhasNoTotal: 30 });
    const p2 = await origem({ ...JAN, po: "2" });
    expect(p2.linhas).toHaveLength(5);
    expect((await origem({ ...JAN, po: "99" })).pagina.atual).toBe(2);
    await sqlDono("DELETE FROM teste7d_inscricoes WHERE email LIKE 'pag%@exemplo.com.br'");
  });
});

describe('papel "leitura"', () => {
  const fino = async (params: Record<string, string> = {}) => origem(params, "leitura");

  it("não recebe linha com menos de 5, e as ocultas somam em outras origens", async () => {
    for (const vo of ["completa", "source", "source_medium", "campaign"]) {
      const r = await fino({ vo });
      expect(r.linhas.every((l) => l.cadastros >= 5)).toBe(true);
      expect(JSON.stringify(r)).not.toContain("ad17");
      expect(JSON.stringify(r)).not.toContain("tiktok");
      // ad17 (3) + tiktok (2) + news (1) = 6: já passa de 5, nada mais oculto.
      expect(r.outras?.cadastros).toBe(6);
      expect(r.linhas.reduce((s, l) => s + l.cadastros, 0) + r.outras!.cadastros!).toBe(TOTAL_ORIGEM);
    }
  });

  it("comparar visões não revela a linha oculta", async () => {
    const source = await fino({ vo: "source" });
    const completa = await fino({ vo: "completa" });
    const meta = achar(source.linhas, "meta")!.cadastros;
    const partes = completa.linhas.filter((l) => l.source === "meta").reduce((s, l) => s + l.cadastros, 0);
    expect(meta).toBe(partes); // os 3 de ad17 não aparecem pela diferença
    expect(meta).toBe(18);
  });

  it("proteção contra subtração: oculta soma pequena junto com a menor visível", async () => {
    // Só meta / ga2: ad16 (12) + ad17 (3). Oculta só ad17 daria 3 pela diferença do total.
    const r = await fino({ origem: "meta", midia: "ga2" });
    expect(r.linhas).toEqual([]);
    expect(r.outras?.cadastros).toBe(15);
  });

  it("total abaixo de 5 também não aparece", async () => {
    const r = await fino({ origem: "meta", campanha: "ad17" });
    expect(r.total.cadastros).toBeNull();
    expect(r.outras?.cadastros).toBeNull();
    expect(r.linhas).toEqual([]);
  });

  it("nenhuma célula de 1 a 4 nas linhas nem em outras origens", async () => {
    const r = await fino({});
    for (const c of [...r.linhas, r.outras!]) {
      for (const v of [c.ativacoes, c.agendamentos]) {
        if (v !== null) expect(v === 0 || v >= 5).toBe(true);
      }
    }
  });

  it("taxa não vaza célula oculta", async () => {
    const r = await fino({});
    for (const l of r.linhas) {
      if (l.ativacoes === null) expect(l.taxas.ativacao).toBeNull();
      if (l.agendamentos === null) expect(l.taxas.geral).toBeNull();
    }
  });

  it("as opções do corte não trazem valor raro", async () => {
    const o = await opcoesDoFunil("leitura");
    expect(o.campanhas).not.toContain("ad17");
    expect(o.origens).not.toContain("tiktok");
    expect(o.origens).toContain("meta");
  });

  it("outros papéis não têm ocultação", async () => {
    for (const papel of ["admin", "suporte", "vendas"] as const) {
      const r = await origem({}, papel);
      expect(r.outras).toBeNull();
      expect(achar(r.linhas, "meta / ga2 / ad17")?.cadastros).toBe(3);
    }
  });
});
