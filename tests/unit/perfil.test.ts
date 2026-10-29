import { describe, expect, it } from "vitest";
import { formatarPontos } from "@/lib/formatos";
import { celulasOcultas, MINIMO_LEITURA, minimoDoPapel, normalizarTermo } from "@/lib/perfil";

describe("normalizarTermo", () => {
  it("minúsculas, sem acentos, pontuação vira espaço, espaços colapsados", () => {
    expect(normalizarTermo("  SÃO  Paulo!! ")).toBe("sao paulo");
    expect(normalizarTermo("Fortaleza, Aldeota")).toBe("fortaleza aldeota");
    expect(normalizarTermo("FORTALEZA - ALDEOTA.")).toBe("fortaleza aldeota");
    expect(normalizarTermo("Pet-shop")).toBe("pet shop");
    expect(normalizarTermo("Açaí\tdo João")).toBe("acai do joao");
    expect(normalizarTermo("Loja 24h")).toBe("loja 24h");
    expect(normalizarTermo("...")).toBe("");
  });
});

describe("celulasOcultas", () => {
  it("sem mínimo (admin, suporte, vendas): nada oculto", () => {
    expect(celulasOcultas([1, 2, 30], 0)).toEqual([false, false, false]);
    expect(minimoDoPapel("admin")).toBe(0);
    expect(minimoDoPapel("leitura")).toBe(MINIMO_LEITURA);
  });

  it("oculta de 1 a 4; zero e 5+ ficam", () => {
    expect(celulasOcultas([0, 5, 12, 3, 2], 5)).toEqual([false, false, false, true, true]);
  });

  it("uma célula pequena sozinha: oculta também a menor visível (senão sai pela diferença do total)", () => {
    expect(celulasOcultas([20, 3, 7, 0], 5)).toEqual([false, true, true, false]);
    expect(celulasOcultas([9, 1, 6], 5)).toEqual([false, true, true]);
  });

  it("ocultas que já somam 5 ou mais: não precisa de mais nada", () => {
    expect(celulasOcultas([10, 4, 3], 5)).toEqual([false, true, true]);
  });
});

describe("formatarPontos", () => {
  it("com sinal e uma casa", () => {
    expect(formatarPontos(0.4667)).toBe("+46,7 p.p.");
    expect(formatarPontos(-0.2)).toBe("-20 p.p.");
    expect(formatarPontos(0)).toBe("0 p.p.");
  });
});
