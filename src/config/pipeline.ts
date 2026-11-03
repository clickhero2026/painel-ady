/**
 * Pipeline comercial: etapas e motivos de perda. Arquivo puro (sem banco),
 * usado no servidor e na tela.
 *
 * A etapa comercial é INDEPENDENTE da situação do teste (coluna `status`
 * de teste7d_inscricoes, que o site preenche): mudar a etapa nunca escreve
 * em `status`, e vice-versa.
 *
 * - Etapas: a ordem abaixo é a do quadro e a do funil comercial. As chaves
 *   têm CHECK no banco (db/migrations/20261103_painel_pipeline.sql); mudar
 *   ou acrescentar etapa exige migração. Os rótulos podem mudar à vontade.
 * - Motivos de perda: lista editável (chave gravada no banco + texto da
 *   tela). Um motivo removido daqui continua aparecendo pela chave nos
 *   leads antigos. "exigeTexto": a pessoa precisa escrever o motivo.
 */

export const ETAPAS_COMERCIAIS = [
  "nao_contatado",
  "tentativa_contato",
  "reuniao_marcada",
  "negociacao",
  "negocio_provavel",
  "negocio_fechado",
  "negocio_perdido",
] as const;
export type EtapaComercial = (typeof ETAPAS_COMERCIAIS)[number];

export const ROTULO_ETAPA_COMERCIAL: Record<EtapaComercial, string> = {
  nao_contatado: "Não contatado",
  tentativa_contato: "Tentativa de contato",
  reuniao_marcada: "Reunião marcada",
  negociacao: "Negociação",
  negocio_provavel: "Negócio provável",
  negocio_fechado: "Negócio fechado",
  negocio_perdido: "Negócio perdido",
};

/** Etapa de quem ainda não tem registro (desde o cadastro). */
export const ETAPA_INICIAL: EtapaComercial = "nao_contatado";
export const ETAPA_PERDIDO: EtapaComercial = "negocio_perdido";
export const ETAPA_FECHADO: EtapaComercial = "negocio_fechado";

/**
 * Etapas "em linha" (de não contatado até fechado), na ordem. É a base do
 * "chegou a pelo menos esta etapa" do funil comercial: quem pulou etapas
 * conta como tendo passado pelas anteriores. Perdido fica fora da linha.
 */
export const LINHA_DO_FUNIL = ETAPAS_COMERCIAIS.filter((e) => e !== ETAPA_PERDIDO) as Exclude<
  EtapaComercial,
  "negocio_perdido"
>[];

/** Colunas que, por padrão, mostram só os últimos N dias (pela data de entrada na etapa). */
export const ETAPAS_FINAIS: readonly EtapaComercial[] = [ETAPA_FECHADO, ETAPA_PERDIDO];
export const DIAS_PADRAO_FINAIS = 30;

/** Cartões por coluna no quadro (e o passo do "ver mais"). */
export const CARTOES_POR_COLUNA = 50;

export interface MotivoDePerda {
  chave: string;
  rotulo: string;
  exigeTexto: boolean;
}

export const MOTIVOS_DE_PERDA: readonly MotivoDePerda[] = [
  { chave: "sem_interesse", rotulo: "Sem interesse", exigeTexto: false },
  { chave: "sem_orcamento", rotulo: "Sem orçamento ou preço", exigeTexto: false },
  { chave: "sumiu", rotulo: "Sumiu, sem resposta", exigeTexto: false },
  { chave: "outra_solucao", rotulo: "Escolheu outra solução", exigeTexto: false },
  { chave: "sem_perfil", rotulo: "Não tem o perfil", exigeTexto: false },
  { chave: "momento_errado", rotulo: "Momento errado", exigeTexto: false },
  { chave: "outro", rotulo: "Outro", exigeTexto: true },
];

/** Tamanho máximo do texto do motivo de perda (também no CHECK do banco). */
export const MAX_TEXTO_MOTIVO = 500;
/** Tamanho máximo de uma anotação interna (também no CHECK do banco). */
export const MAX_ANOTACAO = 2000;

export function ehEtapaComercial(valor: unknown): valor is EtapaComercial {
  return typeof valor === "string" && (ETAPAS_COMERCIAIS as readonly string[]).includes(valor);
}

/** Rótulo da etapa; chave desconhecida aparece crua. */
export function rotuloEtapaComercial(etapa: string): string {
  return (ROTULO_ETAPA_COMERCIAL as Record<string, string>)[etapa] ?? etapa;
}

/** Texto do motivo; chave fora da lista (removida daqui) aparece crua. */
export function rotuloMotivo(chave: string | null): string | null {
  if (!chave) return null;
  return MOTIVOS_DE_PERDA.find((m) => m.chave === chave)?.rotulo ?? chave;
}

export function motivoDePerda(chave: string): MotivoDePerda | undefined {
  return MOTIVOS_DE_PERDA.find((m) => m.chave === chave);
}

/** Posição na ordem das etapas (0 = não contatado). */
export function posicaoDaEtapa(etapa: EtapaComercial): number {
  return ETAPAS_COMERCIAIS.indexOf(etapa);
}
