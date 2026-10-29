/** Etapas do lead (coluna `status` de teste7d_inscricoes) e seus nomes na tela. */

export const ETAPAS = ["inscrito", "ativacao_preenchida", "agendado", "realizado", "nao_compareceu"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ROTULO_ETAPA: Record<Etapa, string> = {
  inscrito: "Cadastro",
  ativacao_preenchida: "Ativação preenchida",
  agendado: "Agendado",
  realizado: "Reunião realizada",
  nao_compareceu: "Não compareceu",
};

/** Nome da etapa; um valor que o painel não conhece aparece cru. */
export function rotuloEtapa(status: string): string {
  return (ROTULO_ETAPA as Record<string, string>)[status] ?? status;
}

/** Etapas em que o cadastro ainda não chegou ao agendamento. */
export const ETAPAS_PARADAS: readonly Etapa[] = ["inscrito", "ativacao_preenchida"];
