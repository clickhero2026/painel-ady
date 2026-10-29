"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarX, Undo2 } from "lucide-react";
import { Aviso } from "@/components/ui/Aviso";
import { botao } from "@/components/ui/estilos";
import { formatarDataHora } from "@/lib/formatos";
import { enviar } from "./enviar";

type Desfecho = "realizado" | "nao_compareceu";

const ROTULO: Record<Desfecho, string> = { realizado: "Reunião realizada", nao_compareceu: "Não compareceu" };
const CONFIRMAR: Record<Desfecho, string> = {
  realizado: "Marcar a reunião como realizada? A data e a hora de agora ficam gravadas.",
  nao_compareceu: "Marcar que a pessoa não compareceu à reunião?",
};

/**
 * Suporte e admin: desfecho da reunião de um lead agendado, com
 * confirmação antes de gravar, e o "desfazer" nas 24 horas seguintes. O
 * servidor confere tudo de novo (status, prazo e papel).
 */
export function MarcarReuniao(props: {
  leadId: string;
  status: string;
  desfazivel: { desfecho: Desfecho; ate: string } | null;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState<Desfecho | null>(null);
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const botaoConfirmar = useRef<HTMLButtonElement>(null);
  const botaoOrigem = useRef<Record<Desfecho, HTMLButtonElement | null>>({ realizado: null, nao_compareceu: null });

  useEffect(() => {
    if (confirmando) botaoConfirmar.current?.focus();
  }, [confirmando]);

  function cancelar() {
    const de = confirmando;
    setConfirmando(null);
    if (de) requestAnimationFrame(() => botaoOrigem.current[de]?.focus());
  }

  async function gravar(desfecho: Desfecho) {
    setGravando(true);
    setResultado(null);
    const r = await enviar(`/api/leads/${props.leadId}/reuniao`, "POST", { desfecho });
    setGravando(false);
    setConfirmando(null);
    setResultado(r.ok ? { ok: true, texto: `Marcado: ${ROTULO[desfecho]}.` } : { ok: false, texto: r.mensagem });
    router.refresh();
  }

  async function desfazer() {
    setGravando(true);
    setResultado(null);
    const r = await enviar(`/api/leads/${props.leadId}/reuniao`, "DELETE");
    setGravando(false);
    setResultado(r.ok ? { ok: true, texto: "Marcação desfeita: o lead voltou para Agendado." } : { ok: false, texto: r.mensagem });
    router.refresh();
  }

  return (
    <div>
      {props.status === "agendado" &&
        (confirmando ? (
          <div role="group" aria-labelledby="confirmar-reuniao" className="rounded-lg border border-borda-campo bg-superficie p-4">
            <p id="confirmar-reuniao" className="font-medium">
              {CONFIRMAR[confirmando]}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button ref={botaoConfirmar} type="button" disabled={gravando} onClick={() => gravar(confirmando)} className={botao.primario}>
                {gravando ? "Gravando…" : `Sim, marcar “${ROTULO[confirmando]}”`}
              </button>
              <button type="button" disabled={gravando} onClick={cancelar} className={botao.secundario}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              ref={(b) => {
                botaoOrigem.current.realizado = b;
              }}
              type="button"
              onClick={() => setConfirmando("realizado")}
              className={botao.primario}
            >
              <CalendarCheck size={18} aria-hidden="true" />
              Reunião realizada
            </button>
            <button
              ref={(b) => {
                botaoOrigem.current.nao_compareceu = b;
              }}
              type="button"
              onClick={() => setConfirmando("nao_compareceu")}
              className={botao.secundario}
            >
              <CalendarX size={18} aria-hidden="true" />
              Não compareceu
            </button>
          </div>
        ))}

      {props.desfazivel && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <p className="text-sm">
            Marcado como “{ROTULO[props.desfazivel.desfecho]}”. Dá para desfazer até {formatarDataHora(props.desfazivel.ate)}.
          </p>
          <button type="button" disabled={gravando} onClick={desfazer} className={`${botao.secundario} shrink-0`}>
            <Undo2 size={18} aria-hidden="true" />
            {gravando ? "Desfazendo…" : "Desfazer marcação"}
          </button>
        </div>
      )}

      {resultado && (
        <div className="mt-3">
          <Aviso tipo={resultado.ok ? "sucesso" : "erro"}>{resultado.texto}</Aviso>
        </div>
      )}
    </div>
  );
}
