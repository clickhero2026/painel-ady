import { pool, type Consulta } from "./db";

/**
 * Trilha de auditoria (`painel_auditoria`). Toda ação de login e de gestão
 * de usuários passa por aqui; as telas de leads vão usar `lead_id`.
 */

export type AcaoAuditoria =
  | "login"
  | "logout"
  | "acesso_negado"
  | "admin_inicial_criado"
  | "usuario_criado"
  | "usuario_papel_alterado"
  | "usuario_desativado"
  | "usuario_reativado"
  | "ver_lead"
  | "copiar_link"
  | "exportar_funil"
  | "atribuir_lead"
  | "marcar_realizada"
  | "marcar_nao_compareceu"
  | "desfazer_marcacao";

export async function registrarAuditoria(
  evento: {
    usuarioId: string | null;
    acao: AcaoAuditoria;
    leadId?: string | null;
    detalhe?: Record<string, unknown>;
  },
  db: Consulta = pool(),
): Promise<void> {
  await db.query(
    `INSERT INTO painel_auditoria (usuario_id, acao, lead_id, detalhe)
     VALUES ($1, $2, $3, $4)`,
    [evento.usuarioId, evento.acao, evento.leadId ?? null, evento.detalhe ? JSON.stringify(evento.detalhe) : null],
  );
}
