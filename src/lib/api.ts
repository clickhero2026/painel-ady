import { NextResponse } from "next/server";
import { appUrl } from "./env";
import type { Papel } from "./papeis";
import { usuarioAtual, type UsuarioAtual } from "./sessao";

/**
 * Ajudantes das rotas /api/*. O proxy já barra quem não tem sessão; aqui o
 * usuário e o papel são conferidos de novo, no servidor, a cada chamada.
 */

export function json(corpo: unknown, status = 200): NextResponse {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export const naoEncontrado = () => json({ erro: "nao_encontrado" }, 404);

/** Usuário ativo com um dos `papeis`, ou a resposta de erro pronta (401/403). */
export async function usuarioDaApi(
  papeis: readonly Papel[],
): Promise<{ usuario: UsuarioAtual; erro?: never } | { usuario?: never; erro: NextResponse }> {
  const usuario = await usuarioAtual();
  if (!usuario) return { erro: json({ erro: "nao_autenticado" }, 401) };
  if (!papeis.includes(usuario.papel)) return { erro: json({ erro: "sem_permissao" }, 403) };
  return { usuario };
}

/** POST só vindo do próprio painel (defesa contra CSRF além do SameSite=Lax). */
export function origemValida(request: Request): boolean {
  return request.headers.get("origin") === appUrl();
}
