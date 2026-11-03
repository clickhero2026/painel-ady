import type { Metadata } from "next";
import Link from "next/link";
import { EtiquetaComercial } from "@/components/pipeline/EtiquetaComercial";
import { MudarEtapa } from "@/components/pipeline/MudarEtapa";
import { Aviso } from "@/components/ui/Aviso";
import { Seletor } from "@/components/ui/Seletor";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import {
  CARTOES_POR_COLUNA,
  DIAS_PADRAO_FINAIS,
  ETAPA_PERDIDO,
  ETAPAS_COMERCIAIS,
  ROTULO_ETAPA_COMERCIAL,
  rotuloMotivo,
} from "@/config/pipeline";
import {
  lerFiltrosPipeline,
  podeFiltrarResponsavelNoPipeline,
  urlDoPipeline,
  type FiltrosPipeline,
  type OrdemPipeline,
} from "@/lib/filtrosPipeline";
import { formatarData, numeroDeDias } from "@/lib/formatos";
import { opcoesDeFiltro } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";
import {
  listaDoPipeline,
  opcoesDoPipeline,
  podeMudarEtapa,
  quadroDoPipeline,
  type CartaoDoPipeline,
  type ColunaDoPipeline,
  type ListaDoPipeline,
} from "@/lib/pipeline";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PaginaPipeline({ searchParams }: PageProps<"/pipeline">) {
  const usuario = await exigirUsuario(ACESSO_ROTAS.pipeline);
  const filtros = lerFiltrosPipeline(await searchParams, usuario.papel);
  const comResponsavel = podeFiltrarResponsavelNoPipeline(usuario.papel);
  const [dados, opcoes, responsaveis] = await Promise.all([
    filtros.modo === "lista" ? listaDoPipeline(usuario, filtros) : quadroDoPipeline(usuario, filtros),
    opcoesDoPipeline(usuario),
    comResponsavel ? opcoesDeFiltro(usuario).then((o) => o.responsaveis) : [],
  ]);
  const podeMover = podeMudarEtapa(usuario.papel);
  const filtrosAtivos = (["responsavel", "origem", "campanha", "de", "ate", "etapa"] as const).filter((c) => filtros[c]).length;
  const contexto = { filtros, podeMover, comResponsavel };

  return (
    <div className="mx-auto max-w-[100rem]">
      <h1 className="text-2xl font-semibold sm:text-3xl">Pipeline</h1>
      <p className="mt-1 text-texto-suave">
        {usuario.papel === "vendas"
          ? "A etapa comercial dos leads dos quais você é responsável."
          : usuario.papel === "suporte"
            ? "A etapa comercial de todos os leads. Suporte acompanha, mas não muda a etapa."
            : "A etapa comercial de todos os leads. Independente da situação do teste."}
      </p>

      <nav aria-label="Modo de exibição" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Pilula href={urlDoPipeline(filtros, { modo: "quadro", pagina: 1 })} atual={filtros.modo === "quadro"}>
              Quadro
            </Pilula>
          </li>
          <li>
            <Pilula href={urlDoPipeline(filtros, { modo: "lista", pagina: 1 })} atual={filtros.modo === "lista"}>
              Lista
            </Pilula>
          </li>
        </ul>
      </nav>

      <form method="get" action="/pipeline" role="search" aria-label="Filtrar o pipeline" className="mt-6 space-y-3">
        {filtros.modo === "lista" && <input type="hidden" name="modo" value="lista" />}
        {filtros.tudo && <input type="hidden" name="tudo" value="1" />}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="q" className={rotulo}>
              Buscar por nome, e-mail ou WhatsApp
            </label>
            <input id="q" name="q" type="search" defaultValue={filtros.q} className={campo} autoComplete="off" />
          </div>
          <button type="submit" className={botao.primario}>
            Buscar
          </button>
        </div>
        <details open={filtrosAtivos > 0} className="rounded-2xl border border-borda bg-fundo">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">
            Filtros{filtros.modo === "lista" ? " e ordem" : ""}
            {filtrosAtivos > 0 ? ` (${filtrosAtivos} ${filtrosAtivos === 1 ? "ativo" : "ativos"})` : ""}
          </summary>
          <div className="grid gap-4 border-t border-borda p-4 sm:grid-cols-2 lg:grid-cols-4">
            {filtros.modo === "lista" && (
              <Seletor
                id="etapa"
                rotulo="Etapa comercial"
                valor={filtros.etapa}
                opcoes={ETAPAS_COMERCIAIS.map((e) => [e, ROTULO_ETAPA_COMERCIAL[e]])}
              />
            )}
            {comResponsavel && (
              <Seletor
                id="responsavel"
                rotulo="Responsável"
                valor={filtros.responsavel}
                opcoes={[["sem", "Sem responsável"], ...responsaveis.map((r): [string, string] => [r.id, r.nome])]}
              />
            )}
            <Seletor id="origem" rotulo="Origem (utm_source)" valor={filtros.origem} opcoes={opcoes.origens.map((o) => [o, o])} />
            <Seletor id="campanha" rotulo="Campanha (utm_campaign)" valor={filtros.campanha} opcoes={opcoes.campanhas.map((o) => [o, o])} />
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
            {filtros.modo === "lista" && (
              <>
                <Seletor
                  id="ordem"
                  rotulo="Ordenar por"
                  valor={filtros.ordem}
                  vazio={false}
                  opcoes={Object.entries(ROTULO_ORDEM).filter(([o]) => o !== "responsavel" || comResponsavel)}
                />
                <Seletor
                  id="dir"
                  rotulo="Direção"
                  valor={filtros.dir}
                  vazio={false}
                  opcoes={[
                    ["asc", "Crescente"],
                    ["desc", "Decrescente"],
                  ]}
                />
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-borda p-4">
            <button type="submit" className={botao.primario}>
              Aplicar filtros
            </button>
            <Link href={filtros.modo === "lista" ? "/pipeline?modo=lista" : "/pipeline"} className={botao.secundario}>
              Limpar
            </Link>
          </div>
        </details>
      </form>

      <p className="mt-4 text-sm text-texto-suave">
        {filtros.tudo ? (
          <>
            Mostrando todos os negócios fechados e perdidos.{" "}
            <Link href={urlDoPipeline(filtros, { tudo: false, pagina: 1 })} className="font-medium text-petroleo-forte underline underline-offset-4">
              Ver só os últimos {DIAS_PADRAO_FINAIS} dias
            </Link>
          </>
        ) : (
          <>
            Fechado e Perdido mostram só quem entrou nessas etapas nos últimos {DIAS_PADRAO_FINAIS} dias.{" "}
            <Link href={urlDoPipeline(filtros, { tudo: true, pagina: 1 })} className="font-medium text-petroleo-forte underline underline-offset-4">
              Ver todos
            </Link>
          </>
        )}
      </p>

      {"itens" in dados ? (
        <Lista dados={dados} {...contexto} />
      ) : (
        <Quadro colunas={dados} {...contexto} vazioVendas={usuario.papel === "vendas" && !filtros.q && filtrosAtivos === 0} />
      )}
    </div>
  );
}

const ROTULO_ORDEM: Record<OrdemPipeline, string> = {
  na_etapa: "Na etapa desde",
  nome: "Nome",
  etapa: "Etapa comercial",
  cadastro: "Data do cadastro",
  responsavel: "Responsável",
  origem: "Origem",
};

interface Contexto {
  filtros: FiltrosPipeline;
  podeMover: boolean;
  comResponsavel: boolean;
}

function Pilula({ href, atual, children }: { href: string; atual: boolean; children: React.ReactNode }) {
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

function dias(desde: Date): string {
  const n = numeroDeDias(desde);
  return n === 0 ? "entrou hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`;
}

const origemDoCartao = (c: CartaoDoPipeline) => `${c.source} / ${c.campaign}`;

// ── Quadro ──

function Quadro({ colunas, vazioVendas, ...ctx }: { colunas: ColunaDoPipeline[]; vazioVendas: boolean } & Contexto) {
  const total = colunas.reduce((s, c) => s + c.total, 0);
  return (
    <section aria-labelledby="titulo-quadro" className="mt-6">
      <h2 id="titulo-quadro" className="sr-only">
        Quadro
      </h2>
      <p className="mb-3 text-sm text-texto-suave" aria-live="polite">
        {total === 1 ? "1 lead" : `${total} leads`} no quadro. Role para o lado para ver todas as etapas.
      </p>
      {total === 0 && (
        <div className="mb-4">
          <Aviso tipo="info">{vazioVendas ? "Nenhum lead atribuído a você ainda." : "Nenhum lead encontrado com estes filtros."}</Aviso>
        </div>
      )}
      <div role="region" aria-label="Colunas do pipeline" tabIndex={0} className="relative -mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        <ol className="flex w-max snap-x snap-mandatory gap-4 sm:snap-none">
          {colunas.map((c) => (
            <li key={c.etapa} className="w-[min(18rem,80vw)] shrink-0 snap-start">
              <Coluna coluna={c} {...ctx} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Coluna({ coluna: c, ...ctx }: { coluna: ColunaDoPipeline } & Contexto) {
  const id = `coluna-${c.etapa}`;
  const faltam = c.total - c.cartoes.length;
  return (
    <section aria-labelledby={id} className="flex h-full flex-col rounded-2xl border border-borda bg-superficie">
      <header className="border-b border-borda px-3 py-3">
        <h3 className="flex items-center justify-between gap-2 font-semibold">
          <span id={id}>{ROTULO_ETAPA_COMERCIAL[c.etapa]}</span>
          <span className="rounded-full bg-fundo px-2 py-0.5 text-sm tabular-nums">
            {c.total}
            <span className="sr-only">{c.total === 1 ? " lead" : " leads"}</span>
          </span>
        </h3>
        {c.recortada && <p className="text-xs text-texto-suave">Últimos {DIAS_PADRAO_FINAIS} dias</p>}
      </header>
      {c.cartoes.length === 0 ? (
        <p className="p-3 text-sm text-texto-suave">Nenhum lead nesta etapa.</p>
      ) : (
        <ul className="space-y-3 p-3">
          {c.cartoes.map((cartao) => (
            <li key={cartao.id}>
              <Cartao cartao={cartao} {...ctx} />
            </li>
          ))}
        </ul>
      )}
      {faltam > 0 && (
        <div className="mt-auto border-t border-borda p-3">
          <Link
            href={`${urlDoPipeline(ctx.filtros, { [`n_${c.etapa}`]: c.cartoes.length + CARTOES_POR_COLUNA })}#${id}`}
            scroll={false}
            className={`${botao.secundario} w-full`}
          >
            Ver mais<span className="sr-only"> em {ROTULO_ETAPA_COMERCIAL[c.etapa]}</span> ({faltam} restantes)
          </Link>
        </div>
      )}
    </section>
  );
}

function Cartao({
  cartao: c,
  podeMover,
  comResponsavel,
  mostrarEtapa = false,
}: { cartao: CartaoDoPipeline; mostrarEtapa?: boolean } & Contexto) {
  return (
    <article aria-label={c.nome} className="rounded-xl border border-borda bg-fundo p-3 text-sm">
      <Link href={`/leads/${c.id}`} prefetch={false} className="font-semibold text-petroleo-forte underline underline-offset-4 wrap-anywhere">
        {c.nome}
      </Link>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        {mostrarEtapa && (
          <>
            <dt className="text-texto-suave">Etapa</dt>
            <dd>
              <EtiquetaComercial etapa={c.etapa} />
            </dd>
          </>
        )}
        <dt className="text-texto-suave">Na etapa</dt>
        <dd>{dias(c.na_etapa_desde)}</dd>
        <dt className="text-texto-suave">Origem</dt>
        <dd className="wrap-anywhere">{origemDoCartao(c)}</dd>
        {comResponsavel && (
          <>
            <dt className="text-texto-suave">Responsável</dt>
            <dd className="wrap-anywhere">{c.responsavel_nome ?? "sem responsável"}</dd>
          </>
        )}
        {c.etapa === ETAPA_PERDIDO && c.motivo_perda && (
          <>
            <dt className="text-texto-suave">Motivo</dt>
            <dd className="wrap-anywhere">{rotuloMotivo(c.motivo_perda)}</dd>
          </>
        )}
      </dl>
      {podeMover && (
        <div className="mt-3">
          <MudarEtapa leadId={c.id} nome={c.nome} etapa={c.etapa} modo="cartao" />
        </div>
      )}
    </article>
  );
}

// ── Lista ──

function Lista({ dados, ...ctx }: { dados: ListaDoPipeline } & Contexto) {
  const { filtros } = ctx;
  return (
    <section aria-labelledby="titulo-lista" className="mt-6">
      <h2 id="titulo-lista" className="sr-only">
        Lista
      </h2>
      <p className="mb-3 text-sm text-texto-suave" aria-live="polite">
        {dados.total === 1 ? "1 lead" : `${dados.total} leads`}
      </p>
      {dados.total === 0 ? (
        <Aviso tipo="info">Nenhum lead encontrado com estes filtros.</Aviso>
      ) : (
        <>
          <div role="region" aria-label="Tabela do pipeline" tabIndex={0} className="relative hidden overflow-x-auto rounded-2xl border border-borda bg-fundo lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Pipeline em lista, ordenado por {ROTULO_ORDEM[filtros.ordem].toLowerCase()}</caption>
              <thead className="border-b border-borda bg-superficie">
                <tr>
                  <Cabecalho ordem="nome" filtros={filtros}>Nome</Cabecalho>
                  <Cabecalho ordem="etapa" filtros={filtros}>Etapa comercial</Cabecalho>
                  <Cabecalho ordem="na_etapa" filtros={filtros}>Na etapa</Cabecalho>
                  <Cabecalho ordem="origem" filtros={filtros}>Origem</Cabecalho>
                  {ctx.comResponsavel && <Cabecalho ordem="responsavel" filtros={filtros}>Responsável</Cabecalho>}
                  <Cabecalho ordem="cadastro" filtros={filtros}>Cadastro</Cabecalho>
                  {ctx.podeMover && (
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Mudar etapa
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {dados.itens.map((c) => (
                  <tr key={c.id} className="align-top hover:bg-superficie">
                    <td className="px-3 py-3 font-medium wrap-anywhere">
                      <Link href={`/leads/${c.id}`} prefetch={false} className="text-petroleo-forte underline-offset-4 hover:underline">
                        {c.nome}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <EtiquetaComercial etapa={c.etapa} />
                      {c.etapa === ETAPA_PERDIDO && c.motivo_perda && (
                        <span className="mt-1 block text-texto-suave">{rotuloMotivo(c.motivo_perda)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{dias(c.na_etapa_desde)}</td>
                    <td className="px-3 py-3 wrap-anywhere">{origemDoCartao(c)}</td>
                    {ctx.comResponsavel && <td className="px-3 py-3 wrap-anywhere">{c.responsavel_nome ?? "sem responsável"}</td>}
                    <td className="px-3 py-3 whitespace-nowrap">{formatarData(c.created_at)}</td>
                    {ctx.podeMover && (
                      <td className="w-56 px-3 py-2">
                        <MudarEtapa leadId={c.id} nome={c.nome} etapa={c.etapa} modo="cartao" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 lg:hidden">
            {dados.itens.map((c) => (
              <li key={c.id}>
                <Cartao cartao={c} {...ctx} mostrarEtapa />
              </li>
            ))}
          </ul>
          <Paginacao filtros={filtros} pagina={dados.pagina} paginas={dados.paginas} />
        </>
      )}
    </section>
  );
}

function Cabecalho({ ordem, filtros, children }: { ordem: OrdemPipeline; filtros: FiltrosPipeline; children: React.ReactNode }) {
  const atual = filtros.ordem === ordem;
  const proxima = atual && filtros.dir === "asc" ? "desc" : "asc";
  return (
    <th scope="col" aria-sort={atual ? (filtros.dir === "asc" ? "ascending" : "descending") : undefined} className="px-3 py-2 text-left">
      <Link href={urlDoPipeline(filtros, { ordem, dir: proxima, pagina: 1 })} className="inline-flex min-h-11 items-center gap-1 font-semibold hover:underline">
        {children}
        <span aria-hidden="true">{atual ? (filtros.dir === "asc" ? "↑" : "↓") : ""}</span>
      </Link>
    </th>
  );
}

function Paginacao({ filtros, pagina, paginas }: { filtros: FiltrosPipeline; pagina: number; paginas: number }) {
  if (paginas <= 1) return null;
  return (
    <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-texto-suave">
        Página {pagina} de {paginas}
      </p>
      <div className="flex gap-2">
        {pagina > 1 && (
          <Link href={urlDoPipeline(filtros, { pagina: pagina - 1 })} className={botao.secundario} rel="prev">
            Anterior
          </Link>
        )}
        {pagina < paginas && (
          <Link href={urlDoPipeline(filtros, { pagina: pagina + 1 })} className={botao.secundario} rel="next">
            Próxima
          </Link>
        )}
      </div>
    </nav>
  );
}
