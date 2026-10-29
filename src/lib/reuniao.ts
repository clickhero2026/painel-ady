import { registrarAuditoria } from "./auditoria";
import { pool, transacao, type Consulta } from "./db";
import { rotuloEtapa } from "./etapas";

/**
 * Desfecho da reunião, marcado à mão por suporte ou admin (quem chama já
 * checou o papel). O painel só escreve `status` e `realizada_em` em
 * teste7d_inscricoes (é o que o GRANT do painel_app permite).
 *
 * - Marcar: só a partir de `agendado`, num UPDATE condicional
 *   (WHERE status = 'agendado'). Duas pessoas ao mesmo tempo: a segunda
 *   espera a primeira e não acha mais a linha como agendado (conflito).
 * - Desfazer: volta para `agendado` e limpa `realizada_em`, até 24 horas
 *   depois da marcação. A hora da marcação vem da auditoria (não há coluna
 *   para "não compareceu em"), e o UPDATE também é condicional ao status
 *   marcado.
 * - Tudo grava auditoria na mesma transação.
 */

export type Desfecho = "realizado" | "nao_compareceu";
export const DESFECHOS: readonly Desfecho[] = ["realizado", "nao_compareceu"];
export const PRAZO_DESFAZER_HORAS = 24;

const ACAO_DO_DESFECHO = { realizado: "marcar_realizada", nao_compareceu: "marcar_nao_compareceu" } as const;
const DESFECHO_DA_ACAO: Record<string, Desfecho> = { marcar_realizada: "realizado", marcar_nao_compareceu: "nao_compareceu" };

export class ErroReuniao extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "nao_encontrado" | "conflito" | "prazo",
  ) {
    super(mensagem);
  }
}

async function statusAtual(db: Consulta, leadId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>("SELECT status FROM teste7d_inscricoes WHERE id = $1", [leadId]);
  if (!rows[0]) throw new ErroReuniao("Lead não encontrado.", "nao_encontrado");
  return rows[0].status;
}

export async function marcarDesfecho(leadId: string, desfecho: Desfecho, porId: string): Promise<void> {
  await transacao(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE teste7d_inscricoes
          SET status = $2::text,
              realizada_em = CASE WHEN $2::text = 'realizado' THEN now() ELSE realizada_em END
        WHERE id = $1 AND status = 'agendado'
        RETURNING id`,
      [leadId, desfecho],
    );
    if (!rows[0]) {
      const agora = await statusAtual(db, leadId);
      throw new ErroReuniao(
        `Não foi gravado: este lead não está mais como agendado (agora está em “${rotuloEtapa(agora)}”). ` +
          "Outra pessoa pode ter marcado antes; a ficha foi atualizada.",
        "conflito",
      );
    }
    await registrarAuditoria(
      { usuarioId: porId, acao: ACAO_DO_DESFECHO[desfecho], leadId, detalhe: { de: "agendado", para: desfecho } },
      db,
    );
  });
}

export interface MarcacaoDesfazivel {
  desfecho: Desfecho;
  marcadaEm: Date;
  desfazerAte: Date;
}

interface UltimaMarcacao {
  acao: string;
  criado_em: Date;
  ate: Date;
  dentro: boolean;
}

async function ultimaMarcacao(db: Consulta, leadId: string): Promise<UltimaMarcacao | null> {
  const { rows } = await db.query<UltimaMarcacao>(
    `SELECT acao, criado_em,
            criado_em + make_interval(hours => $2) AS ate,
            criado_em > now() - make_interval(hours => $2) AS dentro
       FROM painel_auditoria
      WHERE lead_id = $1 AND acao IN ('marcar_realizada', 'marcar_nao_compareceu', 'desfazer_marcacao')
      ORDER BY id DESC
      LIMIT 1`,
    [leadId, PRAZO_DESFAZER_HORAS],
  );
  return rows[0] ?? null;
}

/** A marcação que ainda dá para desfazer (a última, no prazo, e o lead ainda nesse status), ou null. */
export async function marcacaoDesfazivel(leadId: string, status: string): Promise<MarcacaoDesfazivel | null> {
  const m = await ultimaMarcacao(pool(), leadId);
  const desfecho = m && DESFECHO_DA_ACAO[m.acao];
  if (!m || !desfecho || !m.dentro || desfecho !== status) return null;
  return { desfecho, marcadaEm: m.criado_em, desfazerAte: m.ate };
}

export async function desfazerMarcacao(leadId: string, porId: string): Promise<void> {
  await transacao(async (db) => {
    const m = await ultimaMarcacao(db, leadId);
    const desfecho = m && DESFECHO_DA_ACAO[m.acao];
    if (!m || !desfecho) {
      await statusAtual(db, leadId); // 404 se o lead não existe
      throw new ErroReuniao("Não há marcação feita pelo painel para desfazer.", "conflito");
    }
    if (!m.dentro) {
      throw new ErroReuniao(`Passou o prazo: só dá para desfazer até ${PRAZO_DESFAZER_HORAS} horas depois da marcação.`, "prazo");
    }
    const { rows } = await db.query<{ id: string }>(
      `UPDATE teste7d_inscricoes SET status = 'agendado', realizada_em = NULL
        WHERE id = $1 AND status = $2
        RETURNING id`,
      [leadId, desfecho],
    );
    if (!rows[0]) {
      const agora = await statusAtual(db, leadId);
      throw new ErroReuniao(
        `Não foi desfeito: o lead não está mais em “${rotuloEtapa(desfecho)}” (agora está em “${rotuloEtapa(agora)}”). ` +
          "Outra pessoa pode ter desfeito antes; a ficha foi atualizada.",
        "conflito",
      );
    }
    await registrarAuditoria(
      { usuarioId: porId, acao: "desfazer_marcacao", leadId, detalhe: { de: desfecho, para: "agendado", marcada_em: m.criado_em } },
      db,
    );
  });
}
