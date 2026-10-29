import type { Metadata } from "next";
import { Recorte } from "@/components/funil/Recorte";
import { Aviso } from "@/components/ui/Aviso";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { formatarNumero, formatarPercentual, formatarPontos } from "@/lib/formatos";
import { opcoesDoFunil } from "@/lib/funil";
import { ACESSO_ROTAS } from "@/lib/papeis";
import {
  AMOSTRA_MINIMA_GRUPO,
  DIFERENCA_RELEVANTE,
  perfilDosLeads,
  type Celula,
  type PerfilDosLeads,
  type PerguntaDoPerfil,
  type TermosDoPerfil,
} from "@/lib/perfil";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Perfil dos leads" };

const PONTOS_RELEVANTES = Math.round(DIFERENCA_RELEVANTE * 100);

export default async function PaginaPerfil({ searchParams }: PageProps<"/perfil">) {
  const usuario = await exigirUsuario(ACESSO_ROTAS.perfil);
  const filtros = lerFiltrosFunil(await searchParams);
  const [perfil, opcoes] = await Promise.all([perfilDosLeads(filtros, usuario.papel), opcoesDoFunil()]);
  const vazio = perfil.cadastros === 0;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Perfil dos leads</h1>
      <p className="mt-1 text-texto-suave">
        Como os cadastros responderam a ativação, com os mesmos cortes do funil (o período escolhe pela data do
        cadastro). Só números agregados.
      </p>

      <Recorte caminho="/perfil" rotulo="Cortes do perfil" filtros={filtros} opcoes={opcoes} />

      <div className="mt-4 space-y-3">
        <Aviso tipo="info">
          “Agendou” pode estar subestimado: a data do agendamento vem do navegador da pessoa (o Calendly avisa a
          página), e não é gravada quando ela fecha a aba antes disso. Parte de quem aparece em “não agendou” pode ter
          agendado.
        </Aviso>
        {perfil.ocultaAbaixoDe !== null && (
          <Aviso tipo="info">
            No seu acesso (leitura), números de 1 a {perfil.ocultaAbaixoDe - 1} pessoas aparecem como “oculto”, e
            também algum outro número que permitiria descobri-los pela diferença do total.
          </Aviso>
        )}
        {vazio && <Aviso tipo="info">Nenhum cadastro neste recorte.</Aviso>}
      </div>

      <Resumo perfil={perfil} />

      {!vazio && (
        <>
          <section aria-labelledby="titulo-distribuicoes" className="mt-10">
            <h2 id="titulo-distribuicoes" className="text-xl font-semibold">
              Respostas da ativação
            </h2>
            <p className="mt-1 text-sm text-texto-suave">
              Todos os cadastros do recorte. O percentual é sobre quem respondeu a pergunta; quem não respondeu (inclusive
              quem não abriu a ativação) aparece à parte.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {perfil.perguntas.map((p) => (
                <Distribuicao key={p.campo} p={p} />
              ))}
            </div>
          </section>

          <section aria-labelledby="titulo-comparacao" className="mt-10">
            <h2 id="titulo-comparacao" className="text-xl font-semibold">
              Quem agendou × quem não agendou
            </h2>
            <p className="mt-1 text-sm text-texto-suave">
              Só quem completou a ativação, separado entre quem chegou a agendar e quem não chegou. Cada percentual é
              sobre quem respondeu, dentro do grupo. A diferença é em pontos percentuais (agendou menos não agendou) e
              fica destacada a partir de {PONTOS_RELEVANTES} pontos, só quando os dois grupos têm pelo menos{" "}
              {AMOSTRA_MINIMA_GRUPO} respostas. É uma comparação descritiva: mostra o que aparece junto, não o que causa
              o agendamento, e não usa teste estatístico. Para comparar por criativo, escolha o criativo nos cortes.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {perfil.perguntas.map((p) => (
                <Comparacao key={p.campo} p={p} />
              ))}
            </div>
          </section>

          <section aria-labelledby="titulo-termos" className="mt-10">
            <h2 id="titulo-termos" className="text-xl font-semibold">
              Cidades e negócios
            </h2>
            <p className="mt-1 text-sm text-texto-suave">
              São respostas de texto livre. Cada resposta foi normalizada de forma simples (minúsculas, sem acentos, sem
              pontuação e com os espaços juntados) e contada como um termo; não há categorias nem agrupamento por
              semelhança (a classificação com IA é de uma fase posterior). Termos de poucas pessoas podem identificar
              alguém e entram em “outros”.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {perfil.termos.map((t) => (
                <Termos key={t.campo} t={t} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ── Peças ──

function Oculto() {
  return <span className="text-texto-suave">oculto</span>;
}

const numero = (n: number | null) => (n === null ? <Oculto /> : formatarNumero(n));
const percentual = (v: number | null) => (v === null ? "—" : formatarPercentual(v));

/** Barra horizontal decorativa (o número está ao lado). SVG com atributos: a CSP não deixa `style`. */
function Barra({ fracao, cor }: { fracao: number | null; cor: "forte" | "suave" }) {
  if (fracao === null) return null;
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-1 block h-1.5 w-full">
      <rect width="100" height="6" className="fill-borda" />
      <rect width={Math.min(100, fracao * 100)} height="6" className={cor === "forte" ? "fill-petroleo-forte" : "fill-texto-suave"} />
    </svg>
  );
}

function SemMapa() {
  return (
    <span className="ml-1 inline-block rounded-full bg-atencao-suave px-2 py-0.5 text-xs font-medium text-atencao">
      chave sem texto no mapa
    </span>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block w-fit rounded-full bg-atencao-suave px-2 py-0.5 text-xs font-medium text-atencao">
      {children}
    </span>
  );
}

function Resumo({ perfil }: { perfil: PerfilDosLeads }) {
  return (
    <section aria-labelledby="titulo-resumo" className="mt-8">
      <h2 id="titulo-resumo" className="text-xl font-semibold">
        Total considerado
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao titulo="Cadastros" valor={numero(perfil.cadastros)} detalhe="no recorte (base das respostas)" />
        <Cartao titulo="Completaram a ativação" valor={numero(perfil.completaram)} detalhe="base da comparação" />
        <Cartao titulo="Agendaram" valor={numero(perfil.agendaram)} detalhe="entre os que completaram" />
        <Cartao titulo="Não agendaram" valor={numero(perfil.naoAgendaram)} detalhe="entre os que completaram" />
      </dl>
    </section>
  );
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

function Distribuicao({ p }: { p: PerguntaDoPerfil }) {
  const d = p.distribuicao;
  return (
    <div className="min-w-0 rounded-2xl border border-borda bg-fundo p-4">
      <h3 className="font-semibold">{p.pergunta}</h3>
      <p className="mt-1 text-sm text-texto-suave">
        {numero(d.respondidos)} responderam e {numero(d.naoResponderam)} não responderam, de {numero(d.total)} cadastros.
      </p>
      <div role="region" aria-label={`Respostas: ${p.pergunta}`} tabIndex={0} className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{p.pergunta}: pessoas por resposta e percentual sobre quem respondeu</caption>
          <thead className="border-b border-borda">
            <tr>
              <th scope="col" className="py-2 pr-2 text-left">Resposta</th>
              <th scope="col" className="px-2 py-2 text-right">Pessoas</th>
              <th scope="col" className="py-2 pl-2 text-right">Das respostas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {d.opcoes.map((o) => (
              <tr key={o.chave}>
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  <span className="break-words">{o.texto}</span>
                  {o.semMapa && <SemMapa />}
                  <Barra fracao={o.percentual} cor="forte" />
                </th>
                <td className="px-2 py-2 text-right align-top tabular-nums">{numero(o.pessoas)}</td>
                <td className="py-2 pl-2 text-right align-top tabular-nums">{percentual(o.percentual)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="py-2 pr-2 text-left font-normal text-texto-suave">Não responderam (fora do percentual)</th>
              <td className="px-2 py-2 text-right align-top tabular-nums">{numero(d.naoResponderam)}</td>
              <td className="py-2 pl-2 text-right align-top">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CelulaComparada({ c, cor }: { c: Celula; cor: "forte" | "suave" }) {
  return (
    <>
      <span className="block font-medium">{percentual(c.percentual)}</span>
      <span className="block text-xs text-texto-suave">{c.pessoas === null ? <Oculto /> : `${formatarNumero(c.pessoas)} ${c.pessoas === 1 ? "pessoa" : "pessoas"}`}</span>
      <Barra fracao={c.percentual} cor={cor} />
    </>
  );
}

function Comparacao({ p }: { p: PerguntaDoPerfil }) {
  const c = p.comparacao;
  return (
    <div className="min-w-0 rounded-2xl border border-borda bg-fundo p-4">
      <h3 className="font-semibold">{p.pergunta}</h3>
      <p className="mt-1 text-sm text-texto-suave">
        Responderam: {numero(c.agendou.respondidos)} que agendaram e {numero(c.naoAgendou.respondidos)} que não agendaram.
      </p>
      {c.amostraPequena && (
        <p className="mt-2 text-sm">
          <Selo>amostra pequena</Selo>{" "}
          <span className="text-texto-suave">
            Algum grupo tem menos de {AMOSTRA_MINIMA_GRUPO} respostas; nenhuma diferença é destacada.
          </span>
        </p>
      )}
      <div role="region" aria-label={`Comparação: ${p.pergunta}`} tabIndex={0} className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {p.pergunta}: percentual de cada resposta entre quem agendou e quem não agendou, e a diferença em pontos
            percentuais
          </caption>
          <thead className="border-b border-borda">
            <tr>
              <th scope="col" className="py-2 pr-2 text-left">Resposta</th>
              <th scope="col" className="px-2 py-2 text-right">Agendou</th>
              <th scope="col" className="px-2 py-2 text-right">Não agendou</th>
              <th scope="col" className="py-2 pl-2 text-right">Diferença</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {c.linhas.map((l) => (
              <tr key={l.chave} className={l.destaque ? "bg-petroleo-suave" : undefined}>
                <th scope="row" className="py-2 pr-2 text-left align-top font-normal">
                  <span className="break-words">{l.texto}</span>
                  {l.semMapa && <SemMapa />}
                </th>
                <td className="px-2 py-2 text-right align-top whitespace-nowrap tabular-nums">
                  <CelulaComparada c={l.agendou} cor="forte" />
                </td>
                <td className="px-2 py-2 text-right align-top whitespace-nowrap tabular-nums">
                  <CelulaComparada c={l.naoAgendou} cor="suave" />
                </td>
                <td className="py-2 pl-2 text-right align-top whitespace-nowrap tabular-nums">
                  {l.diferenca === null ? "—" : <span className={l.destaque ? "font-semibold" : undefined}>{formatarPontos(l.diferenca)}</span>}
                  {l.destaque && <span className="block text-xs font-medium text-petroleo-escuro">diferença relevante</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Termos({ t }: { t: TermosDoPerfil }) {
  return (
    <div className="min-w-0 rounded-2xl border border-borda bg-fundo p-4">
      <h3 className="font-semibold">{t.titulo}</h3>
      <p className="mt-1 text-sm text-texto-suave">
        {numero(t.respondidos)} responderam e {numero(t.naoResponderam)} não responderam. Aparecem até 20 termos, cada um de
        pelo menos {t.minimoPorTermo} pessoas; o resto fica somado em “outros”.
      </p>
      <div role="region" aria-label={`Termos mais frequentes: ${t.titulo}`} tabIndex={0} className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t.titulo}: termos mais frequentes e quantas pessoas escreveram cada um</caption>
          <thead className="border-b border-borda">
            <tr>
              <th scope="col" className="py-2 pr-2 text-left">Termo</th>
              <th scope="col" className="py-2 pl-2 text-right">Pessoas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {t.termos.length === 0 && (
              <tr>
                <td colSpan={2} className="py-2 text-texto-suave">
                  Nenhum termo com pelo menos {t.minimoPorTermo} pessoas.
                </td>
              </tr>
            )}
            {t.termos.map((x) => (
              <tr key={x.termo}>
                <th scope="row" className="py-2 pr-2 text-left font-normal break-words">{x.termo}</th>
                <td className="py-2 pl-2 text-right tabular-nums">{formatarNumero(x.pessoas)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="py-2 pr-2 text-left font-normal text-texto-suave">
                Outros (demais respostas, somadas)
              </th>
              <td className="py-2 pl-2 text-right tabular-nums">{numero(t.outros)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
