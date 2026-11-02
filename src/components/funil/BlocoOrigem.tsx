import Link from "next/link";
import { ExportarCsv } from "@/components/funil/ExportarCsv";
import { Aviso } from "@/components/ui/Aviso";
import { AMOSTRA_MINIMA, parametrosDoFunil, urlDoFunil, type FiltrosFunil, type OrdemTabela, type VisaoOrigem } from "@/lib/filtrosFunil";
import { formatarNumero, formatarPercentual } from "@/lib/formatos";
import { TOPO_DO_GRAFICO, type ContagemOrigem, type LinhaOrigem, type OrigemDosLeads } from "@/lib/origem";

const ANCORA = "titulo-origem";
const MAX_EXIBIDO = 60;

/** Texto de UTM para a tela: sem caracteres de controle ou invisíveis e com tamanho limitado. O React escapa o resto. */
function exibir(valor: string): string {
  const letras = Array.from(valor.replace(/[\p{Cc}\p{Cf}]/gu, ""));
  return letras.length > MAX_EXIBIDO ? `${letras.slice(0, MAX_EXIBIDO).join("")}…` : letras.join("");
}

const VISOES: { id: VisaoOrigem; rotulo: string }[] = [
  { id: "completa", rotulo: "Source + medium + campaign" },
  { id: "source", rotulo: "Por source" },
  { id: "source_medium", rotulo: "Por source + medium" },
  { id: "campaign", rotulo: "Por campaign" },
];

const COLUNAS: { ordem: OrdemTabela; titulo: string }[] = [
  { ordem: "cadastros", titulo: "Cadastros" },
  { ordem: "ativacoes", titulo: "Ativações" },
  { ordem: "taxa_ativacao", titulo: "Ativação / cadastro" },
  { ordem: "agendamentos", titulo: "Agendamentos" },
  { ordem: "taxa_agendamento", titulo: "Agendamento / ativação" },
  { ordem: "taxa_geral", titulo: "Agendamento / cadastro" },
];

function Oculto() {
  return <span className="text-texto-suave">oculto</span>;
}

const numero = (n: number | null) => (n === null ? <Oculto /> : formatarNumero(n));
const pct = (v: number | null) => (v === null ? "—" : formatarPercentual(v));

export function BlocoOrigem({ origem, filtros, podeExportar }: { origem: OrigemDosLeads; filtros: FiltrosFunil; podeExportar: boolean }) {
  return (
    <section aria-labelledby={ANCORA} className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={ANCORA} className="text-xl font-semibold">
            Origem dos leads
          </h2>
          <p className="mt-1 text-sm text-texto-suave">
            Pelos UTMs do cadastro, com os mesmos cortes. Maiúsculas e espaços não separam origens. Grupos com menos de{" "}
            {AMOSTRA_MINIMA} cadastros ficam marcados como amostra pequena.
          </p>
        </div>
        {podeExportar && !origem.vazio && (
          <ExportarCsv rota="/api/funil/origem/exportar" rotulo="Exportar origem (CSV)" parametros={parametrosDoFunil(filtros).toString()} />
        )}
      </div>

      <div className="mt-4 space-y-3">
        <Aviso tipo="info">“Agendou” pode estar subestimado (agendado_em vem do navegador da pessoa).</Aviso>
        <p className="text-sm text-texto-suave">
          A coluna Criativo (utm_content) não é usada no rastreio atual, então a campanha é o identificador do anúncio.
        </p>
        {origem.ocultaAbaixoDe !== null && !origem.vazio && (
          <Aviso tipo="info">
            No seu acesso (leitura), combinações com menos de {origem.ocultaAbaixoDe} cadastros entram em “Outras origens”,
            e números que permitiriam descobri-las aparecem como “oculto”.
          </Aviso>
        )}
        {!origem.vazio && <SemOrigem origem={origem} />}
      </div>

      {origem.vazio ? (
        <p className="mt-4 text-sm text-texto-suave">Nenhum cadastro neste recorte.</p>
      ) : (
        <>
          <Participacao origem={origem} />
          <Alternancia filtros={filtros} />
          <Tabela origem={origem} filtros={filtros} />
          <Paginacao origem={origem} filtros={filtros} />
        </>
      )}
    </section>
  );
}

function SemOrigem({ origem }: { origem: OrigemDosLeads }) {
  const { cadastros, percentual } = origem.semOrigem;
  if (cadastros === 0) return null;
  return (
    <p className="text-sm text-texto-suave">
      Qualidade do rastreio:{" "}
      {cadastros === null
        ? "há cadastros sem nenhum UTM (quantidade oculta no seu acesso)."
        : `${formatarNumero(cadastros)} ${cadastros === 1 ? "cadastro" : "cadastros"} sem nenhum UTM (${pct(percentual)} do recorte).`}
    </p>
  );
}

// ── Gráfico ──

function Participacao({ origem }: { origem: OrigemDosLeads }) {
  const todas = origem.participacao;
  const topo = todas.slice(0, TOPO_DO_GRAFICO);
  const demais = todas.slice(TOPO_DO_GRAFICO);
  const base = origem.total.cadastros;
  const barras = [
    ...topo.map((p) => ({ nome: exibir(p.source), cadastros: p.cadastros as number | null, percentual: p.percentual })),
    ...(demais.length
      ? [
          {
            nome: `Demais sources (${demais.length})`,
            cadastros: demais.reduce((s, p) => s + p.cadastros, 0) as number | null,
            percentual: null as number | null,
          },
        ]
      : []),
    ...(origem.outras ? [{ nome: "Outras origens", cadastros: origem.outras.cadastros, percentual: null as number | null }] : []),
  ].map((b) => ({ ...b, percentual: b.percentual ?? (b.cadastros !== null && base ? b.cadastros / base : null) }));

  return (
    <div className="mt-6 rounded-2xl border border-borda bg-fundo p-4">
      <h3 className="font-semibold">Participação de cada source nos cadastros</h3>
      <ul className="mt-3 space-y-3">
        {barras.map((b) => (
          <li key={b.nome} className="text-sm" title={`${b.nome}: ${pct(b.percentual)}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 wrap-anywhere">{b.nome}</span>
              <span className="shrink-0 tabular-nums">{pct(b.percentual)}</span>
            </div>
            {b.percentual !== null && (
              <svg aria-hidden="true" focusable="false" viewBox="0 0 100 8" preserveAspectRatio="none" className="mt-1 block h-2 w-full">
                <rect width={Math.max(0.5, Math.min(100, b.percentual * 100))} height="8" rx="1" className="fill-petroleo-forte" />
              </svg>
            )}
          </li>
        ))}
      </ul>
      <details className="mt-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-petroleo-forte">Ver em tabela</summary>
        <div role="region" aria-label="Tabela da participação por source" tabIndex={0} className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Cadastros e participação por source</caption>
            <thead className="border-b border-borda">
              <tr>
                <th scope="col" className="px-2 py-2 text-left">Source</th>
                <th scope="col" className="px-2 py-2 text-right">Cadastros</th>
                <th scope="col" className="px-2 py-2 text-right">Participação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {barras.map((b) => (
                <tr key={b.nome}>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal wrap-anywhere">{b.nome}</th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{numero(b.cadastros)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(b.percentual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ── Alternância de visão ──

function Alternancia({ filtros }: { filtros: FiltrosFunil }) {
  return (
    <nav aria-label="Visão da tabela de origem" className="mt-6">
      <ul className="flex flex-wrap gap-2">
        {VISOES.map((v) => (
          <li key={v.id}>
            <Link
              href={`${urlDoFunil(filtros, { vo: v.id, po: undefined })}#${ANCORA}`}
              scroll={false}
              aria-current={filtros.vo === v.id ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
                filtros.vo === v.id ? "border-petroleo-forte bg-petroleo-forte text-white" : "border-borda-campo bg-fundo text-texto hover:bg-superficie"
              }`}
            >
              {v.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Tabela ──

const TITULOS_DOS_CAMPOS = { source: "Source", medium: "Medium", campaign: "Campaign" } as const;
type Campo = keyof typeof TITULOS_DOS_CAMPOS;

const CAMPOS_DA_VISAO: Record<VisaoOrigem, Campo[]> = {
  completa: ["source", "medium", "campaign"],
  source: ["source"],
  source_medium: ["source", "medium"],
  campaign: ["campaign"],
};

function Tabela({ origem, filtros }: { origem: OrigemDosLeads; filtros: FiltrosFunil }) {
  const campos = CAMPOS_DA_VISAO[origem.visao];
  return (
    <div role="region" aria-label="Tabela de origem" tabIndex={0} className="relative mt-3 overflow-x-auto rounded-2xl border border-borda bg-fundo">
      <table className="w-full min-w-[52rem] text-sm">
        <caption className="sr-only">Cadastros, ativações e agendamentos por origem</caption>
        <thead className="border-b border-borda bg-superficie">
          <tr>
            {campos.map((c, k) =>
              k === 0 ? (
                <Cabecalho key={c} filtros={filtros} coluna="grupo" alinhar="text-left">
                  {TITULOS_DOS_CAMPOS[c]}
                </Cabecalho>
              ) : (
                <th key={c} scope="col" className="px-2 py-2 text-left font-semibold">
                  {TITULOS_DOS_CAMPOS[c]}
                </th>
              ),
            )}
            {COLUNAS.map((c) => (
              <Cabecalho key={c.ordem} filtros={filtros} coluna={c.ordem} alinhar="text-right">
                {c.titulo}
              </Cabecalho>
            ))}
            <th scope="col" className="px-2 py-2 text-left font-semibold">
              Filtro
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {origem.linhas.map((l) => (
            <Linha key={l.grupo} linha={l} campos={campos} filtros={filtros} />
          ))}
        </tbody>
        <tfoot className="border-t border-borda bg-superficie">
          {origem.outras && <LinhaResumo titulo="Outras origens" colunas={campos.length} c={origem.outras} />}
          <LinhaResumo titulo="Total do recorte" colunas={campos.length} c={origem.total} />
        </tfoot>
      </table>
    </div>
  );
}

function Valor({ texto }: { texto: string }) {
  const mostrado = exibir(texto);
  return (
    <span className="wrap-anywhere" title={mostrado === texto ? undefined : texto}>
      {mostrado}
    </span>
  );
}

function Numeros({ c }: { c: ContagemOrigem }) {
  return (
    <>
      <td className="px-2 py-3 text-right tabular-nums">{numero(c.cadastros)}</td>
      <td className="px-2 py-3 text-right tabular-nums">{numero(c.ativacoes)}</td>
      <td className="px-2 py-3 text-right tabular-nums">{pct(c.taxas.ativacao)}</td>
      <td className="px-2 py-3 text-right tabular-nums">{numero(c.agendamentos)}</td>
      <td className="px-2 py-3 text-right tabular-nums">{pct(c.taxas.agendamento)}</td>
      <td className="px-2 py-3 text-right tabular-nums">{pct(c.taxas.geral)}</td>
    </>
  );
}

function Linha({ linha, campos, filtros }: { linha: LinhaOrigem; campos: Campo[]; filtros: FiltrosFunil }) {
  return (
    <tr>
      {campos.map((c, k) =>
        k === 0 ? (
          <th key={c} scope="row" className="max-w-64 px-2 py-3 text-left font-medium">
            <Valor texto={linha[c] ?? ""} />
            {linha.amostraPequena && (
              <span className="mt-1 block w-fit rounded-full bg-atencao-suave px-2 py-0.5 text-xs font-medium text-atencao">amostra pequena</span>
            )}
          </th>
        ) : (
          <td key={c} className="max-w-64 px-2 py-3">
            <Valor texto={linha[c] ?? ""} />
          </td>
        ),
      )}
      <Numeros c={linha} />
      <td className="px-2 py-1">
        {linha.filtro ? (
          <Link
            href={`${urlDoFunil(filtros, { ...linha.filtro, po: undefined })}#${ANCORA}`}
            prefetch={false}
            className="inline-flex min-h-11 items-center font-medium text-petroleo-forte underline"
          >
            Filtrar<span className="sr-only"> por {exibir(linha.grupo)}</span>
          </Link>
        ) : (
          <span className="text-texto-suave">—</span>
        )}
      </td>
    </tr>
  );
}

function LinhaResumo({ titulo, colunas, c }: { titulo: string; colunas: number; c: ContagemOrigem }) {
  return (
    <tr>
      <th scope="row" colSpan={colunas} className="px-2 py-3 text-left font-semibold">
        {titulo}
      </th>
      <Numeros c={c} />
      <td />
    </tr>
  );
}

function Cabecalho(props: { filtros: FiltrosFunil; coluna: OrdemTabela; alinhar: string; children: React.ReactNode }) {
  const { filtros, coluna } = props;
  const atual = filtros.oo === coluna;
  const proxima = atual ? (filtros.odo === "asc" ? "desc" : "asc") : coluna === "grupo" ? "asc" : "desc";
  return (
    <th scope="col" aria-sort={atual ? (filtros.odo === "asc" ? "ascending" : "descending") : undefined} className={`px-2 py-2 ${props.alinhar}`}>
      <Link
        href={`${urlDoFunil(filtros, { oo: coluna, odo: proxima, po: undefined })}#${ANCORA}`}
        scroll={false}
        className="inline-flex min-h-11 items-center gap-1 font-semibold hover:underline"
      >
        {props.children}
        <span aria-hidden="true">{atual ? (filtros.odo === "asc" ? "↑" : "↓") : ""}</span>
      </Link>
    </th>
  );
}

function Paginacao({ origem, filtros }: { origem: OrigemDosLeads; filtros: FiltrosFunil }) {
  const { atual, total, linhasNoTotal } = origem.pagina;
  if (total <= 1) return null;
  const link = "inline-flex min-h-11 items-center rounded-full border border-borda-campo bg-fundo px-4 text-sm font-medium hover:bg-superficie";
  const ir = (po: number) => `${urlDoFunil(filtros, { po: String(po) })}#${ANCORA}`;
  return (
    <nav aria-label="Páginas da tabela de origem" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      {atual > 1 && (
        <Link href={ir(atual - 1)} scroll={false} className={link}>
          Anterior
        </Link>
      )}
      <span>
        Página {atual} de {total} ({formatarNumero(linhasNoTotal)} linhas)
      </span>
      {atual < total && (
        <Link href={ir(atual + 1)} scroll={false} className={link}>
          Próxima
        </Link>
      )}
    </nav>
  );
}
