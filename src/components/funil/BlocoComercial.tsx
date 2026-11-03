import { Aviso } from "@/components/ui/Aviso";
import { ROTULO_ETAPA_COMERCIAL } from "@/config/pipeline";
import { AMOSTRA_MINIMA } from "@/lib/filtrosFunil";
import { formatarDuracao, formatarNumero, formatarPercentual } from "@/lib/formatos";
import { taxa } from "@/lib/funil";
import type { CorteComercial, FunilComercial } from "@/lib/funilComercial";

/**
 * Bloco "Funil comercial" da tela Funil: etapa de hoje, quem chegou a cada
 * etapa, tempo mediano por etapa, perdidos e cortes. Só agregados; o que
 * vem null do servidor (oculto para "leitura") aparece como "oculto".
 */
export function BlocoComercial({ dados }: { dados: FunilComercial }) {
  const vazio = dados.total === 0;
  return (
    <section aria-labelledby="titulo-comercial" className="mt-10">
      <h2 id="titulo-comercial" className="text-xl font-semibold">
        Funil comercial
      </h2>
      <p className="mt-1 text-sm text-texto-suave">
        Etapas do pipeline para os cadastros do recorte acima (as mesmas datas e filtros). Lead sem etapa registrada conta como
        “Não contatado”. Quem pulou etapas conta como tendo chegado às anteriores. Cadastros mesclados em outro não contam.
      </p>
      <div className="mt-4 space-y-3">
        {dados.ocultaAbaixoDe !== null && (
          <Aviso tipo="info">
            Para o seu papel, números de 1 a {dados.ocultaAbaixoDe - 1} leads ficam ocultos, assim como os que permitiriam
            descobri-los por subtração.
          </Aviso>
        )}
        {vazio ? (
          <Aviso tipo="info">Nenhum cadastro neste recorte.</Aviso>
        ) : (
          dados.amostraPequena && (
            <Aviso tipo="info">
              Amostra pequena: menos de {AMOSTRA_MINIMA} leads neste recorte. As taxas podem mudar muito com poucos casos.
            </Aviso>
          )
        )}
      </div>

      {!vazio && (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Tabela
              id="comercial-hoje"
              titulo="Em cada etapa hoje"
              colunas={["Etapa", "Leads", "Do total"]}
              linhas={dados.atual.map((a) => [ROTULO_ETAPA_COMERCIAL[a.etapa], num(a.leads), pct(taxa(a.leads, dados.total))])}
            />
            <Tabela
              id="comercial-chegaram"
              titulo="Chegaram a pelo menos esta etapa"
              colunas={["Etapa", "Leads", "Passaram para a seguinte"]}
              linhas={dados.chegaram.map((c) => [ROTULO_ETAPA_COMERCIAL[c.etapa], num(c.leads), c.etapa === "negocio_fechado" ? "—" : pct(c.passagem)])}
            />
            <Tabela
              id="comercial-tempo"
              titulo="Tempo mediano em cada etapa"
              nota="Do histórico de mudanças: do cadastro (ou da mudança anterior) até a mudança seguinte. A etapa em que o lead está hoje não entra."
              colunas={["Etapa", "Mediana", "Mudanças a partir dela"]}
              linhas={dados.tempos.map((t) => [
                ROTULO_ETAPA_COMERCIAL[t.etapa],
                t.mediana === null ? (t.passagens === 0 ? "—" : <Oculto />) : formatarDuracao(t.mediana),
                num(t.passagens),
              ])}
            />
            <div>
              <h3 id="comercial-perdidos" className="font-semibold">
                Perdidos: {dados.perdidos.total === null ? <Oculto /> : formatarNumero(dados.perdidos.total)}
              </h3>
              <Tabela
                id="comercial-motivo"
                titulo="Por motivo"
                nivel={4}
                colunas={["Motivo", "Leads"]}
                linhas={dados.perdidos.porMotivo.map((m) => [m.rotulo, num(m.leads)])}
              />
              <Tabela
                id="comercial-perdido-em"
                titulo="Por etapa em que estavam quando foram perdidos"
                nivel={4}
                colunas={["Etapa", "Leads"]}
                linhas={dados.perdidos.porEtapa.map((m) => [ROTULO_ETAPA_COMERCIAL[m.etapa], num(m.leads)])}
              />
            </div>
          </div>

          <h3 className="mt-8 font-semibold">Cortes</h3>
          <p className="mt-1 text-sm text-texto-suave">
            Reunião e negociação: chegaram a pelo menos essa etapa. Fechados: chegaram a “Negócio fechado”. Perdidos: estão hoje
            em “Negócio perdido”. Grupos com menos de {AMOSTRA_MINIMA} leads ficam marcados como amostra pequena.
          </p>
          <TabelaDeCorte id="corte-origem" titulo="Por origem (source / medium / campaign)" corte={dados.cortes.origem} />
          <TabelaDeCorte id="corte-situacao" titulo="Por situação do teste" corte={dados.cortes.situacao} />
          {dados.cortes.responsavel && <TabelaDeCorte id="corte-responsavel" titulo="Por responsável" corte={dados.cortes.responsavel} />}
        </>
      )}
    </section>
  );
}

const pct = (v: number | null) => (v === null ? "—" : formatarPercentual(v));

function Oculto() {
  return <span className="text-texto-suave">oculto</span>;
}

function num(v: number | null) {
  return v === null ? <Oculto /> : formatarNumero(v);
}

function Tabela(props: {
  id: string;
  titulo: string;
  nota?: string;
  nivel?: 3 | 4;
  colunas: string[];
  linhas: React.ReactNode[][];
}) {
  const Titulo = props.nivel === 4 ? "h4" : "h3";
  return (
    <div className="mt-3 min-w-0">
      <Titulo id={props.id} className={props.nivel === 4 ? "text-sm font-semibold" : "font-semibold"}>
        {props.titulo}
      </Titulo>
      {props.nota && <p className="mt-1 text-sm text-texto-suave">{props.nota}</p>}
      <div role="region" aria-labelledby={props.id} tabIndex={0} className="relative mt-2 overflow-x-auto rounded-2xl border border-borda bg-fundo">
        <table className="w-full text-sm">
          <caption className="sr-only">{props.titulo}</caption>
          <thead className="border-b border-borda bg-superficie">
            <tr>
              {props.colunas.map((c, k) => (
                <th key={c} scope="col" className={`px-3 py-2 ${k === 0 ? "text-left" : "text-right"}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {props.linhas.map((l, i) => (
              <tr key={i}>
                {l.map((v, k) =>
                  k === 0 ? (
                    <th key={k} scope="row" className="px-3 py-2 text-left font-medium wrap-anywhere">
                      {v}
                    </th>
                  ) : (
                    <td key={k} className="px-3 py-2 text-right tabular-nums">
                      {v}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabelaDeCorte({ id, titulo, corte }: { id: string; titulo: string; corte: CorteComercial }) {
  return (
    <div className="mt-6">
      <h4 id={id} className="font-semibold">
        {titulo}
      </h4>
      {corte.linhas.length === 0 && !corte.outras ? (
        <p className="mt-2 text-sm text-texto-suave">Nenhum lead neste recorte.</p>
      ) : (
        <div role="region" aria-labelledby={id} tabIndex={0} className="relative mt-2 overflow-x-auto rounded-2xl border border-borda bg-fundo">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">{titulo}</caption>
            <thead className="border-b border-borda bg-superficie">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Grupo</th>
                <th scope="col" className="px-3 py-2 text-right">Leads</th>
                <th scope="col" className="px-3 py-2 text-right">Reunião marcada</th>
                <th scope="col" className="px-3 py-2 text-right">Negociação</th>
                <th scope="col" className="px-3 py-2 text-right">Fechados</th>
                <th scope="col" className="px-3 py-2 text-right">Perdidos</th>
                <th scope="col" className="px-3 py-2 text-right">Fechados / leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {corte.linhas.map((l) => (
                <tr key={l.grupo}>
                  <th scope="row" className="px-3 py-2 text-left font-medium wrap-anywhere">
                    {l.grupo}
                    {l.amostraPequena && (
                      <span className="mt-1 block w-fit rounded-full bg-atencao-suave px-2 py-0.5 text-xs font-medium text-atencao">
                        amostra pequena
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{formatarNumero(l.leads)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(l.reuniao)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(l.negociacao)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(l.fechados)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(l.perdidos)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(l.taxaFechamento)}</td>
                </tr>
              ))}
              {corte.outras && (
                <tr className="bg-superficie">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    Outros grupos (ocultos)
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{num(corte.outras.leads)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(corte.outras.reuniao)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(corte.outras.negociacao)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(corte.outras.fechados)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(corte.outras.perdidos)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(corte.outras.taxaFechamento)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
