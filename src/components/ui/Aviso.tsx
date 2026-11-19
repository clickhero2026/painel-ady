import type { ReactNode } from "react";

export type TipoAviso = "erro" | "sucesso" | "info";

/** Classes da caixa (para quem precisa de outro papel ARIA, como uma região viva já montada). */
export function classeDoAviso(tipo: TipoAviso): string {
  const cores = {
    erro: "border-erro bg-erro-suave text-erro",
    sucesso: "border-sucesso bg-sucesso-suave text-sucesso",
    info: "border-petroleo bg-petroleo-suave text-petroleo-escuro",
  }[tipo];
  return `rounded-lg border-l-4 px-4 py-3 text-sm ${cores}`;
}

/** Caixa de mensagem. Erros são anunciados pelo leitor de tela na hora. */
export function Aviso({ tipo, children }: { tipo: TipoAviso; children: ReactNode }) {
  return (
    <div role={tipo === "erro" ? "alert" : "status"} className={classeDoAviso(tipo)}>
      {children}
    </div>
  );
}
