"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { botao } from "@/components/ui/estilos";

type Estado = "parado" | "copiando" | "copiado" | "erro";

const MENSAGEM: Record<Estado, string> = {
  parado: "",
  copiando: "",
  copiado: "Link copiado. Ele dá acesso ao cadastro da pessoa: mande só para ela.",
  erro: "Não deu para copiar o link. Tente de novo.",
};

/**
 * Pede o link ao servidor só no clique e vai direto para a área de
 * transferência: o link (e o token dentro dele) nunca é exibido nem fica
 * guardado no estado da página.
 */
export function CopiarLinkAtivacao({ leadId }: { leadId: string }) {
  const [estado, setEstado] = useState<Estado>("parado");

  async function copiar() {
    setEstado("copiando");
    try {
      const resposta = await fetch(`/api/leads/${leadId}/link-ativacao`, { method: "POST", cache: "no-store" });
      if (!resposta.ok) throw new Error();
      const { link } = (await resposta.json()) as { link: string };
      await navigator.clipboard.writeText(link);
      setEstado("copiado");
    } catch {
      setEstado("erro");
    }
  }

  return (
    <div>
      <button type="button" onClick={copiar} disabled={estado === "copiando"} className={botao.secundario}>
        <Link2 size={18} aria-hidden="true" />
        {estado === "copiando" ? "Copiando…" : "Copiar link de ativação"}
      </button>
      <p role="status" className={`mt-2 text-sm ${estado === "erro" ? "text-erro" : "text-sucesso"}`}>
        {MENSAGEM[estado]}
      </p>
    </div>
  );
}
