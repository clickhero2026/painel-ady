import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { buscarUsuarioPorEmail } from "@/lib/acesso";
import { auth, PREFIXO_COOKIE } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { montarCsp } from "@/lib/seguranca";
import { encerrarSessao, passouDoMaximo } from "@/lib/sessao";

/**
 * Porteiro de todas as rotas (exceto /login e /api/auth/*, que são o
 * próprio login). A cada requisição protegida:
 *   1. sem cookie de sessão → /login (APIs: 401);
 *   2. lê a sessão no banco pelo Better Auth, que também renova a validade
 *      de 8h quando a pessoa está usando (o cookie novo vai na resposta);
 *   3. sessão vencida, com mais de 7 dias desde o login ou de alguém que
 *      não está mais ativo em painel_usuarios → encerra e manda pro /login.
 * O papel NÃO é decidido aqui: cada página/ação confere no servidor
 * (`exigirUsuario`), inclusive quem abre a URL direto.
 *
 * Também põe a CSP com nonce em toda página.
 */

const ROTAS_PUBLICAS = ["/login", "/api/auth/"];

function ehPublica(caminho: string): boolean {
  return ROTAS_PUBLICAS.some((rota) => caminho === rota || caminho.startsWith(rota.endsWith("/") ? rota : `${rota}/`));
}

interface SessaoLida {
  session: { token: string; createdAt: string };
  user: { email: string };
}

function comCsp(request: NextRequest, setCookies: string[] = []): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = montarCsp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const resposta = NextResponse.next({ request: { headers: requestHeaders } });
  resposta.headers.set("Content-Security-Policy", csp);
  for (const cookie of setCookies) resposta.headers.append("Set-Cookie", cookie);
  return resposta;
}

function paraLogin(request: NextRequest, motivo?: "expirada"): NextResponse {
  const { pathname, search } = request.nextUrl;
  let resposta: NextResponse;
  if (pathname.startsWith("/api/")) {
    resposta = NextResponse.json({ erro: "nao_autenticado" }, { status: 401 });
  } else {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("voltar", pathname + search);
    if (motivo) url.searchParams.set("motivo", motivo);
    resposta = NextResponse.redirect(url);
  }
  // Apaga o cookie de sessão (o prefixo __Secure- só aceita ser apagado
  // com o atributo Secure).
  for (const nome of [`${PREFIXO_COOKIE}.session_token`, `__Secure-${PREFIXO_COOKIE}.session_token`]) {
    if (!request.cookies.has(nome)) continue;
    resposta.cookies.set(nome, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: nome.startsWith("__Secure-"),
    });
  }
  resposta.headers.set("Cache-Control", "no-store");
  return resposta;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (ehPublica(pathname)) return comCsp(request);

  if (!getSessionCookie(request, { cookiePrefix: PREFIXO_COOKIE })) return paraLogin(request);

  // Passa pelo roteador do Better Auth (e não por auth.api) pra receber os
  // Set-Cookie da renovação e repassá-los ao navegador.
  const resposta = await auth().handler(
    new Request(`${appUrl()}/api/auth/get-session`, { headers: request.headers }),
  );
  const setCookies = resposta.headers.getSetCookie();
  const sessao = resposta.ok ? ((await resposta.json()) as SessaoLida | null) : null;
  if (!sessao) return paraLogin(request, "expirada");

  if (passouDoMaximo(new Date(sessao.session.createdAt))) {
    await encerrarSessao(sessao.session.token);
    return paraLogin(request, "expirada");
  }

  const usuario = await buscarUsuarioPorEmail(sessao.user.email);
  if (!usuario?.ativo) {
    await encerrarSessao(sessao.session.token);
    return paraLogin(request);
  }

  return comCsp(request, setCookies);
}

export const config = {
  // Tudo, menos os arquivos estáticos do Next e os ícones/robots.
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|robots.txt).*)"],
};
