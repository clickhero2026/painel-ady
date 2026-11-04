"use client";

import { useState } from "react";
import { Link2, MessageSquareText } from "lucide-react";
import { botao } from "@/components/ui/estilos";

type Estado = "parado" | "copiando" | "copiado" | "erro";
type Formato = "link" | "mensagem";

const TEXTOS: Record<Formato, { botao: string; copiado: string; erro: string }> = {
  link: {
    botao: "Copiar link de ativação",
    copiado: "Link copiado. Ele dá acesso ao cadastro da pessoa: mande só para ela.",
    erro: "Não deu para copiar o link. Tente de novo.",
  },
  mensagem: {
    botao: "Copiar mensagem com o link",
    copiado: "Mensagem copiada. O link dentro dela dá acesso ao cadastro da pessoa: mande só para ela.",
    erro: "Não deu para copiar a mensagem. Tente de novo.",
  },
};

/**
 * Pede o link (ou a mensagem pronta com o link, montada no servidor) só no
 * clique e vai direto para a área de transferência: o link (e o token
 * dentro dele) nunca é exibido nem fica guardado no estado da página. As
 * duas formas gravam `copiar_link` na auditoria.
 */
export function CopiarLinkAtivacao({ leadId, formato = "link" }: { leadId: string; formato?: Formato }) {
  const [estado, setEstado] = useState<Estado>("parado");
  const textos = TEXTOS[formato];
  const Icone = formato === "link" ? Link2 : MessageSquareText;

  async function copiar() {
    setEstado("copiando");
    try {
      const url = `/api/leads/${leadId}/link-ativacao${formato === "mensagem" ? "?formato=mensagem" : ""}`;
      const resposta = await fetch(url, { method: "POST", cache: "no-store" });
      if (!resposta.ok) throw new Error();
      const dados = (await resposta.json()) as { link?: string; mensagem?: string };
      const texto = formato === "mensagem" ? dados.mensagem : dados.link;
      if (!texto) throw new Error();
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("erro");
    }
  }

  return (
    <div>
      <button type="button" onClick={copiar} disabled={estado === "copiando"} className={botao.secundario}>
        <Icone size={18} aria-hidden="true" />
        {estado === "copiando" ? "Copiando…" : textos.botao}
      </button>
      <p role="status" className={`mt-2 text-sm ${estado === "erro" ? "text-erro" : "text-sucesso"}`}>
        {estado === "copiado" ? textos.copiado : estado === "erro" ? textos.erro : ""}
      </p>
    </div>
  );
}
