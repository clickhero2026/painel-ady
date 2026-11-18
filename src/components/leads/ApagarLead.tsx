"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { enviar } from "./enviar";

/**
 * Super admin: apaga o lead de vez. Confirmação em modal (<dialog> nativo:
 * prende o foco, fecha com Esc) que só libera o botão final depois de
 * digitar o e-mail do lead. O servidor confere tudo de novo
 * (src/lib/apagarLead.ts); esconder este botão não protege nada sozinho.
 */
export function ApagarLead({ leadId, nome, email }: { leadId: string; nome: string; email: string }) {
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [digitado, setDigitado] = useState("");
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idTitulo = useId();
  const idCampo = useId();
  const idAjuda = useId();
  const confere = digitado.trim().toLowerCase() === email.trim().toLowerCase();

  function abrir() {
    setDigitado("");
    setErro(null);
    dialogo.current?.showModal();
  }

  function fechar() {
    if (!apagando) dialogo.current?.close();
  }

  async function apagar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!confere || apagando) return;
    setApagando(true);
    setErro(null);
    const r = await enviar(`/api/leads/${leadId}`, "DELETE", { email: digitado });
    if (r.ok) {
      router.replace("/leads?apagado=1");
      router.refresh();
      return;
    }
    setApagando(false);
    setErro(r.mensagem);
  }

  return (
    <>
      <button type="button" onClick={abrir} className={botao.perigo}>
        <Trash2 size={18} aria-hidden="true" />
        Apagar lead
      </button>

      <dialog
        ref={dialogo}
        aria-labelledby={idTitulo}
        onCancel={(e) => {
          if (apagando) e.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-borda bg-fundo p-0 text-texto backdrop:bg-black/50"
      >
        <form onSubmit={apagar} className="p-5 sm:p-6">
          <h2 id={idTitulo} className="text-lg font-semibold">
            Apagar este lead de vez?
          </h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-superficie p-3 text-sm">
            <dt className="text-texto-suave">Nome</dt>
            <dd className="font-medium wrap-anywhere">{nome}</dd>
            <dt className="text-texto-suave">E-mail</dt>
            <dd className="font-medium wrap-anywhere">{email}</dd>
          </dl>
          <p className="mt-3 text-sm">
            A exclusão é <strong className="font-semibold">permanente e irreversível</strong>: o cadastro, o responsável, a
            etapa comercial, o histórico e as anotações deste lead são apagados, e o link de ativação dele deixa de
            funcionar. Não há como desfazer.
          </p>

          <label htmlFor={idCampo} className={`${rotulo} mt-4`}>
            Para confirmar, digite o e-mail do lead
          </label>
          <input
            id={idCampo}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            aria-describedby={idAjuda}
            className={campo}
          />
          <p id={idAjuda} className="mt-1 text-xs text-texto-suave">
            O botão “Apagar de vez” só fica disponível quando o e-mail digitado é igual ao do lead.
          </p>

          {erro && (
            <div className="mt-3">
              <Aviso tipo="erro">{erro}</Aviso>
            </div>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={fechar} disabled={apagando} className={botao.secundario}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!confere || apagando}
              className={botao.perigoFinal}
            >
              <Trash2 size={18} aria-hidden="true" />
              {apagando ? "Apagando…" : "Apagar de vez"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
