"use client";

import { useActionState, useEffect, useRef } from "react";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { PAPEIS, ROTULO_PAPEL } from "@/lib/papeis";
import { adicionarUsuario } from "./acoes";

export function FormularioNovoUsuario() {
  const [resultado, enviar, enviando] = useActionState(adicionarUsuario, null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resultado?.ok) form.current?.reset();
  }, [resultado]);

  return (
    <form ref={form} action={enviar} className="mt-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_0.8fr_auto] md:items-end">
        <div>
          <label htmlFor="novo-email" className={rotulo}>
            E-mail
          </label>
          <input id="novo-email" name="email" type="email" required autoComplete="off" spellCheck={false} className={campo} />
        </div>
        <div>
          <label htmlFor="novo-nome" className={rotulo}>
            Nome <span className="font-normal text-texto-suave">(opcional)</span>
          </label>
          <input id="novo-nome" name="nome" type="text" maxLength={120} autoComplete="off" className={campo} />
        </div>
        <div>
          <label htmlFor="novo-papel" className={rotulo}>
            Papel
          </label>
          <select id="novo-papel" name="papel" required defaultValue="leitura" className={campo}>
            {PAPEIS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PAPEL[p]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={enviando} className={botao.primario}>
          {enviando ? "Adicionando…" : "Adicionar"}
        </button>
      </div>
      {resultado && <Aviso tipo={resultado.ok ? "sucesso" : "erro"}>{resultado.mensagem}</Aviso>}
    </form>
  );
}
