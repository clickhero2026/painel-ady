import { rotuloEtapa } from "@/lib/etapas";

const CORES: Record<string, string> = {
  inscrito: "bg-superficie text-texto border-borda-campo",
  ativacao_preenchida: "bg-petroleo-suave text-petroleo-escuro border-petroleo",
  agendado: "bg-sucesso-suave text-sucesso border-sucesso",
  realizado: "bg-sucesso text-white border-sucesso",
  nao_compareceu: "bg-erro-suave text-erro border-erro",
};

/** Etapa do lead em texto (a cor só reforça; nunca é a única informação). */
export function EtiquetaEtapa({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${CORES[status] ?? CORES.inscrito}`}
    >
      {rotuloEtapa(status)}
    </span>
  );
}
