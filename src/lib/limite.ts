import { createHash } from "node:crypto";
import { pool } from "./db";

/**
 * Limite de tentativas em janela fixa, guardado na tabela de rate limit do
 * Better Auth (`painel_auth_rate_limit`) com chaves próprias (prefixo
 * `painel:`), pra funcionar igual em todas as instâncias da Vercel.
 *
 * Aqui `last_request` guarda o INÍCIO da janela (ms), não o último pedido.
 */

export const LIMITE_LINK_MAGICO = {
  janelaMs: 15 * 60 * 1000,
  porEmail: 5,
  porIp: 20,
} as const;

function hash(valor: string): string {
  return createHash("sha256").update(valor).digest("hex").slice(0, 32);
}

/** Soma uma tentativa e diz se ainda está dentro do limite. */
export async function contarTentativa(
  chave: string,
  maximo: number,
  janelaMs: number,
  agora = Date.now(),
): Promise<boolean> {
  const { rows } = await pool().query<{ count: number }>(
    `INSERT INTO painel_auth_rate_limit (key, count, last_request)
     VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN $2 - painel_auth_rate_limit.last_request >= $3
                    THEN 1 ELSE painel_auth_rate_limit.count + 1 END,
       last_request = CASE WHEN $2 - painel_auth_rate_limit.last_request >= $3
                    THEN $2 ELSE painel_auth_rate_limit.last_request END
     RETURNING count`,
    [chave, agora, janelaMs],
  );
  return Number(rows[0].count) <= maximo;
}

/** Envio do link mágico: até 5 por e-mail e 20 por IP a cada 15 minutos. */
export async function podeEnviarLinkMagico(email: string, ip: string | null): Promise<boolean> {
  const { janelaMs, porEmail, porIp } = LIMITE_LINK_MAGICO;
  const okEmail = await contarTentativa(`painel:link-email:${hash(email)}`, porEmail, janelaMs);
  const okIp = ip ? await contarTentativa(`painel:link-ip:${hash(ip)}`, porIp, janelaMs) : true;
  return okEmail && okIp;
}

/**
 * Cadastro manual de lead (POST /api/leads): até 30 tentativas por usuário a
 * cada 15 minutos, contando as recusadas. O "e-mail já existe" diz se um
 * e-mail está na base; o limite impede que alguém use a tela para varrer
 * e-mails (e cada tentativa que passa cria um lead de verdade, auditado).
 */
export const LIMITE_LEAD_MANUAL = {
  janelaMs: 15 * 60 * 1000,
  porUsuario: 30,
} as const;

export async function podeTentarCriarLead(usuarioId: string): Promise<boolean> {
  const { janelaMs, porUsuario } = LIMITE_LEAD_MANUAL;
  return contarTentativa(`painel:lead-manual:${hash(usuarioId)}`, porUsuario, janelaMs);
}
