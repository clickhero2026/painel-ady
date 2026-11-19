"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { classeDoAviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { ROTULO_PAPEL } from "@/lib/papeis";
import type { OpcaoResponsavel } from "./AtribuirResponsavel";
import { enviar } from "./enviar";

/**
 * Atribuição em lote na lista (só admin). A seleção vale para a página
 * atual da lista; cada lead tem uma caixa de marcar comum (teclado: Tab e
 * espaço), na tabela e nos cartões do celular.
 *
 * O resultado da atribuição fica em <AvisoDoLote>, no nível da página e
 * fora de <SelecaoEmLote>: quando a atribuição esvazia a lista (a fila "Sem
 * responsável", por exemplo), a página deixa de montar a seleção e o aviso
 * precisa continuar na tela. A região viva já existe antes da mensagem
 * (role="status", aria-live="polite") para o leitor de tela anunciar, e o
 * foco vai para ela depois da atribuição: o botão que tinha o foco fica
 * desabilitado (seleção zerada) ou some junto com a lista.
 */

const MAX = 100;

interface Selecao {
  marcados: Set<string>;
  alternar(id: string, marcado: boolean): void;
}

const Contexto = createContext<Selecao | null>(null);

interface Resultado {
  ok: boolean;
  texto: string;
}

const ContextoAviso = createContext<((r: Resultado) => void) | null>(null);

/**
 * Região do resultado do lote. Envolve a área da lista na página (sempre
 * montada para quem pode atribuir), com `key` da URL da lista: trocar de
 * filtro ou de página limpa o aviso; o router.refresh() da mesma URL não.
 */
export function AvisoDoLote({ children }: { children: React.ReactNode }) {
  const [resultado, setResultado] = useState<(Resultado & { vez: number }) | null>(null);
  const regiao = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (resultado) regiao.current?.focus();
  }, [resultado]);

  return (
    <ContextoAviso.Provider value={(r) => setResultado((atual) => ({ ...r, vez: (atual?.vez ?? 0) + 1 }))}>
      <div
        ref={regiao}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        className={resultado ? "mb-4 rounded-lg outline-offset-2" : undefined}
      >
        {resultado && <div className={classeDoAviso(resultado.ok ? "sucesso" : "erro")}>{resultado.texto}</div>}
      </div>
      {children}
    </ContextoAviso.Provider>
  );
}

export function SelecaoEmLote({
  ids,
  opcoes,
  children,
}: {
  ids: string[];
  opcoes: OpcaoResponsavel[];
  children: React.ReactNode;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const alternar = (id: string, marcado: boolean) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.add(id);
      else novo.delete(id);
      return novo;
    });

  return (
    <Contexto.Provider value={{ marcados, alternar }}>
      <BarraDoLote ids={ids} opcoes={opcoes} marcados={marcados} definir={setMarcados} />
      {children}
    </Contexto.Provider>
  );
}

/** Caixa de marcar de um lead. `onde` separa a da tabela da do cartão (ids únicos). */
export function CaixaDoLead({ id, nome, onde }: { id: string; nome: string; onde: "tabela" | "cartao" }) {
  const selecao = useContext(Contexto);
  if (!selecao) return null;
  const idCaixa = `selecionar-${onde}-${id}`;
  return (
    <label htmlFor={idCaixa} className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
      <input
        id={idCaixa}
        type="checkbox"
        checked={selecao.marcados.has(id)}
        onChange={(e) => selecao.alternar(id, e.target.checked)}
        className="h-5 w-5 accent-petroleo-forte"
      />
      <span className="sr-only">Selecionar {nome}</span>
    </label>
  );
}

function BarraDoLote(props: {
  ids: string[];
  opcoes: OpcaoResponsavel[];
  marcados: Set<string>;
  definir: (s: Set<string>) => void;
}) {
  const { ids, opcoes, marcados, definir } = props;
  const router = useRouter();
  const idTodos = useId();
  const idResponsavel = useId();
  const [responsavel, setResponsavel] = useState("");
  const [salvando, setSalvando] = useState(false);
  const contextoAviso = useContext(ContextoAviso);
  if (!contextoAviso) throw new Error("SelecaoEmLote precisa estar dentro de <AvisoDoLote>.");
  const avisar = contextoAviso;

  const n = marcados.size;
  const todos = ids.length > 0 && ids.every((id) => marcados.has(id));

  async function atribuir(evento: React.FormEvent) {
    evento.preventDefault();
    if (n === 0 || n > MAX || responsavel === "") return;
    setSalvando(true);
    const r = await enviar<{ alterados: number; iguais: number }>("/api/leads/responsavel", "POST", {
      leads: [...marcados],
      usuarioId: responsavel === "sem" ? null : responsavel,
    });
    setSalvando(false);
    if (r.ok) {
      const { alterados, iguais } = r.dados;
      const partes = [`${alterados} ${alterados === 1 ? "lead atualizado" : "leads atualizados"}`];
      if (iguais) partes.push(`${iguais} já ${iguais === 1 ? "estava" : "estavam"} assim`);
      definir(new Set());
      avisar({ ok: true, texto: `${partes.join("; ")}.` });
    } else {
      avisar({ ok: false, texto: r.mensagem });
    }
    router.refresh();
  }

  return (
    <form onSubmit={atribuir} aria-label="Atribuir responsável aos leads selecionados" className="mb-4 rounded-2xl border border-borda bg-fundo p-4">
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
        <label htmlFor={idTodos} className="inline-flex min-h-11 cursor-pointer items-center gap-3 font-medium md:mr-auto">
          <input
            id={idTodos}
            type="checkbox"
            checked={todos}
            onChange={(e) => definir(e.target.checked ? new Set(ids) : new Set())}
            className="h-5 w-5 accent-petroleo-forte"
          />
          Selecionar todos desta página
        </label>
        <div className="md:w-72 md:max-w-full">
          <label htmlFor={idResponsavel} className={rotulo}>
            Responsável para os selecionados
          </label>
          <select id={idResponsavel} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className={campo}>
            <option value="">Escolha…</option>
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome} ({ROTULO_PAPEL[o.papel]})
              </option>
            ))}
            <option value="sem">Remover o responsável</option>
          </select>
        </div>
        <button type="submit" disabled={salvando || n === 0 || n > MAX || responsavel === ""} className={botao.primario}>
          {salvando ? "Gravando…" : "Atribuir aos selecionados"}
        </button>
      </div>
      <p className="mt-3 text-sm text-texto-suave" aria-live="polite">
        {n === 0 ? "Nenhum lead selecionado." : `${n} ${n === 1 ? "lead selecionado" : "leads selecionados"}.`} Até {MAX} por vez.
      </p>
    </form>
  );
}
