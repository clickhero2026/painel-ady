import { describe, expect, it } from "vitest";
import { hojeEmSaoPaulo, lerFiltrosFunil, somarDias, urlDoFunil } from "@/lib/filtrosFunil";
import { formatarDuracao } from "@/lib/formatos";

// 29/10/2026 às 01h30 em UTC = 28/10 às 22h30 em São Paulo.
const AGORA = new Date("2026-10-29T01:30:00Z");

describe("cortes do funil", () => {
  it("padrão: últimos 30 dias até hoje em São Paulo (não em UTC)", () => {
    expect(hojeEmSaoPaulo(AGORA)).toBe("2026-10-28");
    expect(lerFiltrosFunil({}, AGORA)).toMatchObject({ periodo: "30d", de: "2026-09-29", ate: "2026-10-28" });
    expect(lerFiltrosFunil({ periodo: "7d" }, AGORA)).toMatchObject({ de: "2026-10-22", ate: "2026-10-28" });
    expect(lerFiltrosFunil({ periodo: "tudo" }, AGORA)).toMatchObject({ periodo: "tudo", de: undefined, ate: undefined });
  });

  it("datas na URL valem mais que o atalho, e datas trocadas são desviradas", () => {
    expect(lerFiltrosFunil({ periodo: "7d", de: "2026-09-01" }, AGORA)).toMatchObject({
      periodo: "personalizado",
      de: "2026-09-01",
      ate: undefined,
    });
    expect(lerFiltrosFunil({ de: "2026-09-30", ate: "2026-09-01" }, AGORA)).toMatchObject({ de: "2026-09-01", ate: "2026-09-30" });
  });

  it("valores inválidos são ignorados", () => {
    const f = lerFiltrosFunil({ periodo: "1ano", de: "ontem", versao: "Z", oc: "nome; DROP", criativo: " " }, AGORA);
    expect(f).toMatchObject({ periodo: "30d", versao: undefined, criativo: undefined, oc: "cadastros", dc: "desc" });
  });

  it("URL: atalho sem datas calculadas; padrões fora da URL; ida e volta", () => {
    const f = lerFiltrosFunil({ periodo: "7d", criativo: "T7D-R1-H01-VID" }, AGORA);
    expect(urlDoFunil(f)).toBe("/funil?periodo=7d&criativo=T7D-R1-H01-VID");
    expect(urlDoFunil(lerFiltrosFunil({}, AGORA))).toBe("/funil");
    const p = lerFiltrosFunil({ de: "2026-09-01", ate: "2026-09-30", versao: "C", ov: "cadastros", dv: "desc" }, AGORA);
    const volta = lerFiltrosFunil(Object.fromEntries(new URL(urlDoFunil(p), "http://x").searchParams), AGORA);
    expect(volta).toEqual(p);
  });

  it("somarDias atravessa mês e ano", () => {
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("formatarDuracao", () => {
  it("minutos, horas e dias", () => {
    expect(formatarDuracao(20)).toBe("menos de 1 min");
    expect(formatarDuracao(12 * 60)).toBe("12 min");
    expect(formatarDuracao(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(formatarDuracao(5 * 3600)).toBe("5 h");
    expect(formatarDuracao(52 * 3600)).toBe("2 dias e 4 h");
    expect(formatarDuracao(-50)).toBe("menos de 1 min");
  });
});
