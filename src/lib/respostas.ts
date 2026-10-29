import {
  ACAO_DESEJADA,
  ACESSO_REDES,
  ARQUIVO_LOGO,
  CARTAO_PAGAMENTO,
  CONTA_ANUNCIOS,
  EXPERIENCIA_ANUNCIOS,
  REUNIAO_COMPUTADOR,
} from "./teste7dOptions";
import { PRONTIDAO, type Cor } from "@/config/prontidao";

/**
 * Texto humano das respostas da ativação. Chave fora do mapa aparece crua
 * (e marcada), sem quebrar a tela.
 */

export const MAPAS_DE_RESPOSTA = {
  acao_desejada: ACAO_DESEJADA,
  experiencia_anuncios: EXPERIENCIA_ANUNCIOS,
  acesso_redes: ACESSO_REDES,
  conta_anuncios: CONTA_ANUNCIOS,
  cartao_pagamento: CARTAO_PAGAMENTO,
  arquivo_logo: ARQUIVO_LOGO,
  reuniao_computador: REUNIAO_COMPUTADOR,
} as const satisfies Record<string, Record<string, string>>;

export type CampoDeResposta = keyof typeof MAPAS_DE_RESPOSTA;

export interface Resposta {
  texto: string;
  /** true quando a chave gravada não existe no mapa (mostrada crua). */
  semMapa: boolean;
}

export function textoDaResposta(campo: CampoDeResposta, chave: string | null): Resposta | null {
  if (!chave) return null;
  const texto = (MAPAS_DE_RESPOSTA[campo] as Record<string, string>)[chave];
  return texto ? { texto, semMapa: false } : { texto: chave, semMapa: true };
}

/** Chaves (de linhas de cadastro) que não existem no mapa: [campo, chave]. */
export function chavesSemMapa(linhas: Partial<Record<CampoDeResposta, string | null>>[]): [CampoDeResposta, string][] {
  const faltando = new Set<string>();
  for (const linha of linhas) {
    for (const campo of Object.keys(MAPAS_DE_RESPOSTA) as CampoDeResposta[]) {
      const chave = linha[campo];
      if (chave && textoDaResposta(campo, chave)?.semMapa) faltando.add(`${campo}\u0000${chave}`);
    }
  }
  return [...faltando].map((s) => s.split("\u0000") as [CampoDeResposta, string]);
}

export interface ItemChecklist {
  titulo: string;
  resposta: Resposta | null;
  /** null = sem resposta ou chave sem regra ("não classificado"). */
  cor: Cor | null;
}

export function checklistDeProntidao(lead: Partial<Record<CampoDeResposta, string | null>>): ItemChecklist[] {
  return PRONTIDAO.map((item) => {
    const chave = lead[item.campo] ?? null;
    return {
      titulo: item.titulo,
      resposta: textoDaResposta(item.campo, chave),
      cor: chave ? (item.cores[chave] ?? null) : null,
    };
  });
}
