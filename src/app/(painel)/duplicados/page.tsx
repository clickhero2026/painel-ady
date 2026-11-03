import type { Metadata } from "next";
import Link from "next/link";
import { Aviso } from "@/components/ui/Aviso";
import { rotuloEtapaComercial } from "@/config/pipeline";
import { rotuloEtapa } from "@/lib/etapas";
import { formatarData, formatarWhatsapp } from "@/lib/formatos";
import { MAX_GRUPOS, possiveisDuplicados, type Criterio } from "@/lib/mescla";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Possíveis duplicados" };

const CRITERIO: Record<Criterio, string> = {
  whatsapp: "Mesmo WhatsApp",
  nome: "Mesmo nome",
  whatsapp_e_nome: "Mesmo WhatsApp e mesmo nome",
};

/** Admin: grupos de leads com o mesmo WhatsApp ou nome normalizado. Só sugere; a mescla é feita na ficha. */
export default async function PaginaDuplicados() {
  const usuario = await exigirUsuario(ACESSO_ROTAS.mesclar);
  const grupos = await possiveisDuplicados(usuario);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Possíveis duplicados</h1>
      <p className="mt-1 text-texto-suave">
        Leads com o mesmo WhatsApp (DDD e os 8 últimos dígitos) ou o mesmo nome (sem acentos, maiúsculas nem pontuação).
        É só uma sugestão: nada é mesclado sozinho. Para mesclar, abra a ficha e use “Mesclar com outro lead”.
      </p>

      {grupos.length === 0 ? (
        <div className="mt-6">
          <Aviso tipo="info">Nenhum possível duplicado encontrado.</Aviso>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-texto-suave">
            {grupos.length === 1 ? "1 grupo" : `${grupos.length} grupos`}
            {grupos.length >= MAX_GRUPOS ? ` (mostrando os ${MAX_GRUPOS} mais recentes)` : ""}.
          </p>
          <ol className="mt-3 space-y-4">
            {grupos.map((g, k) => (
              <li key={g.leads.map((l) => l.id).join("-")}>
                <section aria-labelledby={`grupo-${k}`} className="rounded-2xl border border-borda bg-fundo p-4 sm:p-5">
                  <h2 id={`grupo-${k}`} className="font-semibold">
                    {CRITERIO[g.criterio]} · {g.leads.length} cadastros
                  </h2>
                  <ul className="mt-3 divide-y divide-borda">
                    {g.leads.map((l) => (
                      <li key={l.id} className="py-3 text-sm">
                        <Link href={`/leads/${l.id}`} prefetch={false} className="font-semibold text-petroleo-forte underline underline-offset-4 wrap-anywhere">
                          {l.nome}
                        </Link>
                        <p className="mt-1 text-texto-suave wrap-anywhere">
                          {formatarWhatsapp(l.whatsapp)} · {l.email}
                        </p>
                        <p className="text-texto-suave wrap-anywhere">
                          Cadastro em {formatarData(l.created_at)} · {rotuloEtapa(l.status)} · {rotuloEtapaComercial(l.etapa_comercial)} ·{" "}
                          {l.responsavel_nome ?? "sem responsável"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
