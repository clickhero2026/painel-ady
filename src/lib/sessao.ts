import { forbidden, redirect } from "next/navigation";
import { headers } from "next/headers";
import { cache } from "react";
import { buscarUsuarioPorEmail, type UsuarioPainel } from "./acesso";
import { auth, SESSAO } from "./auth";
import { pool } from "./db";
import type { Papel } from "./papeis";

/**
 * Quem está usando o painel nesta requisição. A sessão diz QUEM é (e-mail);
 * o papel e o "ativo" vêm sempre de `painel_usuarios`, relidos a cada
 * requisição — nunca do que foi gravado na sessão.
 */

export function passouDoMaximo(autenticadoEm: Date, agora = Date.now()): boolean {
  return agora - autenticadoEm.getTime() >= SESSAO.maximoMs;
}

export async function encerrarSessao(token: string): Promise<void> {
  await pool().query("DELETE FROM painel_auth_session WHERE token = $1", [token]);
}

/** Encerra todas as sessões de um e-mail (ex. ao desativar a pessoa). */
export async function encerrarSessoesDoEmail(email: string): Promise<void> {
  await pool().query(
    `DELETE FROM painel_auth_session
      WHERE user_id IN (SELECT id FROM painel_auth_user WHERE lower(email) = lower($1))`,
    [email],
  );
}

export type UsuarioAtual = UsuarioPainel & { sessaoToken: string };

/** Usuário válido desta requisição, ou null. Deduplicado por render (React cache). */
export const usuarioAtual = cache(async (): Promise<UsuarioAtual | null> => {
  const sessao = await auth().api.getSession({
    headers: await headers(),
    // Quem renova a validade é o proxy (que pode gravar cookie).
    query: { disableRefresh: true },
  });
  if (!sessao || passouDoMaximo(new Date(sessao.session.createdAt))) return null;

  const usuario = await buscarUsuarioPorEmail(sessao.user.email);
  if (!usuario?.ativo) return null;
  return { ...usuario, sessaoToken: sessao.session.token };
});

/**
 * Página/ação protegida: sem login válido vai pro /login; logado, mas sem
 * o papel exigido, recebe 403.
 */
export async function exigirUsuario(papeis?: readonly Papel[]): Promise<UsuarioAtual> {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");
  if (papeis && !papeis.includes(usuario.papel)) forbidden();
  return usuario;
}
