import { describe, expect, it } from "vitest";
import { ACESSO_ROTAS, navegacaoDoPapel, PAPEIS, podeAcessar } from "@/lib/papeis";
import { caminhoInternoSeguro, montarCsp } from "@/lib/seguranca";
import { passouDoMaximo } from "@/lib/sessao";

describe("papéis", () => {
  it("barra lateral: Leads para admin, suporte e vendas; Funil para todos; Usuários só para admin", () => {
    expect(navegacaoDoPapel("admin").map((i) => i.href)).toEqual(["/", "/leads", "/funil", "/usuarios"]);
    expect(navegacaoDoPapel("suporte").map((i) => i.href)).toEqual(["/", "/leads", "/funil"]);
    expect(navegacaoDoPapel("vendas").map((i) => i.href)).toEqual(["/", "/leads", "/funil"]);
    expect(navegacaoDoPapel("leitura").map((i) => i.href)).toEqual(["/", "/funil"]);
  });

  it("funil: todos veem, só admin exporta", () => {
    for (const papel of PAPEIS) expect(podeAcessar(papel, "funil")).toBe(true);
    expect(PAPEIS.filter((p) => podeAcessar(p, "exportarFunil"))).toEqual(["admin"]);
  });

  it("acesso às áreas", () => {
    for (const papel of PAPEIS) expect(podeAcessar(papel, "inicio")).toBe(true);
    expect(ACESSO_ROTAS.usuarios).toEqual(["admin"]);
    expect(podeAcessar("suporte", "usuarios")).toBe(false);
  });
});

describe("sessão de 7 dias", () => {
  const dia = 24 * 60 * 60 * 1000;
  it("pede login de novo 7 dias depois da autenticação", () => {
    const agora = Date.now();
    expect(passouDoMaximo(new Date(agora - 6 * dia), agora)).toBe(false);
    expect(passouDoMaximo(new Date(agora - 7 * dia), agora)).toBe(true);
  });
});

describe("segurança", () => {
  it("só aceita destino interno depois do login", () => {
    expect(caminhoInternoSeguro("/usuarios")).toBe("/usuarios");
    expect(caminhoInternoSeguro("//evil.com")).toBe("/");
    expect(caminhoInternoSeguro("/\\evil.com")).toBe("/");
    expect(caminhoInternoSeguro("https://evil.com")).toBe("/");
    expect(caminhoInternoSeguro("/login")).toBe("/");
    expect(caminhoInternoSeguro(undefined)).toBe("/");
  });

  it("CSP com nonce, sem unsafe-inline e sem unsafe-eval em produção", () => {
    const csp = montarCsp("abc", false);
    expect(csp).toContain("'nonce-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });
});
