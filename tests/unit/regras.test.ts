import { describe, expect, it } from "vitest";
import {
  ACESSO_ROTAS,
  ehAdmin,
  ehSuperAdmin,
  navegacaoDoPapel,
  PAPEIS,
  PAPEIS_ATRIBUIVEIS,
  PAPEIS_RESPONSAVEL,
  podeAcessar,
  temPapel,
} from "@/lib/papeis";
import { caminhoInternoSeguro, montarCsp } from "@/lib/seguranca";
import { passouDoMaximo } from "@/lib/sessao";

describe("papéis", () => {
  it("barra lateral: Leads para admin, suporte e vendas; Reuniões para fechar para admin e suporte; Funil e Perfil para todos; Usuários só para admin", () => {
    expect(navegacaoDoPapel("admin").map((i) => i.href)).toEqual([
      "/", "/leads", "/pipeline", "/leads?visao=para_fechar", "/funil", "/perfil", "/duplicados", "/usuarios",
    ]);
    expect(navegacaoDoPapel("suporte").map((i) => i.href)).toEqual(["/", "/leads", "/pipeline", "/leads?visao=para_fechar", "/funil", "/perfil"]);
    expect(navegacaoDoPapel("vendas").map((i) => i.href)).toEqual(["/", "/leads", "/pipeline", "/funil", "/perfil"]);
    expect(navegacaoDoPapel("leitura").map((i) => i.href)).toEqual(["/", "/funil", "/perfil"]);
    // Super admin: exatamente a barra do admin.
    expect(navegacaoDoPapel("super_admin")).toEqual(navegacaoDoPapel("admin"));
  });

  it("funil: todos veem, só admin exporta", () => {
    for (const papel of PAPEIS) expect(podeAcessar(papel, "funil")).toBe(true);
    expect(PAPEIS.filter((p) => podeAcessar(p, "exportarFunil"))).toEqual(["super_admin", "admin"]);
  });

  it("atribuir só admin; marcar reunião admin e suporte", () => {
    expect(PAPEIS.filter((p) => podeAcessar(p, "atribuir"))).toEqual(["super_admin", "admin"]);
    expect(PAPEIS.filter((p) => podeAcessar(p, "marcarReuniao"))).toEqual(["super_admin", "admin", "gestor", "suporte"]);
  });

  it("pipeline: admin, suporte e vendas veem; só admin e vendas mudam etapa; anotações para os três; mescla só admin", () => {
    expect(PAPEIS.filter((p) => podeAcessar(p, "pipeline"))).toEqual(["super_admin", "admin", "gestor", "suporte", "vendas"]);
    expect(PAPEIS.filter((p) => podeAcessar(p, "mudarEtapa"))).toEqual(["super_admin", "admin", "gestor", "vendas"]);
    expect(PAPEIS.filter((p) => podeAcessar(p, "anotar"))).toEqual(["super_admin", "admin", "gestor", "suporte", "vendas"]);
    expect(PAPEIS.filter((p) => podeAcessar(p, "mesclar"))).toEqual(["super_admin", "admin"]);
  });

  it("perfil: todos veem (sem exportação)", () => {
    for (const papel of PAPEIS) expect(podeAcessar(papel, "perfil")).toBe(true);
  });

  it("acesso às áreas", () => {
    for (const papel of PAPEIS) expect(podeAcessar(papel, "inicio")).toBe(true);
    expect(ACESSO_ROTAS.usuarios).toEqual(["admin"]);
    expect(podeAcessar("suporte", "usuarios")).toBe(false);
  });
});

describe("super admin", () => {
  it("herda TODAS as áreas do admin, sem exceção", () => {
    for (const area of Object.keys(ACESSO_ROTAS) as (keyof typeof ACESSO_ROTAS)[]) {
      if (podeAcessar("admin", area)) expect(podeAcessar("super_admin", area), area).toBe(true);
    }
  });

  it("apagar lead: só o super admin (admin comum não)", () => {
    expect(PAPEIS.filter((p) => podeAcessar(p, "apagarLead"))).toEqual(["super_admin"]);
    expect(temPapel("admin", ["super_admin"])).toBe(false);
  });

  it("os outros papéis não mudaram: cada área continua com a mesma lista de antes, fora o super admin", () => {
    const antes: Record<string, string[]> = {
      inicio: ["admin", "suporte", "vendas", "leitura"],
      leads: ["admin", "suporte", "vendas"],
      funil: ["admin", "suporte", "vendas", "leitura"],
      exportarFunil: ["admin"],
      exportarOrigem: ["admin"],
      perfil: ["admin", "suporte", "vendas", "leitura"],
      usuarios: ["admin"],
      atribuir: ["admin"],
      marcarReuniao: ["admin", "suporte"],
      pipeline: ["admin", "suporte", "vendas"],
      mudarEtapa: ["admin", "vendas"],
      anotar: ["admin", "suporte", "vendas"],
      mesclar: ["admin"],
      criarLead: ["admin", "vendas"],
      apagarLead: [],
    };
    // O gestor (papel novo) fica de fora daqui: tem o próprio teste abaixo.
    const antigos = PAPEIS_ATRIBUIVEIS.filter((p) => p !== "gestor");
    for (const [area, papeis] of Object.entries(antes)) {
      expect(antigos.filter((p) => podeAcessar(p, area as keyof typeof ACESSO_ROTAS)), area).toEqual(papeis);
    }
  });

  it("helpers: ehAdmin vale para admin e super admin; ehSuperAdmin só para super admin; a tela não oferece super_admin", () => {
    expect(PAPEIS.filter(ehAdmin)).toEqual(["super_admin", "admin"]);
    expect(PAPEIS.filter(ehSuperAdmin)).toEqual(["super_admin"]);
    expect(PAPEIS_ATRIBUIVEIS).not.toContain("super_admin");
  });
});

describe("gestor", () => {
  it("barra lateral: Início, Leads, Pipeline, Reuniões para fechar, Funil e Perfil; sem Duplicados e sem Usuários", () => {
    expect(navegacaoDoPapel("gestor").map((i) => i.href)).toEqual([
      "/", "/leads", "/pipeline", "/leads?visao=para_fechar", "/funil", "/perfil",
    ]);
  });

  it("áreas: suporte + vendas em todos os leads; nada de atribuir, mesclar, exportar, usuários ou apagar", () => {
    const areas = (Object.keys(ACESSO_ROTAS) as (keyof typeof ACESSO_ROTAS)[]).filter((a) => podeAcessar("gestor", a));
    expect(areas.sort()).toEqual(
      ["anotar", "criarLead", "funil", "inicio", "leads", "marcarReuniao", "mudarEtapa", "perfil", "pipeline"].sort(),
    );
    // Tudo o que suporte ou vendas pode, o gestor pode.
    for (const area of Object.keys(ACESSO_ROTAS) as (keyof typeof ACESSO_ROTAS)[]) {
      if (podeAcessar("suporte", area) || podeAcessar("vendas", area)) expect(podeAcessar("gestor", area), area).toBe(true);
    }
    expect(ehAdmin("gestor")).toBe(false);
    expect(PAPEIS_RESPONSAVEL).not.toContain("gestor");
    expect(PAPEIS_ATRIBUIVEIS).toContain("gestor");
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
