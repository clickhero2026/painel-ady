"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Aviso } from "@/components/ui/Aviso";
import { botao } from "@/components/ui/estilos";
import { enviar } from "./enviar";

/** Admin: desfaz a mescla de um cadastro (com confirmação). O cadastro volta a aparecer em listas e contagens. */
export function DesfazerMescla({ duplicadoId, nome }: { duplicadoId: string; nome: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const botaoConfirmar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmando) botaoConfirmar.current?.focus();
  }, [confirmando]);

  async function desfazer() {
    setGravando(true);
    setErro(null);
    const r = await enviar(`/api/leads/${duplicadoId}/mescla`, "DELETE");
    setGravando(false);
    setConfirmando(false);
    if (!r.ok) setErro(r.mensagem);
    router.refresh();
  }

  return (
    <div>
      {confirmando ? (
        <div role="group" aria-label={`Confirmar: desfazer a mescla de ${nome}`} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <p className="text-sm">Desfazer a mescla? “{nome}” volta a ser um lead separado.</p>
          <button ref={botaoConfirmar} type="button" disabled={gravando} onClick={desfazer} className={botao.primario}>
            {gravando ? "Desfazendo…" : "Sim, desfazer"}
          </button>
          <button type="button" disabled={gravando} onClick={() => setConfirmando(false)} className={botao.secundario}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmando(true)} className={botao.secundario}>
          <Undo2 size={18} aria-hidden="true" />
          Desfazer mescla<span className="sr-only"> de {nome}</span>
        </button>
      )}
      {erro && (
        <div className="mt-2">
          <Aviso tipo="erro">{erro}</Aviso>
        </div>
      )}
    </div>
  );
}
