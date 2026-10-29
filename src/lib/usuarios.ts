import type { UsuarioPainel } from "./acesso";
import { normalizarEmail } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { pool, transacao, type Consulta } from "./db";
import type { Papel } from "./papeis";
import { encerrarSessoesDoEmail } from "./sessao";

/**
 * Gestão de usuários (só admin; quem chama já checou o papel). Toda
 * mudança grava auditoria na mesma transação.
 *
 * Regra do último admin: nunca pode ficar zero admin ativo. Rebaixar ou
 * desativar um admin trava as linhas de admin ativo (FOR UPDATE) antes de
 * contar, então duas ações simultâneas não passam juntas.
 */

export class ErroUsuarios extends Error {}

const COLUNAS = "id, email, nome, papel, ativo, criado_em, ultimo_acesso_em";

export async function listarUsuarios(): Promise<UsuarioPainel[]> {
  const { rows } = await pool().query<UsuarioPainel>(
    `SELECT ${COLUNAS} FROM painel_usuarios ORDER BY ativo DESC, lower(coalesce(nome, email))`,
  );
  return rows;
}

export async function criarUsuario(
  dados: { email: string; nome: string | null; papel: Papel },
  porId: string,
): Promise<UsuarioPainel> {
  const email = normalizarEmail(dados.email);
  return transacao(async (db) => {
    const { rows } = await db.query<UsuarioPainel>(
      `INSERT INTO painel_usuarios (email, nome, papel) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING ${COLUNAS}`,
      [email, dados.nome, dados.papel],
    );
    const criado = rows[0];
    if (!criado) throw new ErroUsuarios("Já existe um usuário com este e-mail.");
    await registrarAuditoria(
      {
        usuarioId: porId,
        acao: "usuario_criado",
        detalhe: { alvo_id: criado.id, email, nome: dados.nome, papel: dados.papel },
      },
      db,
    );
    return criado;
  });
}

interface Travado {
  alvo: UsuarioPainel;
  /** O alvo é o único admin ativo (rebaixar/desativar zeraria os admins). */
  ultimoAdmin: boolean;
}

async function travarAlvo(db: Consulta, id: string): Promise<Travado> {
  // Trava todos os admins ativos e o alvo, sempre na mesma ordem (id).
  const { rows } = await db.query<UsuarioPainel>(
    `SELECT ${COLUNAS} FROM painel_usuarios
      WHERE id = $1 OR (papel = 'admin' AND ativo)
      ORDER BY id FOR UPDATE`,
    [id],
  );
  const alvo = rows.find((u) => u.id === id);
  if (!alvo) throw new ErroUsuarios("Usuário não encontrado.");
  const outrosAdmins = rows.some((u) => u.id !== id && u.papel === "admin" && u.ativo);
  return { alvo, ultimoAdmin: alvo.papel === "admin" && alvo.ativo && !outrosAdmins };
}

export async function alterarPapel(id: string, papel: Papel, porId: string): Promise<void> {
  await transacao(async (db) => {
    const { alvo, ultimoAdmin } = await travarAlvo(db, id);
    if (alvo.papel === papel) return;
    if (papel !== "admin" && ultimoAdmin) {
      throw new ErroUsuarios("Não dá para rebaixar o último admin ativo. Promova outra pessoa antes.");
    }
    await db.query("UPDATE painel_usuarios SET papel = $2 WHERE id = $1", [id, papel]);
    await registrarAuditoria(
      {
        usuarioId: porId,
        acao: "usuario_papel_alterado",
        detalhe: { alvo_id: id, email: alvo.email, de: alvo.papel, para: papel },
      },
      db,
    );
  });
}

export async function definirAtivo(id: string, ativo: boolean, porId: string): Promise<void> {
  if (!ativo && id === porId) throw new ErroUsuarios("Você não pode desativar o seu próprio acesso.");

  const alvo = await transacao(async (db) => {
    const { alvo, ultimoAdmin } = await travarAlvo(db, id);
    if (alvo.ativo === ativo) return null;
    if (!ativo && ultimoAdmin) throw new ErroUsuarios("Não dá para desativar o último admin ativo.");
    await db.query("UPDATE painel_usuarios SET ativo = $2 WHERE id = $1", [id, ativo]);
    await registrarAuditoria(
      {
        usuarioId: porId,
        acao: ativo ? "usuario_reativado" : "usuario_desativado",
        detalhe: { alvo_id: id, email: alvo.email },
      },
      db,
    );
    return alvo;
  });

  // Desativado sai na hora, em todos os aparelhos.
  if (alvo && !ativo) await encerrarSessoesDoEmail(alvo.email);
}
