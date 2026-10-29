/**
 * Marca do painel: símbolo + "ady" (sempre em minúsculas). Mesmo símbolo
 * provisório do site, até o lockup oficial do guia de marca entrar no repo.
 * O laranja aparece só no ponto do símbolo.
 */
export function Logo({ legenda = "painel" }: { legenda?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-texto">
      <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="38" r="16" className="fill-petroleo-forte" />
        <circle cx="32" cy="12" r="6" className="fill-faisca" />
      </svg>
      <span className="text-2xl leading-none font-semibold tracking-tight">ady</span>
      {legenda && (
        <span className="rounded-full bg-petroleo-suave px-2 py-0.5 text-xs font-medium text-petroleo-escuro">
          {legenda}
        </span>
      )}
    </span>
  );
}
