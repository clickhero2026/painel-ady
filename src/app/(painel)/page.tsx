import type { Metadata } from "next";
import Link from "next/link";
import { ACESSO_ROTAS, podeAcessar, ROTULO_PAPEL } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Início" };

export default async function Inicio() {
  const usuario = await exigirUsuario(ACESSO_ROTAS.inicio);
  const primeiroNome = usuario.nome?.split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">{primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}</h1>
      <p className="mt-1 text-texto-suave">
        Você está no painel interno do ady com o papel <strong className="font-semibold text-texto">{ROTULO_PAPEL[usuario.papel]}</strong>.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {podeAcessar(usuario.papel, "leads") && (
          <section className="rounded-2xl border border-borda bg-fundo p-6">
            <h2 className="font-semibold">Leads do teste grátis</h2>
            <p className="mt-2 text-sm text-texto-suave">
              {usuario.papel === "vendas"
                ? "Os cadastros dos quais você é responsável, com a ficha de cada um."
                : "Todos os cadastros do teste de 7 dias, com a ficha de cada um."}
            </p>
            <Link href="/leads" className="mt-4 inline-flex min-h-11 items-center font-semibold text-petroleo-forte underline-offset-4 hover:underline">
              Ver leads
            </Link>
          </section>
        )}
        <section className="rounded-2xl border border-borda bg-fundo p-6">
          <h2 className="font-semibold">Indicadores</h2>
          <p className="mt-2 text-sm text-texto-suave">
            Inscrições, agendamentos e conversas realizadas, por período e por criativo. Também na próxima etapa.
          </p>
        </section>
        {usuario.papel === "admin" && (
          <section className="rounded-2xl border border-borda bg-fundo p-6 sm:col-span-2">
            <h2 className="font-semibold">Usuários</h2>
            <p className="mt-2 text-sm text-texto-suave">
              Só entra no painel quem estiver na lista de usuários, ativo. Adicione a equipe por e-mail.
            </p>
            <Link href="/usuarios" className="mt-4 inline-flex min-h-11 items-center font-semibold text-petroleo-forte underline-offset-4 hover:underline">
              Gerenciar usuários
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
