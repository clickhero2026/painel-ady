/**
 * Checklist de prontidão para o onboarding (ficha do lead). Fácil de editar:
 * cada item diz qual resposta da ativação ele lê e a cor de cada opção.
 * Regras iniciais da seção 6 do claude/painel-interno-ady.md — o Denilson
 * valida. As chaves são as de src/lib/teste7dOptions.ts.
 *
 *   verde    = pronto
 *   amarelo  = dá pra seguir, mas precisa de atenção na reunião
 *   vermelho = bloqueia o onboarding até resolver
 *
 * Resposta em branco ou chave que não está aqui aparece como "sem resposta"
 * ou "não classificado", nunca como verde.
 */
import {
  ACESSO_REDES,
  ARQUIVO_LOGO,
  CARTAO_PAGAMENTO,
  CONTA_ANUNCIOS,
  REUNIAO_COMPUTADOR,
} from "@/lib/teste7dOptions";

export type Cor = "verde" | "amarelo" | "vermelho";

export interface ItemProntidao {
  campo: "acesso_redes" | "conta_anuncios" | "cartao_pagamento" | "arquivo_logo" | "reuniao_computador";
  titulo: string;
  opcoes: Record<string, string>;
  cores: Record<string, Cor>;
}

export const PRONTIDAO: readonly ItemProntidao[] = [
  {
    campo: "acesso_redes",
    titulo: "Redes sociais",
    opcoes: ACESSO_REDES,
    cores: {
      ambos_com_login: "verde",
      so_instagram: "amarelo",
      so_facebook: "amarelo",
      senha_com_outro: "amarelo",
      nao_tem: "vermelho",
    },
  },
  {
    campo: "conta_anuncios",
    titulo: "Conta de anúncios",
    opcoes: CONTA_ANUNCIOS,
    cores: { sim: "verde", nao: "amarelo", nao_sei: "amarelo" },
  },
  {
    campo: "cartao_pagamento",
    titulo: "Cartão para os anúncios",
    opcoes: CARTAO_PAGAMENTO,
    cores: { sim_meu: "verde", sim_outra_pessoa: "amarelo", nao_tem: "vermelho" },
  },
  {
    campo: "arquivo_logo",
    titulo: "Logo",
    opcoes: ARQUIVO_LOGO,
    cores: { sim: "verde", so_print: "amarelo", nao_tem: "amarelo" },
  },
  {
    campo: "reuniao_computador",
    titulo: "Computador na reunião",
    opcoes: REUNIAO_COMPUTADOR,
    cores: { sim: "verde", com_ajuda: "amarelo", so_celular: "vermelho" },
  },
];
