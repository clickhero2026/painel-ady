import type { Metadata } from "next";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";
import { listarUsuarios } from "@/lib/usuarios";
import { FormularioNovoUsuario } from "./FormularioNovoUsuario";
import { LinhaUsuario } from "./LinhaUsuario";

export const metadata: Metadata = { title: "Usuários" };

export default async function PaginaUsuarios() {
  const admin = await exigirUsuario(ACESSO_ROTAS.usuarios);
  const usuarios = await listarUsuarios();
  const ativos = usuarios.filter((u) => u.ativo).length;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Usuários</h1>
      <p className="mt-1 text-texto-suave">
        Só entra no painel quem está nesta lista e ativo, pelo Google ou pelo link por e-mail.
      </p>

      <section aria-labelledby="titulo-novo" className="mt-8 rounded-2xl border border-borda bg-fundo p-5 sm:p-6">
        <h2 id="titulo-novo" className="font-semibold">
          Adicionar usuário
        </h2>
        <FormularioNovoUsuario />
      </section>

      <section aria-labelledby="titulo-lista" className="mt-8">
        <h2 id="titulo-lista" className="font-semibold">
          Equipe <span className="font-normal text-texto-suave">({ativos} ativos de {usuarios.length})</span>
        </h2>
        <ul className="mt-4 divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-fundo">
          {usuarios.map((usuario) => (
            <LinhaUsuario
              key={usuario.id}
              usuario={{
                id: usuario.id,
                email: usuario.email,
                nome: usuario.nome,
                papel: usuario.papel,
                ativo: usuario.ativo,
                ultimoAcesso: usuario.ultimo_acesso_em?.toISOString() ?? null,
              }}
              ehVoce={usuario.id === admin.id}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
