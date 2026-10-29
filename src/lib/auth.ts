import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { after } from "next/server";
import { autorizarEmail, normalizarEmail, type MetodoLogin } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { pool } from "./db";
import { emailLinkMagico, enviarEmail } from "./email";
import { appUrl, authSecret, emProducao, google } from "./env";
import { podeEnviarLinkMagico } from "./limite";

/**
 * Login do painel (Better Auth): Google OAuth + link mágico por e-mail.
 *
 * Regra única de acesso (ver `acesso.ts`): só entra quem está em
 * `painel_usuarios` com ativo = true. Ela é aplicada:
 *   - no envio do link mágico (e-mail fora da lista não recebe nada, mas a
 *     resposta é idêntica);
 *   - na criação do registro de login (`databaseHooks.user.create`);
 *   - na criação de QUALQUER sessão (`databaseHooks.session.create`), que é
 *     por onde passam os dois métodos — se alguém foi desativado entre o
 *     envio do link e o clique, ou entra pelo Google sem estar na lista,
 *     a sessão não nasce.
 *
 * As tabelas do Better Auth têm o prefixo `painel_auth_` e colunas em
 * snake_case (migração em db/migrations/*_painel_base.sql).
 */

export const SESSAO = {
  /** Sem uso por 8 horas, a sessão vence. */
  inatividadeSeg: 8 * 60 * 60,
  /** Uso renova a validade por mais 8 horas, no máximo a cada 5 minutos. */
  renovarAposSeg: 5 * 60,
  /** Mesmo em uso, pede login de novo 7 dias depois da autenticação. */
  maximoMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export const LINK_MAGICO_VALIDADE_SEG = 10 * 60;
export const PREFIXO_COOKIE = "painel";

export function ipDaRequisicao(headers: Headers | undefined): string | null {
  const encaminhado = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return encaminhado || headers?.get("x-real-ip") || null;
}

/** Roda depois da resposta quando há uma requisição do Next; senão, na hora. */
async function depoisDaResposta(tarefa: () => Promise<void>): Promise<void> {
  const protegida = () => tarefa().catch((erro) => console.error("[auth] falha no envio do link", erro));
  try {
    after(protegida);
  } catch {
    await protegida();
  }
}

function metodoDoCaminho(caminho: string | undefined): MetodoLogin {
  return caminho?.startsWith("/magic-link") ? "link_magico" : "google";
}

type Google = NonNullable<NonNullable<BetterAuthOptions["socialProviders"]>["google"]>;

/**
 * Opções do Better Auth. É uma função pra os testes trocarem só o que fala
 * com o Google (`googleExtra`) e exercitarem o resto do fluxo de verdade.
 */
export function criarOpcoesAuth(googleExtra: Partial<Google> = {}) {
  const credenciaisGoogle = google();

  return {
    appName: "painel ady",
    baseURL: appUrl(),
    secret: authSecret(),
    trustedOrigins: [appUrl()],
    database: pool() as never,

    user: {
      modelName: "painel_auth_user",
      fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
    },
    session: {
      modelName: "painel_auth_session",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
      // Informativo: o papel valendo é sempre o de painel_usuarios.
      additionalFields: { papel: { type: "string", required: false, input: false } },
      expiresIn: SESSAO.inatividadeSeg,
      updateAge: SESSAO.renovarAposSeg,
      // Sem cache em cookie: toda leitura vai ao banco, então desativar
      // alguém ou encerrar uma sessão vale na próxima requisição.
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "painel_auth_account",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      encryptOAuthTokens: true,
      // Mesmo e-mail pelo link mágico e pelo Google = mesma pessoa.
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    verification: {
      modelName: "painel_auth_verification",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "painel_auth_rate_limit",
      fields: { lastRequest: "last_request" },
      window: 60,
      max: 60,
      customRules: {
        // O envio do link tem limite próprio, por e-mail e por IP (hook abaixo).
        "/sign-in/magic-link": false,
        // Lido pelo proxy a cada página; não faz sentido contar.
        "/get-session": false,
      },
    },
    advanced: {
      cookiePrefix: PREFIXO_COOKIE,
      useSecureCookies: emProducao || appUrl().startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },

    socialProviders: credenciaisGoogle
      ? {
          google: {
            ...credenciaisGoogle,
            prompt: "select_account",
            ...googleExtra,
          },
        }
      : undefined,

    plugins: [
      magicLink({
        expiresIn: LINK_MAGICO_VALIDADE_SEG,
        storeToken: "hashed",
        async sendMagicLink({ email, url }) {
          // A resposta HTTP sai igual pra qualquer e-mail; checar a lista e
          // mandar o e-mail fica pra depois dela, pra nem o tempo de
          // resposta denunciar se o e-mail tem acesso.
          await depoisDaResposta(async () => {
            const usuario = await autorizarEmail(email, "link_magico");
            if (usuario) await enviarEmail(emailLinkMagico(usuario.email, url));
          });
        },
      }),
      nextCookies(),
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return;
        const email = typeof ctx.body?.email === "string" ? normalizarEmail(ctx.body.email) : "";
        if (!email) return;
        if (!(await podeEnviarLinkMagico(email, ipDaRequisicao(ctx.request?.headers ?? ctx.headers)))) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Muitas tentativas. Espere alguns minutos e tente de novo.",
          });
        }
      }),
    },

    databaseHooks: {
      // Nem cria registro de login pra quem não está na lista (ex. uma conta
      // Google qualquer que tentou entrar).
      user: {
        create: {
          async before(usuarioAuth, ctx) {
            if (!(await autorizarEmail(usuarioAuth.email, metodoDoCaminho(ctx?.path)))) return false;
          },
        },
      },
      session: {
        create: {
          async before(sessao, ctx) {
            const usuarioAuth = await ctx?.context.internalAdapter.findUserById(sessao.userId);
            const metodo = metodoDoCaminho(ctx?.path);
            if (!usuarioAuth?.emailVerified) return false;

            const usuario = await autorizarEmail(usuarioAuth.email, metodo);
            if (!usuario) return false;

            await pool().query("UPDATE painel_usuarios SET ultimo_acesso_em = now() WHERE id = $1", [usuario.id]);
            await registrarAuditoria({ usuarioId: usuario.id, acao: "login", detalhe: { metodo } });
            return { data: { ...sessao, papel: usuario.papel } };
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

export function criarAuth(googleExtra: Partial<Google> = {}) {
  return betterAuth(criarOpcoesAuth(googleExtra));
}

export type Auth = ReturnType<typeof criarAuth>;

const globalComAuth = globalThis as typeof globalThis & { __painelAuth?: Auth };

/** Instância única (criada na primeira chamada, não no import, pro build não exigir env). */
export function auth(): Auth {
  globalComAuth.__painelAuth ??= criarAuth();
  return globalComAuth.__painelAuth;
}
