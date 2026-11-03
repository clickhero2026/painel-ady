"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { MAX_ANOTACAO } from "@/config/pipeline";
import { enviar } from "./enviar";

/** Campo de nova anotação interna (não edita nem apaga as antigas). */
export function NovaAnotacao({ leadId }: { leadId: string }) {
  const router = useRouter();
  const id = useId();
  const [texto, setTexto] = useState("");
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const restam = MAX_ANOTACAO - texto.length;

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!texto.trim()) {
      setResultado({ ok: false, texto: "Escreva a anotação." });
      return;
    }
    setGravando(true);
    setResultado(null);
    const r = await enviar(`/api/leads/${leadId}/anotacoes`, "POST", { texto });
    setGravando(false);
    if (r.ok) {
      setTexto("");
      setResultado({ ok: true, texto: "Anotação salva." });
    } else {
      setResultado({ ok: false, texto: r.mensagem });
    }
    router.refresh();
  }

  return (
    <form onSubmit={salvar} noValidate>
      <label htmlFor={id} className={rotulo}>
        Nova anotação interna
      </label>
      <textarea
        id={id}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={MAX_ANOTACAO}
        rows={4}
        aria-describedby={`${id}-ajuda`}
        className={`${campo} py-2`}
      />
      <p id={`${id}-ajuda`} className="mt-1 text-sm text-texto-suave">
        Só a equipe vê. Depois de salva, a anotação não pode ser editada nem apagada. {restam}{" "}
        {restam === 1 ? "caractere restante" : "caracteres restantes"}.
      </p>
      <button type="submit" disabled={gravando} className={`${botao.primario} mt-3`}>
        {gravando ? "Salvando…" : "Salvar anotação"}
      </button>
      {resultado && (
        <div className="mt-3">
          <Aviso tipo={resultado.ok ? "sucesso" : "erro"}>{resultado.texto}</Aviso>
        </div>
      )}
    </form>
  );
}
