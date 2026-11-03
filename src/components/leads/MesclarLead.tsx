"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge } from "lucide-react";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { rotuloEtapaComercial } from "@/config/pipeline";
import { rotuloEtapa } from "@/lib/etapas";
import { formatarData, formatarWhatsapp } from "@/lib/formatos";
import { enviar } from "./enviar";

/** Resumo de um cadastro como a API devolve (datas em texto). */
export interface Cadastro {
  id: string;
  nome: string;
  email: string;
  whatsapp: string;
  status: string;
  etapa_comercial: string;
  responsavel_nome: string | null;
  source: string;
  medium: string;
  campaign: string;
  created_at: string;
}

interface Comparacao {
  a: Cadastro;
  b: Cadastro;
  sugerido: string;
}

const CAMPOS: [string, (c: Cadastro) => string][] = [
  ["Nome", (c) => c.nome],
  ["E-mail", (c) => c.email],
  ["WhatsApp", (c) => formatarWhatsapp(c.whatsapp)],
  ["Situação do teste", (c) => rotuloEtapa(c.status)],
  ["Etapa comercial", (c) => rotuloEtapaComercial(c.etapa_comercial)],
  ["Responsável", (c) => c.responsavel_nome ?? "sem responsável"],
  ["Origem", (c) => `${c.source} / ${c.medium} / ${c.campaign}`],
  ["Data do cadastro", (c) => formatarData(c.created_at) ?? ""],
];

/**
 * Admin: "Mesclar com outro lead". Busca o outro cadastro (ou parte de uma
 * sugestão), mostra os dois lado a lado com o principal sugerido (o mais
 * avançado) e só mescla depois da confirmação. O servidor confere tudo de
 * novo.
 */
export function MesclarLead({ leadId, sugestoes }: { leadId: string; sugestoes: Cadastro[] }) {
  const router = useRouter();
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [candidatos, setCandidatos] = useState<Cadastro[] | null>(null);
  const [comparacao, setComparacao] = useState<Comparacao | null>(null);
  const [principal, setPrincipal] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const tituloComparacao = useRef<HTMLHeadingElement>(null);
  const campoBusca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (comparacao) tituloComparacao.current?.focus();
  }, [comparacao]);
  useEffect(() => {
    if (aberto && !comparacao) campoBusca.current?.focus();
  }, [aberto, comparacao]);

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    if (q.trim().length < 2) {
      setErro("Digite pelo menos 2 letras ou números para buscar.");
      return;
    }
    setBuscando(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/mescla?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setCandidatos((await r.json()).candidatos);
    } catch {
      setErro("Não deu para buscar. Tente de novo.");
    } finally {
      setBuscando(false);
    }
  }

  async function comparar(outro: string) {
    setErro(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/mescla?com=${outro}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "Este cadastro não está mais disponível para mescla. Busque de novo." : "");
      const c: Comparacao = await r.json();
      setComparacao(c);
      setPrincipal(c.sugerido);
    } catch (e) {
      setErro((e as Error).message || "Não deu para comparar. Tente de novo.");
    }
  }

  async function confirmar() {
    if (!comparacao) return;
    setGravando(true);
    setErro(null);
    const r = await enviar<{ principal: string }>(`/api/leads/${leadId}/mescla`, "POST", { com: comparacao.b.id, principal });
    setGravando(false);
    if (!r.ok) {
      setErro(r.mensagem);
      return;
    }
    setComparacao(null);
    setCandidatos(null);
    setAberto(false);
    if (r.dados.principal === leadId) {
      setFeito("Cadastros mesclados. O outro cadastro aparece agora em “Cadastros mesclados”.");
      router.refresh();
    } else {
      router.push(`/leads/${r.dados.principal}`);
    }
  }

  const lista = candidatos ?? null;

  return (
    <div>
      {feito && (
        <div className="mb-3">
          <Aviso tipo="sucesso">{feito}</Aviso>
        </div>
      )}
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={`${id}-painel`}
        onClick={() => {
          setAberto((v) => !v);
          setComparacao(null);
          setErro(null);
          setFeito(null);
        }}
        className={botao.secundario}
      >
        <GitMerge size={18} aria-hidden="true" />
        Mesclar com outro lead
      </button>

      {aberto && (
        <div id={`${id}-painel`} className="mt-4 space-y-4">
          {!comparacao && (
            <>
              <form onSubmit={buscar} role="search" aria-label="Buscar o outro cadastro">
                <label htmlFor={`${id}-q`} className={rotulo}>
                  Buscar o outro cadastro por nome, e-mail ou WhatsApp
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    ref={campoBusca}
                    id={`${id}-q`}
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    autoComplete="off"
                    className={campo}
                  />
                  <button type="submit" disabled={buscando} className={`${botao.primario} shrink-0`}>
                    {buscando ? "Buscando…" : "Buscar"}
                  </button>
                </div>
              </form>

              {sugestoes.length > 0 && !lista && (
                <ListaDeCadastros titulo="Possíveis duplicados deste lead" itens={sugestoes} comparar={comparar} />
              )}
              {lista && (
                <div aria-live="polite">
                  {lista.length === 0 ? (
                    <p className="text-sm text-texto-suave">Nenhum outro cadastro encontrado com essa busca.</p>
                  ) : (
                    <ListaDeCadastros titulo="Resultado da busca" itens={lista} comparar={comparar} />
                  )}
                </div>
              )}
            </>
          )}

          {comparacao && (
            <section aria-labelledby={`${id}-titulo`} className="rounded-lg border border-borda-campo bg-superficie p-4">
              <h3 id={`${id}-titulo`} ref={tituloComparacao} tabIndex={-1} className="font-semibold">
                Confira os dois cadastros antes de mesclar
              </h3>
              <div role="region" aria-label="Os dois cadastros lado a lado" tabIndex={0} className="relative mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <caption className="sr-only">Os dois cadastros lado a lado</caption>
                  <thead className="border-b border-borda">
                    <tr>
                      <th scope="col" className="px-2 py-2 text-left">Campo</th>
                      <th scope="col" className="px-2 py-2 text-left">Este cadastro</th>
                      <th scope="col" className="px-2 py-2 text-left">Outro cadastro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borda">
                    {CAMPOS.map(([nome, valor]) => (
                      <tr key={nome}>
                        <th scope="row" className="px-2 py-2 text-left font-medium">{nome}</th>
                        <td className="px-2 py-2 wrap-anywhere">{valor(comparacao.a)}</td>
                        <td className="px-2 py-2 wrap-anywhere">{valor(comparacao.b)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <fieldset className="mt-4">
                <legend className="font-medium">Qual cadastro fica como principal?</legend>
                <p className="text-sm text-texto-suave">
                  Sugerido: o mais avançado. O outro some das listas e das contagens, mas nada é apagado e dá para desfazer.
                  O principal mantém a própria etapa e a própria origem; se ele não tem responsável, herda o do outro.
                </p>
                {[comparacao.a, comparacao.b].map((c, k) => (
                  <label key={c.id} className="mt-1 flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name={`${id}-principal`}
                      value={c.id}
                      checked={principal === c.id}
                      onChange={() => setPrincipal(c.id)}
                      className="h-5 w-5 shrink-0 accent-petroleo-forte"
                    />
                    <span className="wrap-anywhere">
                      {k === 0 ? "Este cadastro" : "Outro cadastro"}: {c.nome} ({formatarData(c.created_at)})
                      {c.id === comparacao.sugerido ? " — sugerido" : ""}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button type="button" disabled={gravando} onClick={confirmar} className={botao.primario}>
                  {gravando ? "Mesclando…" : "Confirmar mescla"}
                </button>
                <button
                  type="button"
                  disabled={gravando}
                  onClick={() => {
                    setComparacao(null);
                    setErro(null);
                  }}
                  className={botao.secundario}
                >
                  Voltar
                </button>
              </div>
            </section>
          )}

          {erro && <Aviso tipo="erro">{erro}</Aviso>}
        </div>
      )}
    </div>
  );
}

function ListaDeCadastros({ titulo, itens, comparar }: { titulo: string; itens: Cadastro[]; comparar: (id: string) => void }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <ul className="mt-2 divide-y divide-borda rounded-lg border border-borda">
        {itens.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="font-medium wrap-anywhere">{c.nome}</p>
              <p className="text-texto-suave wrap-anywhere">
                {c.email} · {formatarWhatsapp(c.whatsapp)} · cadastro em {formatarData(c.created_at)}
              </p>
            </div>
            <button type="button" onClick={() => comparar(c.id)} className={`${botao.secundario} shrink-0`}>
              Comparar<span className="sr-only"> com {c.nome}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
