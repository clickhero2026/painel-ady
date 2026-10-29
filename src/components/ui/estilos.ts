/**
 * Classes base dos componentes (no espírito do shadcn/ui: Tailwind puro,
 * sem dependência extra). Alvo de toque mínimo de 44px.
 */

const botaoBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const botao = {
  primario: `${botaoBase} bg-petroleo-forte text-white hover:bg-petroleo-escuro`,
  secundario: `${botaoBase} border border-borda-campo bg-fundo text-texto hover:bg-superficie`,
  perigo: `${botaoBase} border border-erro bg-fundo text-erro hover:bg-erro-suave`,
} as const;

export const campo =
  "block min-h-11 w-full rounded-lg border border-borda-campo bg-fundo px-3 text-base text-texto placeholder:text-texto-suave aria-[invalid=true]:border-erro";

export const rotulo = "mb-1 block text-sm font-medium text-texto";
