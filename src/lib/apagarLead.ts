import { registrarAuditoria } from "./auditoria";
import { transacao } from "./db";
import { UUID } from "./leads";
import { TRAVA_MESCLA } from "./mescla";
import { ehSuperAdmin, type Papel } from "./papeis";

/**
 * Apagar lead (DELETE de verdade em teste7d_inscricoes). Regra única, no
 * servidor; a API e a ficha só chamam esta função.
 *
 * - Só o super admin. O papel é relido de painel_usuarios DENTRO da
 *   transação (não vale o que veio da sessão nem o que a tela mostrou).
 * - Cadastro mesclado em outro (duplicado) ou principal com cadastros
 *   mesclados nele: recusado. Desfazer as mesclas antes. Apagar um
 *   principal soltaria os duplicados (a mescla cai em cascata) e eles
 *   voltariam às listas e contagens sem ninguém pedir.
 * - O que depende do lead (responsável, etapa, histórico de etapas,
 *   anotações, mescla) sai pelo ON DELETE CASCADE das chaves estrangeiras,
 *   que roda com os direitos do dono do banco: o painel_app só precisa de
 *   DELETE em teste7d_inscricoes. Depois do DELETE, a função confere, na
 *   mesma transação, que nada ficou apontando para o lead; se ficou, tudo
 *   é desfeito.
 * - Auditoria `apagar_lead` na mesma transação, só com dados não pessoais
 *   (LGPD). As linhas antigas de painel_auditoria com esse lead_id ficam
 *   (só ids, sem dados pessoais; lead_id lá não é chave estrangeira).
 * - Mesma trava da mescla (uma operação por vez sobre mesclas).
 */

export class ErroApagarLead extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "nao_encontrado" | "invalido" | "sem_permissao" | "confirmacao",
  ) {
    super(mensagem);
  }
}

export function podeApagarLead(papel: Papel): boolean {
  return ehSuperAdmin(papel);
}

/** Tabelas do painel que apontam para teste7d_inscricoes (conferidas depois do DELETE). */
export const DEPENDENTES_DO_LEAD = [
  ["painel_lead_responsavel", "lead_id"],
  ["painel_lead_etapa", "lead_id"],
  ["painel_lead_etapa_historico", "lead_id"],
  ["painel_lead_anotacao", "lead_id"],
  ["painel_lead_mescla", "duplicado_id"],
  ["painel_lead_mescla", "principal_id"],
] as const;

export interface LeadApagado {
  id: string;
}

export async function apagarLead(
  usuario: { id: string; papel: Papel },
  leadId: string,
  emailConfirmado: string,
): Promise<LeadApagado> {
  if (!podeApagarLead(usuario.papel)) throw new ErroApagarLead("Só o super admin pode apagar leads.", "sem_permissao");
  if (!UUID.test(leadId)) throw new ErroApagarLead("Lead não encontrado.", "nao_encontrado");
  const id = leadId.toLowerCase();

  return transacao(async (db) => {
    // Papel relido do banco, travado até o fim da transação.
    const { rows: quem } = await db.query<{ papel: Papel; ativo: boolean }>(
      "SELECT papel, ativo FROM painel_usuarios WHERE id = $1 FOR SHARE",
      [usuario.id],
    );
    if (!quem[0]?.ativo || !podeApagarLead(quem[0].papel)) {
      throw new ErroApagarLead("Só o super admin pode apagar leads.", "sem_permissao");
    }

    await db.query("SELECT pg_advisory_xact_lock($1)", [TRAVA_MESCLA]);

    const { rows: lead } = await db.query<{ email: string }>("SELECT email FROM teste7d_inscricoes WHERE id = $1", [id]);
    if (!lead[0]) throw new ErroApagarLead("Lead não encontrado. Atualize a página.", "nao_encontrado");
    if (lead[0].email.trim().toLowerCase() !== emailConfirmado.trim().toLowerCase()) {
      throw new ErroApagarLead("O e-mail digitado não confere com o e-mail do lead.", "confirmacao");
    }

    const { rows: mescla } = await db.query<{ duplicado_id: string; principal_id: string }>(
      "SELECT duplicado_id, principal_id FROM painel_lead_mescla WHERE duplicado_id = $1 OR principal_id = $1",
      [id],
    );
    if (mescla.some((m) => m.duplicado_id === id)) {
      throw new ErroApagarLead(
        "Este cadastro está mesclado em outro. Desfaça a mescla na ficha do principal antes de apagar.",
        "invalido",
      );
    }
    if (mescla.length > 0) {
      const n = mescla.length;
      throw new ErroApagarLead(
        `Este lead tem ${n} ${n === 1 ? "cadastro mesclado" : "cadastros mesclados"} nele. Desfaça ${n === 1 ? "a mescla" : "as mesclas"} antes de apagar.`,
        "invalido",
      );
    }

    // Só colunas não pessoais voltam do DELETE, para a auditoria.
    const { rows: apagado } = await db.query<{
      status: string | null;
      utm_content: string | null;
      utm_campaign: string | null;
      lp_variant: string | null;
      created_at: Date;
    }>(
      `DELETE FROM teste7d_inscricoes WHERE id = $1
       RETURNING status, utm_content, utm_campaign, lp_variant, created_at`,
      [id],
    );
    if (!apagado[0]) throw new ErroApagarLead("Lead não encontrado. Atualize a página.", "nao_encontrado");

    const { rows: sobras } = await db.query<{ n: number }>(
      `SELECT (${DEPENDENTES_DO_LEAD.map(([tabela, coluna]) => `(SELECT count(*) FROM ${tabela} WHERE ${coluna} = $1)`).join(" + ")})::int AS n`,
      [id],
    );
    if (sobras[0].n !== 0) {
      // Chave estrangeira sem ON DELETE CASCADE no banco: desfaz tudo.
      throw new Error(`apagarLead: ${sobras[0].n} registro(s) dependente(s) ficariam órfãos; nada foi apagado.`);
    }

    const a = apagado[0];
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        acao: "apagar_lead",
        leadId: id,
        detalhe: {
          status: a.status,
          utm_content: a.utm_content,
          utm_campaign: a.utm_campaign,
          lp_variant: a.lp_variant,
          created_at: new Date(a.created_at).toISOString(),
        },
      },
      db,
    );
    return { id };
  });
}
