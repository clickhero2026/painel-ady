/**
 * Cabeçalhos de segurança. Os fixos valem pra toda resposta (inclusive
 * arquivos estáticos) e entram pelo next.config.ts; a CSP leva um nonce
 * novo por requisição e é montada no proxy.
 */

export const CABECALHOS_FIXOS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

export function montarCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Destino de volta depois do login: só caminho interno (nada de //host). */
export function caminhoInternoSeguro(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/\\")) return "/";
  if (valor.startsWith("/login") || valor.startsWith("/api/")) return "/";
  return valor;
}
