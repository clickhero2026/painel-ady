"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { botao } from "@/components/ui/estilos";

type Estado = "parado" | "baixando" | "pronto" | "erro";

const MENSAGEM: Record<Estado, string> = {
  parado: "",
  baixando: "",
  pronto: "CSV baixado.",
  erro: "Não deu para exportar agora. Tente de novo.",
};

/**
 * Exporta a tabela comparativa com os cortes da tela (`parametros`, a
 * query string). Vai por fetch e não por <form>: com Referrer-Policy
 * no-referrer o navegador manda `Origin: null` num POST de formulário, e a
 * rota só aceita a origem do painel.
 */
export function ExportarCsv({ parametros }: { parametros: string }) {
  const [estado, setEstado] = useState<Estado>("parado");

  async function exportar() {
    setEstado("baixando");
    try {
      const resposta = await fetch("/api/funil/exportar", {
        method: "POST",
        body: new URLSearchParams(parametros),
        cache: "no-store",
      });
      if (!resposta.ok) throw new Error();
      const nome = /filename="([^"]+)"/.exec(resposta.headers.get("Content-Disposition") ?? "")?.[1] ?? "funil.csv";
      const url = URL.createObjectURL(await resposta.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = nome;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setEstado("pronto");
    } catch {
      setEstado("erro");
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button type="button" onClick={exportar} disabled={estado === "baixando"} className={botao.secundario}>
        <Download size={18} aria-hidden="true" />
        {estado === "baixando" ? "Exportando…" : "Exportar CSV"}
      </button>
      <p role="status" className={`text-sm ${estado === "erro" ? "text-erro" : "text-sucesso"}`}>
        {MENSAGEM[estado]}
      </p>
    </div>
  );
}
