import type { Metadata } from "next";
import Link from "next/link";
import { EtiquetaEtapa } from "@/components/leads/EtiquetaEtapa";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { ETAPAS, ROTULO_ETAPA } from "@/lib/etapas";
import {
  lerFiltros,
  podeFiltrarResponsavel,
  ROTULO_VISAO,
  urlDaLista,
  VERSOES,
  VISOES,
  type FiltrosLeads,
  type Ordem,
} from "@/lib/filtrosLeads";
import { formatarData, formatarDataHora, tempoDesde } from "@/lib/formatos";
import { listarLeads, opcoesDeFiltro, type ItemLista } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Leads" };

const SEM_DADOS = "sem dados";

export default async function PaginaLeads({ searchParams }: PageProps<"/leads">) {
  const usuario = await exigirUsuario(ACESSO_ROTAS.leads);
  const filtros = lerFiltros(await searchParams, usuario.papel);
  const [pagina, opcoes] = await Promise.all([listarLeads(usuario, filtros), opcoesDeFiltro(usuario)]);

  const visoes = VISOES.filter((v) => v !== "sem_responsavel" || usuario.papel === "admin");
  const mostrarParado = filtros.visao === "parados";
  const filtrosAtivos = (["status", "criativo", "campanha", "versao", "de", "ate", "responsavel"] as const).filter(
    (c) => filtros[c],
  ).length;
  const semDadosDaVisao = filtros.visao === "agendados_semana" && !pagina.temDadosDeReuniao;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Leads</h1>
      <p className="mt-1 text-texto-suave">
        {usuario.papel === "vendas"
          ? "Os cadastros do teste grátis dos quais você é responsável."
          : "Os cadastros do teste grátis de 7 dias."}
      </p>

      <nav aria-label="Visões" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          <li>
            <LinkVisao href={urlDaLista(filtros, { visao: undefined, ordem: undefined, dir: undefined, pagina: 1 })} atual={!filtros.visao}>
              Todos
            </LinkVisao>
          </li>
          {visoes.map((v) => (
            <li key={v}>
              <LinkVisao
                href={urlDaLista(filtros, { visao: v, ordem: undefined, dir: undefined, pagina: 1 })}
                atual={filtros.visao === v}
              >
                {ROTULO_VISAO[v]}
              </LinkVisao>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" action="/leads" role="search" aria-label="Filtrar leads" className="mt-6 space-y-3">
        {filtros.visao && <input type="hidden" name="visao" value={filtros.visao} />}
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
            Filtros e ordem{filtrosAtivos > 0 ? ` (${filtrosAtivos} ${filtrosAtivos === 1 ? "ativo" : "ativos"})` : ""}
          </summary>
          <div className="grid gap-4 border-t border-borda p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Seletor id="status" rotulo="Etapa" valor={filtros.status} opcoes={ETAPAS.map((e) => [e, ROTULO_ETAPA[e]])} />
            <Seletor id="criativo" rotulo="Criativo" valor={filtros.criativo} opcoes={opcoes.criativos.map((c) => [c, c])} />
            <Seletor id="campanha" rotulo="Campanha" valor={filtros.campanha} opcoes={opcoes.campanhas.map((c) => [c, c])} />
            <Seletor id="versao" rotulo="Versão do título" valor={filtros.versao} opcoes={VERSOES.map((v) => [v, v])} />
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
            {podeFiltrarResponsavel(usuario.papel) && (
              <Seletor
                id="responsavel"
                rotulo="Responsável"
                valor={filtros.responsavel}
                opcoes={[["sem", "Sem responsável"], ...opcoes.responsaveis.map((r): [string, string] => [r.id, r.nome])]}
              />
            )}
            <Seletor
              id="ordem"
              rotulo="Ordenar por"
              valor={filtros.ordem}
              vazio={false}
              opcoes={Object.entries(ROTULO_ORDEM).filter(([o]) => o !== "parado" || mostrarParado)}
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
          </div>
          <div className="flex flex-wrap gap-2 border-t border-borda p-4">
            <button type="submit" className={botao.primario}>
              Aplicar filtros
            </button>
            <Link href={filtros.visao ? `/leads?visao=${filtros.visao}` : "/leads"} className={botao.secundario}>
              Limpar
            </Link>
          </div>
        </details>
      </form>

      <section aria-labelledby="titulo-resultado" className="mt-6">
        <h2 id="titulo-resultado" className="sr-only">
          Resultado
        </h2>
        <p className="mb-3 text-sm text-texto-suave" aria-live="polite">
          {pagina.total === 1 ? "1 lead" : `${pagina.total} leads`}
          {filtros.visao ? ` em “${ROTULO_VISAO[filtros.visao]}”` : ""}
        </p>

        {semDadosDaVisao ? (
          <Aviso tipo="info">
            Sem dados de reunião ainda. A data da reunião não é preenchida por nenhum fluxo por enquanto, então esta
            visão fica vazia até isso existir.
          </Aviso>
        ) : pagina.total === 0 ? (
          <Aviso tipo="info">
            {usuario.papel === "vendas" && !filtros.q && !filtrosAtivos && !filtros.visao
              ? "Nenhum lead atribuído a você ainda."
              : "Nenhum lead encontrado com estes filtros."}
          </Aviso>
        ) : (
          <>
            <TabelaLeads itens={pagina.itens} filtros={filtros} mostrarParado={mostrarParado} />
            <CartoesLeads itens={pagina.itens} mostrarParado={mostrarParado} />
            <Paginacao filtros={filtros} pagina={pagina.pagina} paginas={pagina.paginas} />
          </>
        )}
      </section>
    </div>
  );
}

const ROTULO_ORDEM: Record<Ordem, string> = {
  cadastro: "Data do cadastro",
  nome: "Nome",
  etapa: "Etapa",
  criativo: "Criativo",
  versao: "Versão do título",
  responsavel: "Responsável",
  reuniao: "Reunião",
  parado: "Tempo parado",
};

function LinkVisao({ href, atual, children }: { href: string; atual: boolean; children: React.ReactNode }) {
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

function Seletor(props: {
  id: string;
  rotulo: string;
  valor: string | undefined;
  opcoes: [string, string][];
  vazio?: boolean;
}) {
  return (
    <div>
      <label htmlFor={props.id} className={rotulo}>
        {props.rotulo}
      </label>
      <select id={props.id} name={props.id} defaultValue={props.valor ?? ""} className={campo}>
        {props.vazio !== false && <option value="">Todos</option>}
        {props.opcoes.map(([valor, texto]) => (
          <option key={valor} value={valor}>
            {texto}
          </option>
        ))}
      </select>
    </div>
  );
}

function Reuniao({ data }: { data: Date | null }) {
  return data ? <>{formatarDataHora(data)}</> : <span className="text-texto-suave">{SEM_DADOS}</span>;
}

function CabecalhoOrdenavel({ ordem, filtros, children }: { ordem: Ordem; filtros: FiltrosLeads; children: React.ReactNode }) {
  const atual = filtros.ordem === ordem;
  const proxima = atual && filtros.dir === "asc" ? "desc" : "asc";
  return (
    <th scope="col" aria-sort={atual ? (filtros.dir === "asc" ? "ascending" : "descending") : undefined} className="px-3 py-2 text-left">
      <Link href={urlDaLista(filtros, { ordem, dir: proxima, pagina: 1 })} className="inline-flex min-h-11 items-center gap-1 font-semibold hover:underline">
        {children}
        <span aria-hidden="true">{atual ? (filtros.dir === "asc" ? "↑" : "↓") : ""}</span>
      </Link>
    </th>
  );
}

/** Tabela, a partir de 1024px. */
function TabelaLeads({ itens, filtros, mostrarParado }: { itens: ItemLista[]; filtros: FiltrosLeads; mostrarParado: boolean }) {
  return (
    // Com texto ampliado a tabela pode passar da largura: rola dentro da
    // própria área (focável, pra rolar pelo teclado), sem cortar nada.
    <div
      role="region"
      aria-label="Tabela de leads"
      tabIndex={0}
      className="hidden overflow-x-auto rounded-2xl border border-borda bg-fundo lg:block"
    >
      <table className="w-full text-sm">
        <caption className="sr-only">Leads, ordenados por {ROTULO_ORDEM[filtros.ordem].toLowerCase()}</caption>
        <thead className="border-b border-borda bg-superficie">
          <tr>
            <CabecalhoOrdenavel ordem="nome" filtros={filtros}>Nome</CabecalhoOrdenavel>
            <CabecalhoOrdenavel ordem="etapa" filtros={filtros}>Etapa</CabecalhoOrdenavel>
            {mostrarParado && <CabecalhoOrdenavel ordem="parado" filtros={filtros}>Parado há</CabecalhoOrdenavel>}
            <CabecalhoOrdenavel ordem="criativo" filtros={filtros}>Criativo</CabecalhoOrdenavel>
            <CabecalhoOrdenavel ordem="versao" filtros={filtros}>Versão</CabecalhoOrdenavel>
            <CabecalhoOrdenavel ordem="cadastro" filtros={filtros}>Cadastro</CabecalhoOrdenavel>
            <CabecalhoOrdenavel ordem="responsavel" filtros={filtros}>Responsável</CabecalhoOrdenavel>
            <CabecalhoOrdenavel ordem="reuniao" filtros={filtros}>Reunião</CabecalhoOrdenavel>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {itens.map((lead) => (
            <tr key={lead.id} className="hover:bg-superficie">
              <td className="px-3 py-3 font-medium wrap-anywhere">
                <Link href={`/leads/${lead.id}`} prefetch={false} className="text-petroleo-forte underline-offset-4 hover:underline">
                  {lead.nome}
                </Link>
              </td>
              <td className="px-3 py-3"><EtiquetaEtapa status={lead.status} /></td>
              {mostrarParado && <td className="px-3 py-3 whitespace-nowrap">{tempoDesde(lead.parado_desde)}</td>}
              <td className="px-3 py-3 wrap-anywhere">{lead.utm_content ?? <Vazio />}</td>
              <td className="px-3 py-3">{lead.lp_variant ?? <Vazio />}</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatarData(lead.created_at)}</td>
              <td className="px-3 py-3 wrap-anywhere">{lead.responsavel_nome ?? <Vazio texto="sem responsável" />}</td>
              <td className="px-3 py-3 whitespace-nowrap"><Reuniao data={lead.reuniao_em} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Vazio({ texto = "—" }: { texto?: string }) {
  return <span className="text-texto-suave">{texto}</span>;
}

/** Cartões, abaixo de 1024px. */
function CartoesLeads({ itens, mostrarParado }: { itens: ItemLista[]; mostrarParado: boolean }) {
  return (
    <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-fundo lg:hidden">
      {itens.map((lead) => (
        <li key={lead.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={`/leads/${lead.id}`} prefetch={false} className="font-semibold text-petroleo-forte underline underline-offset-4 wrap-anywhere">
              {lead.nome}
            </Link>
            <EtiquetaEtapa status={lead.status} />
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {mostrarParado && <Par termo="Parado há" valor={tempoDesde(lead.parado_desde)} />}
            <Par termo="Criativo" valor={lead.utm_content ?? <Vazio />} />
            <Par termo="Versão" valor={lead.lp_variant ?? <Vazio />} />
            <Par termo="Cadastro" valor={formatarData(lead.created_at)} />
            <Par termo="Responsável" valor={lead.responsavel_nome ?? <Vazio texto="sem responsável" />} />
            <Par termo="Reunião" valor={<Reuniao data={lead.reuniao_em} />} />
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Par({ termo, valor }: { termo: string; valor: React.ReactNode }) {
  return (
    <>
      <dt className="text-texto-suave">{termo}</dt>
      <dd className="wrap-anywhere">{valor}</dd>
    </>
  );
}

function Paginacao({ filtros, pagina, paginas }: { filtros: FiltrosLeads; pagina: number; paginas: number }) {
  if (paginas <= 1) return null;
  return (
    <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-texto-suave">
        Página {pagina} de {paginas}
      </p>
      <div className="flex gap-2">
        {pagina > 1 && (
          <Link href={urlDaLista(filtros, { pagina: pagina - 1 })} className={botao.secundario} rel="prev">
            Anterior
          </Link>
        )}
        {pagina < paginas && (
          <Link href={urlDaLista(filtros, { pagina: pagina + 1 })} className={botao.secundario} rel="next">
            Próxima
          </Link>
        )}
      </div>
    </nav>
  );
}
