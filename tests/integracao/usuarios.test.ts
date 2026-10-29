import { beforeEach, describe, expect, it } from "vitest";
import { alterarPapel, criarUsuario, definirAtivo, ErroUsuarios, listarUsuarios } from "@/lib/usuarios";
import { abrirLink, auditoria, cadastrar, db, limparTudo, pedirLink, sessao, ultimoLink } from "./apoio";

let adminId: string;

beforeEach(async () => {
  await limparTudo();
  adminId = await cadastrar("admin@useady.com.br", "admin");
});

describe("gestão de usuários", () => {
  it("adiciona com e-mail normalizado e grava auditoria", async () => {
    const criado = await criarUsuario({ email: "  Nova.Pessoa@UseAdy.com.br ", nome: "Nova", papel: "vendas" }, adminId);
    expect(criado.email).toBe("nova.pessoa@useady.com.br");
    expect(criado.ativo).toBe(true);
    const [registro] = await auditoria("usuario_criado");
    expect(registro.usuario_id).toBe(adminId);
    expect(registro.detalhe).toMatchObject({ email: "nova.pessoa@useady.com.br", papel: "vendas" });
  });

  it("não deixa duplicar e-mail (sem diferenciar maiúsculas)", async () => {
    await expect(criarUsuario({ email: "ADMIN@useady.com.br", nome: null, papel: "leitura" }, adminId)).rejects.toThrow(
      ErroUsuarios,
    );
    expect(await auditoria("usuario_criado")).toHaveLength(0);
  });

  it("altera papel e grava de/para", async () => {
    const id = await cadastrar("pessoa@useady.com.br", "leitura");
    await alterarPapel(id, "suporte", adminId);
    const [registro] = await auditoria("usuario_papel_alterado");
    expect(registro.detalhe).toMatchObject({ de: "leitura", para: "suporte" });
    expect((await listarUsuarios()).find((u) => u.id === id)?.papel).toBe("suporte");
  });

  it("desativa (encerrando as sessões abertas) e reativa, com auditoria", async () => {
    const id = await cadastrar("saindo@useady.com.br", "vendas");
    await pedirLink("saindo@useady.com.br");
    const { cookie } = await abrirLink((await ultimoLink("saindo@useady.com.br"))!);
    expect(await sessao(cookie)).not.toBeNull();

    await definirAtivo(id, false, adminId);
    expect(await sessao(cookie)).toBeNull();
    await definirAtivo(id, true, adminId);
    expect(await auditoria("usuario_desativado")).toHaveLength(1);
    expect(await auditoria("usuario_reativado")).toHaveLength(1);
  });

  it("não deixa a pessoa desativar a si mesma", async () => {
    const outro = await cadastrar("outro.admin@useady.com.br", "admin");
    await expect(definirAtivo(outro, false, outro)).rejects.toThrow("próprio acesso");
  });
});

describe("último admin ativo", () => {
  it("não pode ser rebaixado", async () => {
    await expect(alterarPapel(adminId, "leitura", adminId)).rejects.toThrow("último admin");
    expect(await auditoria("usuario_papel_alterado")).toHaveLength(0);
  });

  it("não pode ser desativado (por outro usuário, mesmo com um admin desativado na lista)", async () => {
    const inativo = await cadastrar("admin.antigo@useady.com.br", "admin", false);
    await expect(definirAtivo(adminId, false, inativo)).rejects.toThrow("último admin");
  });

  it("com dois admins ativos, um pode ser rebaixado; aí o outro vira o último", async () => {
    const segundo = await cadastrar("segundo@useady.com.br", "admin");
    await alterarPapel(segundo, "vendas", adminId);
    await expect(alterarPapel(adminId, "vendas", adminId)).rejects.toThrow("último admin");
  });

  it("duas ações ao mesmo tempo não zeram os admins", async () => {
    const segundo = await cadastrar("segundo@useady.com.br", "admin");
    const resultados = await Promise.allSettled([
      alterarPapel(adminId, "leitura", segundo),
      alterarPapel(segundo, "leitura", adminId),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await db().query("SELECT count(*)::int AS n FROM painel_usuarios WHERE papel = 'admin' AND ativo");
    expect(rows[0].n).toBe(1);
  });
});
