import Link from "next/link";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { Seletor } from "@/components/ui/Seletor";
import { PERIODOS, ROTULO_PERIODO, urlDoRecorte, type FiltrosFunil } from "@/lib/filtrosFunil";
import { VERSOES } from "@/lib/filtrosLeads";
import { formatarDia } from "@/lib/formatos";
import type { OpcoesDoFunil } from "@/lib/funil";

/**
 * Período e cortes (atalhos, formulário GET e a frase do recorte), iguais
 * no funil e no perfil.
 */
export function Recorte(props: { caminho: string; rotulo: string; filtros: FiltrosFunil; opcoes: OpcoesDoFunil }) {
  const { caminho, filtros, opcoes } = props;
  const cortesAtivos = (["criativo", "campanha", "origem", "midia", "versao"] as const).filter((c) => filtros[c]).length;
  return (
    <>
      <nav aria-label="Período" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => (
            <li key={p}>
              <LinkPeriodo
                href={urlDoRecorte(caminho, filtros, { periodo: p, de: undefined, ate: undefined })}
                atual={filtros.periodo === p}
              >
                {ROTULO_PERIODO[p]}
              </LinkPeriodo>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" action={caminho} aria-label={props.rotulo} className="mt-4">
        <details open={cortesAtivos > 0 || filtros.periodo === "personalizado"} className="rounded-2xl border border-borda bg-fundo">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">
            Período e cortes{cortesAtivos > 0 ? ` (${cortesAtivos} ${cortesAtivos === 1 ? "ativo" : "ativos"})` : ""}
          </summary>
          <div className="grid gap-4 border-t border-borda p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="de" className={rotulo}>
                Cadastro de
              </label>
              <input id="de" name="de" type="date" defaultValue={filtros.de} className={campo} />
            </div>
            <div>
              <label htmlFor="ate" className={rotulo}>
                Cadastro até
              </label>
              <input id="ate" name="ate" type="date" defaultValue={filtros.ate} className={campo} />
            </div>
            <Seletor id="criativo" rotulo="Criativo (utm_content)" valor={filtros.criativo} opcoes={opcoes.criativos.map((c) => [c, c])} />
            <Seletor id="campanha" rotulo="Campanha (utm_campaign)" valor={filtros.campanha} opcoes={opcoes.campanhas.map((c) => [c, c])} />
            <Seletor id="origem" rotulo="Origem (utm_source)" valor={filtros.origem} opcoes={opcoes.origens.map((c) => [c, c])} />
            <Seletor id="midia" rotulo="Mídia (utm_medium)" valor={filtros.midia} opcoes={opcoes.midias.map((c) => [c, c])} />
            <Seletor id="versao" rotulo="Versão do título" valor={filtros.versao} opcoes={VERSOES.map((v) => [v, v])} />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-borda p-4">
            <button type="submit" className={botao.primario}>
              Aplicar
            </button>
            <Link href={caminho} className={botao.secundario}>
              Limpar
            </Link>
          </div>
        </details>
      </form>

      <p className="mt-4 text-sm text-texto-suave" aria-live="polite">
        {descreverRecorte(filtros)}
      </p>
    </>
  );
}

function descreverRecorte(f: FiltrosFunil): string {
  const periodo =
    f.de && f.ate
      ? `Cadastros de ${formatarDia(f.de)} a ${formatarDia(f.ate)}`
      : f.de
        ? `Cadastros a partir de ${formatarDia(f.de)}`
        : f.ate
          ? `Cadastros até ${formatarDia(f.ate)}`
          : "Todos os cadastros";
  const cortes = [
    f.criativo && `criativo ${f.criativo}`,
    f.campanha && `campanha ${f.campanha}`,
    f.origem && `origem ${f.origem}`,
    f.midia && `mídia ${f.midia}`,
    f.versao && `versão ${f.versao}`,
  ].filter(Boolean);
  return `${periodo} (horário de São Paulo)${cortes.length ? `, ${cortes.join(", ")}` : ""}.`;
}

function LinkPeriodo({ href, atual, children }: { href: string; atual: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={atual ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
        atual ? "border-petroleo-forte bg-petroleo-forte text-white" : "border-borda-campo bg-fundo text-texto hover:bg-superficie"
      }`}
    >
      {children}
    </Link>
  );
}
