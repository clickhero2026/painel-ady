import { rotuloEtapaComercial } from "@/config/pipeline";

const CORES: Record<string, string> = {
  nao_contatado: "bg-superficie text-texto border-borda-campo",
  tentativa_contato: "bg-petroleo-suave text-petroleo-escuro border-petroleo",
  reuniao_marcada: "bg-petroleo-suave text-petroleo-escuro border-petroleo",
  negociacao: "bg-atencao-suave text-atencao border-atencao",
  negocio_provavel: "bg-atencao-suave text-atencao border-atencao",
  negocio_fechado: "bg-sucesso text-white border-sucesso",
  negocio_perdido: "bg-erro-suave text-erro border-erro",
};

/** Etapa comercial em texto (a cor só reforça; nunca é a única informação). */
export function EtiquetaComercial({ etapa }: { etapa: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${CORES[etapa] ?? CORES.nao_contatado}`}
    >
      {rotuloEtapaComercial(etapa)}
    </span>
  );
}
