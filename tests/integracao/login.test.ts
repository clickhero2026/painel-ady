import { beforeEach, describe, expect, it } from "vitest";
import {
  abrirLink,
  auditoria,
  cadastrar,
  db,
  entrarComGoogle,
  limparTudo,
  pedirLink,
  sessao,
  sqlDono,
  ultimoLink,
} from "./apoio";

const ADMIN_INICIAL = "primeiro.admin@vendedormestre.com.br";

beforeEach(async () => {
  await limparTudo();
  // Com a tabela vazia, o admin inicial seria criado em qualquer teste;
  // aqui ele já existe, e cada teste cadastra quem precisar.
  await cadastrar("dono@useady.com.br", "admin");
});

describe("link mágico", () => {
  it("e-mail permitido recebe o link, entra e a sessão leva o papel", async () => {
    await cadastrar("vendas@useady.com.br", "vendas");
    const resposta = await pedirLink("Vendas@UseAdy.com.br");
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: true });

    const link = await ultimoLink("vendas@useady.com.br");
    expect(link).toBeTruthy();
    const aberto = await abrirLink(link!);
    expect(aberto.status).toBe(302);
    expect(aberto.destino).toBe("http://localhost:3000/");
    const atual = await sessao(aberto.cookie);
    expect(atual?.user.email).toBe("vendas@useady.com.br");
    expect(atual?.session.papel).toBe("vendas");

    const logins = await auditoria("login");
    expect(logins).toHaveLength(1);
    expect(logins[0].detalhe).toEqual({ metodo: "link_magico" });
    const { rows } = await db().query("SELECT ultimo_acesso_em FROM painel_usuarios WHERE email = 'vendas@useady.com.br'");
    expect(rows[0].ultimo_acesso_em).not.toBeNull();
  });

  it("e-mail de outro domínio (sem Google Workspace) entra pelo link", async () => {
    await cadastrar("admin2@marketinglabs.com.br", "admin");
    await pedirLink("admin2@marketinglabs.com.br");
    const aberto = await abrirLink((await ultimoLink("admin2@marketinglabs.com.br"))!);
    expect((await sessao(aberto.cookie))?.user.email).toBe("admin2@marketinglabs.com.br");
  });

  it("e-mail fora da lista: mesma resposta, nenhum e-mail sai, auditoria registra", async () => {
    const resposta = await pedirLink("intruso@useady.com.br");
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: true });
    expect(await ultimoLink("intruso@useady.com.br")).toBeNull();
    const negados = await auditoria("acesso_negado");
    expect(negados[0].detalhe).toMatchObject({ email: "intruso@useady.com.br", motivo: "nao_cadastrado" });
  });

  it("não existe regra de domínio: outro e-mail do mesmo domínio de um usuário não entra", async () => {
    await cadastrar("fulano@vendedormestre.com.br", "admin");
    await pedirLink("ciclano@vendedormestre.com.br");
    expect(await ultimoLink("ciclano@vendedormestre.com.br")).toBeNull();
  });

  it("e-mail desativado: mesma resposta e nenhum e-mail", async () => {
    await cadastrar("saiu@useady.com.br", "suporte", false);
    const resposta = await pedirLink("saiu@useady.com.br");
    expect(await resposta.json()).toEqual({ status: true });
    expect(await ultimoLink("saiu@useady.com.br")).toBeNull();
    expect((await auditoria("acesso_negado"))[0].detalhe).toMatchObject({ motivo: "inativo" });
  });

  it("desativado entre o envio e o clique: o link não abre sessão", async () => {
    await cadastrar("quase@useady.com.br", "suporte");
    await pedirLink("quase@useady.com.br");
    const link = (await ultimoLink("quase@useady.com.br"))!;
    await db().query("UPDATE painel_usuarios SET ativo = false WHERE email = 'quase@useady.com.br'");
    const aberto = await abrirLink(link);
    expect(aberto.cookie).toBeNull();
    expect(aberto.destino).toContain("/login?error=");
  });

  it("link reutilizado não funciona na segunda vez", async () => {
    await cadastrar("uma.vez@useady.com.br");
    await pedirLink("uma.vez@useady.com.br");
    const link = (await ultimoLink("uma.vez@useady.com.br"))!;
    expect((await abrirLink(link)).cookie).toBeTruthy();
    const segunda = await abrirLink(link);
    expect(segunda.cookie).toBeNull();
    expect(segunda.destino).toBe("http://localhost:3000/login?error=INVALID_TOKEN");
  });

  it("link vence em 10 minutos", async () => {
    await cadastrar("lento@useady.com.br");
    await pedirLink("lento@useady.com.br");
    const { rows } = await db().query<{ minutos: number }>(
      "SELECT extract(epoch FROM expires_at - created_at) / 60 AS minutos FROM painel_auth_verification",
    );
    expect(Math.round(Number(rows[0].minutos))).toBe(10);

    await db().query("UPDATE painel_auth_verification SET expires_at = now() - interval '1 second'");
    const aberto = await abrirLink((await ultimoLink("lento@useady.com.br"))!);
    expect(aberto.cookie).toBeNull();
    expect(aberto.destino).toBe("http://localhost:3000/login?error=INVALID_TOKEN");
  });

  it("o token não fica gravado em texto puro", async () => {
    await cadastrar("hash@useady.com.br");
    await pedirLink("hash@useady.com.br");
    const token = new URL((await ultimoLink("hash@useady.com.br"))!).searchParams.get("token")!;
    const { rows } = await db().query<{ identifier: string }>("SELECT identifier FROM painel_auth_verification");
    expect(rows[0].identifier).not.toContain(token);
  });
});

describe("limite de tentativas do link mágico", () => {
  it("5 por e-mail a cada 15 minutos (o 6º recebe 429), mesmo vindo de IPs diferentes", async () => {
    await cadastrar("insistente@useady.com.br");
    for (let i = 0; i < 5; i++) expect((await pedirLink("insistente@useady.com.br", `198.51.100.${i}`)).status).toBe(200);
    expect((await pedirLink("insistente@useady.com.br", "198.51.100.99")).status).toBe(429);
    // Vale igual pra e-mail fora da lista (o limite não denuncia quem existe).
    for (let i = 0; i < 5; i++) await pedirLink("ninguem@useady.com.br", `198.51.101.${i}`);
    expect((await pedirLink("ninguem@useady.com.br", "198.51.101.99")).status).toBe(429);
  });

  it("20 por IP a cada 15 minutos, mesmo com e-mails diferentes", async () => {
    for (let i = 0; i < 20; i++) expect((await pedirLink(`pessoa${i}@useady.com.br`, "192.0.2.50")).status).toBe(200);
    expect((await pedirLink("pessoa99@useady.com.br", "192.0.2.50")).status).toBe(429);
    expect((await pedirLink("pessoa99@useady.com.br", "192.0.2.51")).status).toBe(200);
  });

  it("a janela passa e o e-mail volta a poder pedir", async () => {
    await cadastrar("paciente@useady.com.br");
    for (let i = 0; i < 6; i++) await pedirLink("paciente@useady.com.br");
    expect((await pedirLink("paciente@useady.com.br")).status).toBe(429);
    await db().query("UPDATE painel_auth_rate_limit SET last_request = last_request - 15 * 60 * 1000");
    expect((await pedirLink("paciente@useady.com.br")).status).toBe(200);
  });
});

describe("Google", () => {
  it("e-mail permitido entra pelo Google", async () => {
    await cadastrar("suporte@useady.com.br", "suporte");
    const login = await entrarComGoogle("suporte@useady.com.br");
    expect(login.status).toBe(200);
    expect((await sessao(login.cookie))?.session.papel).toBe("suporte");
    expect((await auditoria("login"))[0].detalhe).toEqual({ metodo: "google" });
  });

  it("e-mail fora da lista não entra e nem ganha registro de login", async () => {
    const login = await entrarComGoogle("qualquer@gmail.com");
    expect(login.cookie).toBeNull();
    expect(login.status).toBeGreaterThanOrEqual(400);
    const { rows } = await db().query("SELECT 1 FROM painel_auth_user WHERE email = 'qualquer@gmail.com'");
    expect(rows).toHaveLength(0);
    expect((await auditoria("acesso_negado"))[0].detalhe).toMatchObject({ metodo: "google", motivo: "nao_cadastrado" });
  });

  it("e-mail desativado não entra pelo Google", async () => {
    await cadastrar("antigo@useady.com.br", "vendas", false);
    expect((await entrarComGoogle("antigo@useady.com.br")).cookie).toBeNull();
  });

  it("quem já entrou e foi desativado não entra mais pelo Google", async () => {
    await cadastrar("ex@useady.com.br", "vendas");
    expect((await entrarComGoogle("ex@useady.com.br")).cookie).toBeTruthy();
    await db().query("UPDATE painel_usuarios SET ativo = false WHERE email = 'ex@useady.com.br'");
    expect((await entrarComGoogle("ex@useady.com.br")).cookie).toBeNull();
  });

  it("e-mail não verificado pelo Google não entra", async () => {
    await cadastrar("nao.verificado@useady.com.br");
    expect((await entrarComGoogle("nao.verificado@useady.com.br", false)).cookie).toBeNull();
  });

  it("mesmo e-mail pelo link e pelo Google vira a mesma pessoa", async () => {
    await cadastrar("dupla@useady.com.br");
    await pedirLink("dupla@useady.com.br");
    await abrirLink((await ultimoLink("dupla@useady.com.br"))!);
    expect((await entrarComGoogle("dupla@useady.com.br")).cookie).toBeTruthy();
    const { rows } = await db().query("SELECT 1 FROM painel_auth_user WHERE email = 'dupla@useady.com.br'");
    expect(rows).toHaveLength(1);
  });
});

describe("PAINEL_ADMIN_INICIAL", () => {
  it("com a tabela vazia, cria o primeiro admin na primeira tentativa de login", async () => {
    await sqlDono("TRUNCATE painel_usuarios CASCADE");
    await pedirLink(ADMIN_INICIAL.toUpperCase());
    const { rows } = await db().query("SELECT email, papel, ativo FROM painel_usuarios");
    expect(rows).toEqual([{ email: ADMIN_INICIAL, papel: "admin", ativo: true }]);
    expect(await ultimoLink(ADMIN_INICIAL)).toBeTruthy();
    expect(await auditoria("admin_inicial_criado")).toHaveLength(1);
  });

  it("com a tabela vazia, também vale pelo Google", async () => {
    await sqlDono("TRUNCATE painel_usuarios CASCADE");
    const login = await entrarComGoogle(ADMIN_INICIAL);
    expect((await sessao(login.cookie))?.session.papel).toBe("admin");
  });

  it("com a tabela vazia, outro e-mail não vira admin", async () => {
    await sqlDono("TRUNCATE painel_usuarios CASCADE");
    await pedirLink("outra.pessoa@vendedormestre.com.br");
    const { rows } = await db().query("SELECT 1 FROM painel_usuarios");
    expect(rows).toHaveLength(0);
  });

  it("com alguém já cadastrado, a variável não faz nada", async () => {
    await pedirLink(ADMIN_INICIAL);
    const { rows } = await db().query("SELECT email FROM painel_usuarios");
    expect(rows).toEqual([{ email: "dono@useady.com.br" }]);
    expect(await ultimoLink(ADMIN_INICIAL)).toBeNull();
  });
});

describe("sessão", () => {
  it("vence depois de 8 horas sem uso", async () => {
    await cadastrar("sumido@useady.com.br");
    await pedirLink("sumido@useady.com.br");
    const { cookie } = await abrirLink((await ultimoLink("sumido@useady.com.br"))!);
    const { rows } = await db().query<{ horas: number }>(
      "SELECT extract(epoch FROM expires_at - created_at) / 3600 AS horas FROM painel_auth_session",
    );
    expect(Math.round(Number(rows[0].horas))).toBe(8);

    await db().query("UPDATE painel_auth_session SET expires_at = now() - interval '1 second'");
    expect(await sessao(cookie)).toBeNull();
  });

  it("uso renova a validade (depois de 5 minutos da última renovação)", async () => {
    await cadastrar("ativo@useady.com.br");
    await pedirLink("ativo@useady.com.br");
    const { cookie } = await abrirLink((await ultimoLink("ativo@useady.com.br"))!);
    await db().query("UPDATE painel_auth_session SET expires_at = now() + interval '7 hours'");
    expect(await sessao(cookie)).not.toBeNull();
    const { rows } = await db().query<{ horas: number }>(
      "SELECT extract(epoch FROM expires_at - now()) / 3600 AS horas FROM painel_auth_session",
    );
    expect(Number(rows[0].horas)).toBeGreaterThan(7.9);
  });

  it("cookie de sessão é httpOnly e SameSite=Lax", async () => {
    await cadastrar("cookie@useady.com.br");
    await pedirLink("cookie@useady.com.br");
    const resposta = await (await import("./apoio")).auth.handler(
      new Request((await ultimoLink("cookie@useady.com.br"))!),
    );
    const cookie = resposta.headers.getSetCookie().find((c) => c.startsWith("painel.session_token="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});
