import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FormularioNovoLead } from "@/components/leads/FormularioNovoLead";
import { VALIDADE_LINK_ATIVACAO_DIAS } from "@/config/contato";
import { responsaveisPossiveis } from "@/lib/atribuicao";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Novo lead" };

/** Cadastro manual de lead: só admin e vendas (os outros papéis recebem 403). */
export default async function PaginaNovoLead() {
  const usuario = await exigirUsuario(ACESSO_ROTAS.criarLead);
  const opcoes = usuario.papel === "admin" ? await responsaveisPossiveis() : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/leads" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-petroleo-forte hover:underline">
        <ArrowLeft size={16} aria-hidden="true" />
        Voltar para os leads
      </Link>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Novo lead</h1>
      <p className="mt-1 text-texto-suave">
        Para quem chegou por outro caminho que não a página do teste grátis. Depois de cadastrar, copie o link de
        ativação na ficha e mande para a pessoa: ela mesma preenche a ativação. O link vale {VALIDADE_LINK_ATIVACAO_DIAS}{" "}
        dias.
      </p>
      <p className="mt-2 text-sm text-texto-suave">
        Lead cadastrado aqui fica fora dos indicadores de marketing (funil, origem e perfil), mas entra na lista, no
        pipeline e no funil comercial.
      </p>
      <div className="mt-6 rounded-2xl border border-borda bg-fundo p-5 sm:p-6">
        <FormularioNovoLead opcoes={opcoes} />
      </div>
    </div>
  );
}
