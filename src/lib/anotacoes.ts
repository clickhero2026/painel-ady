import { MAX_ANOTACAO } from "@/config/pipeline";
import { registrarAuditoria } from "./auditoria";
import { pool, transacao, type Consulta } from "./db";
import { leadsVisiveis, ORIGEM, UUID, type QuemConsulta } from "./leads";
import type { Papel } from "./papeis";
import { Parametros } from "./sql";

/**
 * Anotações internas da equipe sobre um lead (painel_lead_anotacao). Não
 * confundir com `observacoes`, que o próprio lead escreve na ativação.
 *
 * - Escrevem e leem: admin, suporte e vendas (vendas só nos seus leads, via
 *   leadsVisiveis). "leitura" não vê lead individual.
 * - Só INSERT: não se edita nem se apaga (o painel_app nem tem permissão).
 * - O texto é sempre mostrado como texto puro (React escapa; quebras de
 *   linha preservadas por CSS). A auditoria registra a ação, nunca o texto.
 */

export function podeAnotar(papel: Papel): boolean {
  return papel === "admin" || papel === "suporte" || papel === "vendas";
}

export class ErroAnotacao extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "nao_encontrado" | "invalido" | "sem_permissao",
  ) {
    super(mensagem);
  }
}

export interface Anotacao {
  id: string;
  lead_id: string;
  texto: string;
  autor: string | null;
  criado_em: Date;
}

/** Texto final de uma anotação (pontas sem espaço; quebras de linha normalizadas). Lança ErroAnotacao. */
export function validarTexto(texto: unknown): string {
  if (typeof texto !== "string") throw new ErroAnotacao("Escreva a anotação.", "invalido");
  const limpo = texto.replace(/\r\n?/g, "\n").trim();
  if (!limpo) throw new ErroAnotacao("Escreva a anotação.", "invalido");
  if (limpo.length > MAX_ANOTACAO) {
    throw new ErroAnotacao(`A anotação pode ter até ${MAX_ANOTACAO} caracteres (tem ${limpo.length}).`, "invalido");
  }
  return limpo;
}

/** Grava uma anotação num lead visível para `usuario`. Lança ErroAnotacao. */
export async function anotar(usuario: QuemConsulta, leadId: string, texto: unknown): Promise<Anotacao> {
  if (!podeAnotar(usuario.papel)) throw new ErroAnotacao("Você não tem permissão para anotar.", "sem_permissao");
  if (!UUID.test(leadId)) throw new ErroAnotacao("Lead não encontrado.", "nao_encontrado");
  const limpo = validarTexto(texto);

  return transacao(async (db) => {
    const p = new Parametros();
    const visivel = await db.query(`SELECT 1 FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, p)} AND i.id = ${p.add(leadId)}`, p.valores);
    if (visivel.rows.length === 0) throw new ErroAnotacao("Lead não encontrado.", "nao_encontrado");

    return gravarAnotacao(db, usuario, leadId, limpo);
  });
}

/**
 * INSERT da anotação e auditoria `anotar_lead` (sem o texto), na transação
 * de quem chama. `limpo` já passou por validarTexto e quem chama já conferiu
 * que o lead é visível para `usuario`. Usada por `anotar` e pelo cadastro
 * manual de lead (anotação inicial).
 */
export async function gravarAnotacao(db: Consulta, usuario: QuemConsulta, leadId: string, limpo: string): Promise<Anotacao> {
  const { rows } = await db.query<Anotacao>(
    `INSERT INTO painel_lead_anotacao (lead_id, usuario_id, texto) VALUES ($1, $2, $3)
     RETURNING id::text AS id, lead_id, texto, criado_em,
               (SELECT coalesce(nome, email) FROM painel_usuarios WHERE id = $2) AS autor`,
    [leadId, usuario.id, limpo],
  );
  await registrarAuditoria(
    { usuarioId: usuario.id, acao: "anotar_lead", leadId, detalhe: { anotacao_id: rows[0].id, tamanho: limpo.length } },
    db,
  );
  return rows[0];
}

/**
 * Anotações dos leads `ids`, da mais recente para a mais antiga. Quem chama
 * já conferiu que pode ver esses leads (a ficha passa o lead e os
 * cadastros mesclados nele).
 */
export async function anotacoesDe(ids: string[]): Promise<Anotacao[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool().query<Anotacao>(
    `SELECT a.id::text AS id, a.lead_id, a.texto, coalesce(u.nome, u.email) AS autor, a.criado_em
       FROM painel_lead_anotacao a
       LEFT JOIN painel_usuarios u ON u.id = a.usuario_id
      WHERE a.lead_id = ANY($1::uuid[])
      ORDER BY a.criado_em DESC, a.id DESC`,
    [ids],
  );
  return rows;
}

/** Anotações de um lead visível (API), com as dos cadastros mesclados nele; null se o lead não é visível. */
export async function anotacoesDoLead(usuario: QuemConsulta, leadId: string): Promise<Anotacao[] | null> {
  if (!podeAnotar(usuario.papel) || !UUID.test(leadId)) return null;
  const p = new Parametros();
  const { rows } = await pool().query<{ ids: string[] }>(
    `SELECT array_prepend(i.id, coalesce((SELECT array_agg(m.duplicado_id) FROM painel_lead_mescla m WHERE m.principal_id = i.id), '{}')) AS ids
       FROM ${ORIGEM}
      WHERE ${leadsVisiveis(usuario, p)} AND i.id = ${p.add(leadId)}`,
    p.valores,
  );
  if (!rows[0]) return null;
  return anotacoesDe(rows[0].ids);
}
