import { registrarAuditoria } from "./auditoria";
import { pool } from "./db";
import { adminInicial } from "./env";
import type { Papel } from "./papeis";

/**
 * Quem pode entrar no painel: SÓ quem está em `painel_usuarios` com
 * `ativo = true`, comparando o e-mail sem diferenciar maiúsculas. Nunca
 * há regra por domínio — parte da equipe usa Google Workspace e parte
 * não (e-mails de outros domínios entram pelo link mágico).
 */

export interface UsuarioPainel {
  id: string;
  email: string;
  nome: string | null;
  papel: Papel;
  ativo: boolean;
  criado_em: Date;
  ultimo_acesso_em: Date | null;
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function buscarUsuarioPorEmail(email: string): Promise<UsuarioPainel | null> {
  const { rows } = await pool().query<UsuarioPainel>(
    `SELECT id, email, nome, papel, ativo, criado_em, ultimo_acesso_em
       FROM painel_usuarios WHERE lower(email) = $1`,
    [normalizarEmail(email)],
  );
  return rows[0] ?? null;
}

/**
 * Cria o primeiro admin a partir de PAINEL_ADMIN_INICIAL — só quando a
 * tabela está vazia e só pra esse e-mail. O INSERT … WHERE NOT EXISTS
 * garante que, com a tabela já tendo alguém, nada acontece (mesmo com a
 * variável ainda configurada).
 */
async function criarAdminInicialSePreciso(email: string): Promise<UsuarioPainel | null> {
  const inicial = adminInicial();
  if (!inicial || inicial !== normalizarEmail(email)) return null;

  const { rows } = await pool().query<UsuarioPainel>(
    `INSERT INTO painel_usuarios (email, papel)
     SELECT $1, 'admin'
      WHERE NOT EXISTS (SELECT 1 FROM painel_usuarios)
     ON CONFLICT DO NOTHING
     RETURNING id, email, nome, papel, ativo, criado_em, ultimo_acesso_em`,
    [inicial],
  );
  const criado = rows[0] ?? null;
  if (criado) {
    await registrarAuditoria({
      usuarioId: criado.id,
      acao: "admin_inicial_criado",
      detalhe: { email: criado.email },
    });
  }
  return criado;
}

export type MetodoLogin = "google" | "link_magico";

/**
 * Decide se o e-mail pode entrar. Devolve o usuário quando pode; quando não
 * pode, grava `acesso_negado` na auditoria e devolve null. Quem chama
 * mostra sempre a mesma mensagem neutra, sem dizer o motivo.
 */
export async function autorizarEmail(email: string, metodo: MetodoLogin): Promise<UsuarioPainel | null> {
  const usuario = (await buscarUsuarioPorEmail(email)) ?? (await criarAdminInicialSePreciso(email));
  if (usuario?.ativo) return usuario;

  await registrarAuditoria({
    usuarioId: usuario?.id ?? null,
    acao: "acesso_negado",
    detalhe: { email: normalizarEmail(email), metodo, motivo: usuario ? "inativo" : "nao_cadastrado" },
  });
  return null;
}
