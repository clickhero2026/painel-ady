import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Aviso } from "@/components/ui/Aviso";
import { google } from "@/lib/env";
import { caminhoInternoSeguro } from "@/lib/seguranca";
import { usuarioAtual } from "@/lib/sessao";
import { FormularioLogin } from "./FormularioLogin";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Mensagens de erro do login. Qualquer recusa (e-mail fora da lista,
 * desativado, Google sem acesso) cai na MESMA mensagem neutra: a tela
 * nunca diz se o e-mail existe. Só o link vencido/usado tem texto próprio
 * — quem recebeu o link já sabe que tem cadastro.
 */
function mensagemDeErro(erro: string | undefined): string | null {
  if (!erro) return null;
  if (erro === "INVALID_TOKEN") return "Este link de acesso venceu ou já foi usado. Peça um novo abaixo.";
  return "Não foi possível entrar com este e-mail. Se você deveria ter acesso, fale com um admin do painel.";
}

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const voltar = caminhoInternoSeguro(texto(params.voltar));

  if (await usuarioAtual()) redirect(voltar);

  const erro = mensagemDeErro(texto(params.error));
  const expirada = texto(params.motivo) === "expirada";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <section
          aria-labelledby="titulo-login"
          className="rounded-2xl border border-borda bg-fundo p-6 shadow-sm sm:p-8"
        >
          <h1 id="titulo-login" className="text-xl font-semibold">
            Entrar no painel
          </h1>
          <p className="mt-1 text-sm text-texto-suave">Acesso só para a equipe do ady.</p>

          <div className="mt-6 space-y-4">
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            {!erro && expirada && <Aviso tipo="info">Sua sessão expirou. Entre de novo para continuar.</Aviso>}
            <FormularioLogin voltar={voltar} comGoogle={Boolean(google())} />
          </div>
        </section>
      </div>
    </main>
  );
}
