import { CircleAlert, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { ItemChecklist } from "@/lib/respostas";

const ESTILO = {
  verde: { icone: CircleCheck, rotulo: "Pronto", cor: "border-sucesso bg-sucesso-suave text-sucesso" },
  amarelo: { icone: CircleAlert, rotulo: "Atenção", cor: "border-atencao bg-atencao-suave text-atencao" },
  vermelho: { icone: CircleX, rotulo: "Bloqueia", cor: "border-erro bg-erro-suave text-erro" },
  nenhum: { icone: CircleDashed, rotulo: "Sem resposta", cor: "border-borda-campo bg-superficie text-texto-suave" },
} as const;

/** Prontidão para o onboarding: cor + ícone + palavra (nunca só a cor). */
export function Checklist({ itens }: { itens: ItemChecklist[] }) {
  return (
    <ul className="space-y-3">
      {itens.map((item) => {
        const estilo = ESTILO[item.cor ?? "nenhum"];
        const Icone = estilo.icone;
        const rotulo = !item.cor && item.resposta ? "Não classificado" : estilo.rotulo;
        return (
          <li key={item.titulo} className="flex gap-3">
            <span
              className={`inline-flex h-fit w-36 shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${estilo.cor}`}
            >
              <Icone size={14} aria-hidden="true" />
              {rotulo}
            </span>
            <div className="min-w-0">
              <p className="font-medium">{item.titulo}</p>
              <p className="text-sm text-texto-suave wrap-anywhere">
                {item.resposta ? item.resposta.texto : "Não respondeu"}
                {item.resposta?.semMapa && " (resposta sem texto cadastrado)"}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
