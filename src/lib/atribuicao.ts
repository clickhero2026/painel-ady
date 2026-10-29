import { registrarAuditoria } from "./auditoria";
import { pool, transacao } from "./db";

/**
 * Atribuição de responsável por lead (só admin; quem chama já checou o
 * papel). Grava em painel_lead_responsavel e, por lead que mudou, uma linha
 * `atribuir_lead` na auditoria com o responsável anterior e o novo — tudo
 * na mesma transação.
 *
 * - Responsável: usuário ativo com papel vendas ou admin (relido e travado
 *   na transação, para não valer alguém desativado no meio do caminho).
 * - Idempotente: lead que já está com o mesmo responsável não muda, não
 *   gera auditoria nem erro. Remover de quem já está sem responsável idem.
 * - Duas atribuições ao mesmo tempo esperam uma pela outra (trava de
 *   transação), então o "anterior" da auditoria é sempre o verdadeiro.
 * - O vendedor passa a ver (ou deixa de ver) o lead assim que a transação
 *   termina: a visibilidade sai desta tabela a cada consulta.
 */

export class ErroAtribuicao extends Error {}
/** Algum dos leads não existe (nada foi gravado). */
export class LeadNaoEncontrado extends ErroAtribuicao {}

export const MAX_LEADS_POR_LOTE = 100;

/** Chave da trava de transação das atribuições (pg_advisory_xact_lock). */
const TRAVA_ATRIBUICAO = 7_310_001;

export interface Responsavel {
  id: string;
  nome: string;
  papel: "admin" | "vendas";
}

/** Quem pode ser responsável: ativos com papel vendas ou admin. */
export async function responsaveisPossiveis(): Promise<Responsavel[]> {
  const { rows } = await pool().query<Responsavel>(
    `SELECT id, coalesce(nome, email) AS nome, papel FROM painel_usuarios
      WHERE ativo AND papel IN ('admin', 'vendas')
      ORDER BY lower(coalesce(nome, email))`,
  );
  return rows;
}

export interface ResultadoAtribuicao {
  /** Leads que mudaram de responsável. */
  alterados: number;
  /** Leads que já estavam com esse responsável (nada feito). */
  iguais: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Atribui `leadIds` a `usuarioId` (null = sem responsável). Lança
 * ErroAtribuicao com mensagem pronta para a tela, ou LeadNaoEncontrado.
 */
export async function atribuir(leadIds: string[], usuarioId: string | null, porId: string): Promise<ResultadoAtribuicao> {
  const ids = [...new Set(leadIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) throw new ErroAtribuicao("Escolha pelo menos um lead.");
  if (ids.length > MAX_LEADS_POR_LOTE) throw new ErroAtribuicao(`No máximo ${MAX_LEADS_POR_LOTE} leads por vez.`);
  if (!ids.every((id) => UUID.test(id)) || (usuarioId !== null && !UUID.test(usuarioId))) {
    throw new ErroAtribuicao("Pedido inválido.");
  }

  return transacao(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [TRAVA_ATRIBUICAO]);

    let novo: { id: string; nome: string } | null = null;
    if (usuarioId) {
      const { rows } = await db.query<{ id: string; nome: string }>(
        `SELECT id, coalesce(nome, email) AS nome FROM painel_usuarios
          WHERE id = $1 AND ativo AND papel IN ('admin', 'vendas')
          FOR SHARE`,
        [usuarioId],
      );
      novo = rows[0] ?? null;
      if (!novo) throw new ErroAtribuicao("Este usuário não pode ser responsável: só usuários ativos com papel vendas ou admin.");
    }

    const { rows: existentes } = await db.query<{ id: string; anterior_id: string | null; anterior_nome: string | null }>(
      `SELECT i.id, r.usuario_id AS anterior_id, coalesce(u.nome, u.email) AS anterior_nome
         FROM teste7d_inscricoes i
         LEFT JOIN painel_lead_responsavel r ON r.lead_id = i.id
         LEFT JOIN painel_usuarios u ON u.id = r.usuario_id
        WHERE i.id = ANY($1::uuid[])`,
      [ids],
    );
    if (existentes.length !== ids.length) throw new LeadNaoEncontrado("Lead não encontrado. Atualize a página.");

    const mudar = existentes.filter((l) => l.anterior_id !== (novo?.id ?? null));
    if (mudar.length > 0) {
      const alvo = mudar.map((l) => l.id);
      if (novo) {
        await db.query(
          `INSERT INTO painel_lead_responsavel (lead_id, usuario_id, atribuido_por, atribuido_em)
           SELECT unnest($1::uuid[]), $2, $3, now()
           ON CONFLICT (lead_id) DO UPDATE
             SET usuario_id = EXCLUDED.usuario_id, atribuido_por = EXCLUDED.atribuido_por, atribuido_em = EXCLUDED.atribuido_em`,
          [alvo, novo.id, porId],
        );
      } else {
        await db.query("DELETE FROM painel_lead_responsavel WHERE lead_id = ANY($1::uuid[])", [alvo]);
      }
      for (const l of mudar) {
        await registrarAuditoria(
          {
            usuarioId: porId,
            acao: "atribuir_lead",
            leadId: l.id,
            detalhe: {
              anterior: l.anterior_id ? { id: l.anterior_id, nome: l.anterior_nome } : null,
              novo: novo ? { id: novo.id, nome: novo.nome } : null,
              lote: ids.length > 1,
            },
          },
          db,
        );
      }
    }
    return { alterados: mudar.length, iguais: ids.length - mudar.length };
  });
}
