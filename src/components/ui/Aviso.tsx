import type { ReactNode } from "react";

/** Caixa de mensagem. Erros são anunciados pelo leitor de tela na hora. */
export function Aviso({ tipo, children }: { tipo: "erro" | "sucesso" | "info"; children: ReactNode }) {
  const cores = {
    erro: "border-erro bg-erro-suave text-erro",
    sucesso: "border-sucesso bg-sucesso-suave text-sucesso",
    info: "border-petroleo bg-petroleo-suave text-petroleo-escuro",
  }[tipo];
  return (
    <div role={tipo === "erro" ? "alert" : "status"} className={`rounded-lg border-l-4 px-4 py-3 text-sm ${cores}`}>
      {children}
    </div>
  );
}
