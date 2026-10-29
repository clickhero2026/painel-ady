"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { ROTULO_PAPEL } from "@/lib/papeis";
import { enviar } from "./enviar";

export interface OpcaoResponsavel {
  id: string;
  nome: string;
  papel: "admin" | "vendas";
}

/** Admin: atribui, troca ou remove o responsável do lead (na ficha). */
export function AtribuirResponsavel({ leadId, atual, opcoes }: { leadId: string; atual: string | null; opcoes: OpcaoResponsavel[] }) {
  const router = useRouter();
  const id = useId();
  const [valor, setValor] = useState(atual ?? "");
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setResultado(null);
    const r = await enviar<{ alterados: number }>(`/api/leads/${leadId}/responsavel`, "PUT", { usuarioId: valor || null });
    setSalvando(false);
    if (r.ok) {
      setResultado({
        ok: true,
        texto: r.dados.alterados === 0 ? "Nada mudou: o lead já estava assim." : valor ? "Responsável salvo." : "Responsável removido.",
      });
    } else {
      setResultado({ ok: false, texto: r.mensagem });
    }
    router.refresh();
  }

  return (
    <form onSubmit={salvar} aria-label="Responsável pelo lead">
      <label htmlFor={id} className={rotulo}>
        Responsável
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <select id={id} value={valor} onChange={(e) => setValor(e.target.value)} className={`${campo} sm:w-auto sm:min-w-0 sm:flex-1`}>
          <option value="">Sem responsável</option>
          {opcoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome} ({ROTULO_PAPEL[o.papel]})
            </option>
          ))}
        </select>
        <button type="submit" disabled={salvando} className={`${botao.primario} shrink-0`}>
          {salvando ? "Salvando…" : "Salvar responsável"}
        </button>
      </div>
      <p className="mt-1 text-sm text-texto-suave">Só usuários ativos com papel Vendas ou Admin podem ser responsáveis.</p>
      {resultado && (
        <div className="mt-3">
          <Aviso tipo={resultado.ok ? "sucesso" : "erro"}>{resultado.texto}</Aviso>
        </div>
      )}
    </form>
  );
}
