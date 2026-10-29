import type { Metadata } from "next";
import Link from "next/link";
import { ExportarCsv } from "@/components/funil/ExportarCsv";
import { GraficoFunil, GraficoSerie } from "@/components/funil/GraficosCarregados";
import { Recorte } from "@/components/funil/Recorte";
import { Aviso } from "@/components/ui/Aviso";
import { AMOSTRA_MINIMA, lerFiltrosFunil, parametrosDoFunil, urlDoFunil, type FiltrosFunil, type OrdemTabela } from "@/lib/filtrosFunil";
import { formatarDia, formatarDuracao, formatarNumero, formatarPercentual } from "@/lib/formatos";
import { indicadoresDoFunil, opcoesDoFunil, taxa, type IndicadoresFunil, type LinhaComparativa } from "@/lib/funil";
import { ACESSO_ROTAS, podeAcessar } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Funil" };

const SEM_DADOS = "sem dados";

export default async function PaginaFunil({ searchParams }: PageProps<"/funil">) {
  const usuario = await exigirUsuario(ACESSO_ROTAS.funil);
  const filtros = lerFiltrosFunil(await searchParams);
  const [ind, opcoes] = await Promise.all([indicadoresDoFunil(filtros), opcoesDoFunil()]);
  const { resumo } = ind;

  const vazio = resumo.cadastros === 0;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Funil</h1>
      <p className="mt-1 text-texto-suave">
        Indicadores do teste grátis por coorte de cadastro: o período escolhe pela data do cadastro, e as etapas
        seguintes contam mesmo que tenham acontecido depois. Só números agregados.
      </p>

      <Recorte caminho="/funil" rotulo="Cortes do funil" filtros={filtros} opcoes={opcoes} />

      <div className="mt-4 space-y-3">
        <Aviso tipo="info">
          “Agendou” pode estar subestimado: a data do agendamento vem do navegador da pessoa (o Calendly avisa a
          página), e não é gravada quando ela fecha a aba antes disso.
        </Aviso>
        {resumo.realizadas === null && !vazio && (
          <Aviso tipo="info">
            Sem dados de reunião neste recorte: o resultado da reunião (realizada ou não compareceu) ainda não é
            preenchido por nenhum fluxo. Os indicadores de reunião aparecem como “sem dados”, não como zero.
          </Aviso>
        )}
        {vazio ? (
          <Aviso tipo="info">Nenhum cadastro neste recorte.</Aviso>
        ) : (
          resumo.cadastros < AMOSTRA_MINIMA && (
            <Aviso tipo="info">
              Amostra pequena: {resumo.cadastros === 1 ? "1 cadastro" : `${resumo.cadastros} cadastros`} neste recorte
              (menos de {AMOSTRA_MINIMA}). As taxas podem mudar muito com poucos casos.
            </Aviso>
          )
        )}
      </div>

      <Indicadores ind={ind} />

      {!vazio && (
        <>
          <Funil ind={ind} />
          <Serie ind={ind} />
        </>
      )}

      <section aria-labelledby="titulo-comparativo" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="titulo-comparativo" className="text-xl font-semibold">
              Comparativo
            </h2>
            <p className="mt-1 text-sm text-texto-suave">
              Por criativo e por versão do título, com os mesmos cortes. Grupos com menos de {AMOSTRA_MINIMA} cadastros
              ficam marcados como amostra pequena.
            </p>
          </div>
          {podeAcessar(usuario.papel, "exportarFunil") && !vazio && (
            <ExportarCsv parametros={parametrosDoFunil(filtros).toString()} />
          )}
        </div>
        <TabelaComparativa
          id="por-criativo"
          titulo="Por criativo"
          coluna="Criativo"
          vazio="(sem criativo)"
          linhas={ind.porCriativo}
          filtros={filtros}
          chaves={{ ordem: "oc", dir: "dc" }}
        />
        <TabelaComparativa
          id="por-versao"
          titulo="Por versão do título"
          coluna="Versão"
          vazio="(sem versão)"
          linhas={ind.porVersao}
          filtros={filtros}
          chaves={{ ordem: "ov", dir: "dv" }}
        />
      </section>

      {!vazio && <Abandono ind={ind} />}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "—" : formatarPercentual(v));

function SemDados() {
  return <span className="text-texto-suave">{SEM_DADOS}</span>;
}

// ── KPIs ──

function Indicadores({ ind }: { ind: IndicadoresFunil }) {
  const r = ind.resumo;
  return (
    <section aria-labelledby="titulo-indicadores" className="mt-8">
      <h2 id="titulo-indicadores" className="text-xl font-semibold">
        Indicadores
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao titulo="Cadastros" valor={formatarNumero(r.cadastros)} detalhe="no período" />
        <Cartao
          titulo="Ativações completas"
          valor={formatarNumero(r.ativacoes)}
          detalhe={`${pct(r.taxas.ativacao)} dos cadastros`}
        />
        <Cartao
          titulo="Agendamentos"
          valor={formatarNumero(r.agendamentos)}
          detalhe={`${pct(r.taxas.agendamento)} das ativações · ${pct(r.taxas.geral)} dos cadastros`}
        />
        <Cartao
          titulo="Reuniões realizadas"
          valor={r.realizadas === null ? <SemDados /> : formatarNumero(r.realizadas)}
          detalhe={
            r.realizadas === null
              ? "resultado da reunião ainda não é gravado"
              : `${pct(r.taxas.realizada)} dos agendamentos · ${formatarNumero(r.naoCompareceu ?? 0)} não compareceram`
          }
        />
      </dl>

      <h3 className="mt-8 font-semibold">Tempo mediano entre etapas</h3>
      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        <Cartao titulo="Cadastro → ativação" valor={duracao(r.medianas.ativacao)} detalhe="de quem concluiu a ativação" />
        <Cartao titulo="Ativação → agendamento" valor={duracao(r.medianas.agendamento)} detalhe="de quem agendou" />
        <Cartao
          titulo="Agendamento → reunião realizada"
          valor={r.realizadas === null ? <SemDados /> : duracao(r.medianas.realizada)}
          detalhe="de quem teve a reunião"
        />
      </dl>
    </section>
  );
}

function duracao(segundos: number | null) {
  return segundos === null ? "—" : formatarDuracao(segundos);
}

function Cartao({ titulo, valor, detalhe }: { titulo: string; valor: React.ReactNode; detalhe: string }) {
  return (
    <div className="rounded-2xl border border-borda bg-fundo p-4">
      <dt className="text-sm font-medium text-texto-suave">{titulo}</dt>
      <dd className="mt-1 text-2xl font-semibold">{valor}</dd>
      <dd className="mt-1 text-sm text-texto-suave">{detalhe}</dd>
    </div>
  );
}

// ── Funil em barras ──

function Funil({ ind }: { ind: IndicadoresFunil }) {
  const r = ind.resumo;
  const etapas: { etapa: string; total: number | null; anterior: number | null }[] = [
    { etapa: "Cadastros", total: r.cadastros, anterior: null },
    { etapa: "Ativações", total: r.ativacoes, anterior: r.cadastros },
    { etapa: "Agendamentos", total: r.agendamentos, anterior: r.ativacoes },
    { etapa: "Realizadas", total: r.realizadas, anterior: r.agendamentos },
  ];
  const noGrafico = etapas.filter((e): e is { etapa: string; total: number; anterior: number | null } => e.total !== null);
  const descricao = `Funil em barras: ${noGrafico.map((e) => `${e.etapa} ${formatarNumero(e.total)}`).join(", ")}${
    r.realizadas === null ? ". Reuniões realizadas: sem dados" : ""
  }.`;

  return (
    <section aria-labelledby="titulo-funil" className="mt-10">
      <h2 id="titulo-funil" className="text-xl font-semibold">
        Funil em barras
      </h2>
      <div className="mt-4 grid gap-6 rounded-2xl border border-borda bg-fundo p-4 lg:grid-cols-2">
        <figure className="min-w-0">
          <GraficoFunil etapas={noGrafico} descricao={descricao} />
          {r.realizadas === null && (
            <figcaption className="mt-2 text-sm text-texto-suave">Reuniões realizadas fora do gráfico: sem dados.</figcaption>
          )}
        </figure>
        <div role="region" aria-label="Tabela do funil" tabIndex={0} className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Funil: total por etapa e taxa de passagem</caption>
            <thead className="border-b border-borda">
              <tr>
                <th scope="col" className="px-2 py-2 text-left">Etapa</th>
                <th scope="col" className="px-2 py-2 text-right">Total</th>
                <th scope="col" className="px-2 py-2 text-right">Da etapa anterior</th>
                <th scope="col" className="px-2 py-2 text-right">Dos cadastros</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {etapas.map((e) => (
                <tr key={e.etapa}>
                  <th scope="row" className="px-2 py-2 text-left font-medium">{e.etapa}</th>
                  <td className="px-2 py-2 text-right tabular-nums">{e.total === null ? <SemDados /> : formatarNumero(e.total)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{e.anterior === null ? "—" : pct(taxa(e.total, e.anterior))}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{pct(taxa(e.total, r.cadastros))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ── Série diária ──

function Serie({ ind }: { ind: IndicadoresFunil }) {
  const dias = ind.serie;
  const pico = dias.reduce((m, d) => (d.cadastros > m.cadastros ? d : m), dias[0]);
  const descricao = `Cadastros por dia, de ${formatarDia(dias[0].dia)} a ${formatarDia(dias.at(-1)!.dia)}: ${formatarNumero(
    ind.resumo.cadastros,
  )} no total, pico de ${formatarNumero(pico.cadastros)} em ${formatarDia(pico.dia)}.`;
  return (
    <section aria-labelledby="titulo-serie" className="mt-10">
      <h2 id="titulo-serie" className="text-xl font-semibold">
        Cadastros por dia
      </h2>
      <div className="mt-4 rounded-2xl border border-borda bg-fundo p-4">
        <figure>
          <GraficoSerie dias={dias} descricao={descricao} />
          <figcaption className="mt-2 text-sm text-texto-suave">Dias no horário de São Paulo.</figcaption>
        </figure>
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium text-petroleo-forte">
            Ver os números por dia
          </summary>
          <div role="region" aria-label="Tabela de cadastros por dia" tabIndex={0} className="mt-2 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Cadastros por dia</caption>
              <thead className="border-b border-borda">
                <tr>
                  <th scope="col" className="px-2 py-2 text-left">Dia</th>
                  <th scope="col" className="px-2 py-2 text-right">Cadastros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {dias.map((d) => (
                  <tr key={d.dia}>
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">{formatarDia(d.dia)}</th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatarNumero(d.cadastros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

// ── Tabelas comparativas ──

const COLUNAS: { ordem: OrdemTabela; titulo: string }[] = [
  { ordem: "cadastros", titulo: "Cadastros" },
  { ordem: "ativacoes", titulo: "Ativações" },
  { ordem: "taxa_ativacao", titulo: "Ativação / cadastro" },
  { ordem: "agendamentos", titulo: "Agendamentos" },
  { ordem: "taxa_agendamento", titulo: "Agendamento / ativação" },
  { ordem: "taxa_geral", titulo: "Agendamento / cadastro" },
  { ordem: "realizadas", titulo: "Realizadas" },
];

function TabelaComparativa(props: {
  id: string;
  titulo: string;
  coluna: string;
  vazio: string;
  linhas: LinhaComparativa[];
  filtros: FiltrosFunil;
  chaves: { ordem: "oc" | "ov"; dir: "dc" | "dv" };
}) {
  const ordem = props.filtros[props.chaves.ordem];
  const cab = { filtros: props.filtros, chaves: props.chaves, ancora: props.id };
  return (
    <div className="mt-6">
      <h3 id={props.id} className="font-semibold">
        {props.titulo}
      </h3>
      {props.linhas.length === 0 ? (
        <p className="mt-2 text-sm text-texto-suave">Nenhum cadastro neste recorte.</p>
      ) : (
        <div
          role="region"
          aria-labelledby={props.id}
          tabIndex={0}
          className="mt-3 overflow-x-auto rounded-2xl border border-borda bg-fundo"
        >
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">
              {props.titulo}, ordenado por {(COLUNAS.find((c) => c.ordem === ordem)?.titulo ?? props.coluna).toLowerCase()}
            </caption>
            <thead className="border-b border-borda bg-superficie">
              <tr>
                <Cabecalho {...cab} coluna="grupo" alinhar="text-left">{props.coluna}</Cabecalho>
                {COLUNAS.map((c) => (
                  <Cabecalho key={c.ordem} {...cab} coluna={c.ordem} alinhar="text-right">
                    {c.titulo}
                  </Cabecalho>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {props.linhas.map((l) => (
                <tr key={l.grupo ?? ""}>
                  <th scope="row" className="px-3 py-3 text-left font-medium whitespace-nowrap">
                    {l.grupo ?? <span className="font-normal text-texto-suave">{props.vazio}</span>}
                    {l.cadastros < AMOSTRA_MINIMA && (
                      <span className="mt-1 block w-fit rounded-full bg-atencao-suave px-2 py-0.5 text-xs font-medium text-atencao">
                        amostra pequena
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-3 text-right tabular-nums">{formatarNumero(l.cadastros)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatarNumero(l.ativacoes)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{pct(l.taxas.ativacao)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatarNumero(l.agendamentos)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{pct(l.taxas.agendamento)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{pct(l.taxas.geral)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {l.realizadas === null ? <SemDados /> : formatarNumero(l.realizadas)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cabecalho(props: {
  filtros: FiltrosFunil;
  chaves: { ordem: "oc" | "ov"; dir: "dc" | "dv" };
  ancora: string;
  coluna: OrdemTabela;
  alinhar: string;
  children: React.ReactNode;
}) {
  const { filtros, chaves, coluna } = props;
  const ordem = filtros[chaves.ordem];
  const dir = filtros[chaves.dir];
  const atual = ordem === coluna;
  // Primeiro clique: nome em ordem alfabética, números do maior pro menor.
  const proxima = atual ? (dir === "asc" ? "desc" : "asc") : coluna === "grupo" ? "asc" : "desc";
  return (
    <th scope="col" aria-sort={atual ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`px-3 py-2 ${props.alinhar}`}>
      <Link
        href={`${urlDoFunil(filtros, { [chaves.ordem]: coluna, [chaves.dir]: proxima })}#${props.ancora}`}
        scroll={false}
        className="inline-flex min-h-11 items-center gap-1 font-semibold hover:underline"
      >
        {props.children}
        <span aria-hidden="true">{atual ? (dir === "asc" ? "↑" : "↓") : ""}</span>
      </Link>
    </th>
  );
}

// ── Abandono na ativação ──

function Abandono({ ind }: { ind: IndicadoresFunil }) {
  const { passos, concluiram } = ind.abandono;
  return (
    <section aria-labelledby="titulo-abandono" className="mt-10">
      <h2 id="titulo-abandono" className="text-xl font-semibold">
        Onde param na ativação
      </h2>
      <p className="mt-1 text-sm text-texto-suave">
        A ativação tem uma pergunta por tela e o site grava a resposta cada vez que a pessoa toca em “Continuar”.
        Então dá para medir por pergunta: quem não concluiu parou na primeira pergunta sem resposta. Não há registro de
        horário por pergunta, e a primeira linha inclui quem nem chegou a abrir a ativação (o site não registra a
        abertura).
      </p>
      <div role="region" aria-label="Tabela de abandono por pergunta" tabIndex={0} className="mt-4 overflow-x-auto rounded-2xl border border-borda bg-fundo">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">Abandono por pergunta da ativação</caption>
          <thead className="border-b border-borda bg-superficie">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Pergunta</th>
              <th scope="col" className="px-3 py-2 text-right">Chegaram</th>
              <th scope="col" className="px-3 py-2 text-right">Pararam aqui</th>
              <th scope="col" className="px-3 py-2 text-right">Dos que chegaram</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {passos.map((p, i) => (
              <tr key={p.id}>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {i + 1}. {p.pergunta}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{formatarNumero(p.chegaram)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatarNumero(p.pararam)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(taxa(p.pararam, p.chegaram))}</td>
              </tr>
            ))}
            <tr className="bg-superficie">
              <th scope="row" className="px-3 py-2 text-left font-semibold">Concluíram a ativação</th>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatarNumero(concluiram)}</td>
              <td className="px-3 py-2 text-right">—</td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(taxa(concluiram, ind.resumo.cadastros))} dos cadastros</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
