import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { AtribuirResponsavel } from "@/components/leads/AtribuirResponsavel";
import { CopiarLinkAtivacao } from "@/components/leads/CopiarLinkAtivacao";
import { MarcarReuniao } from "@/components/leads/MarcarReuniao";
import { Checklist } from "@/components/leads/Checklist";
import { DesfazerMescla } from "@/components/leads/DesfazerMescla";
import { EtiquetaEtapa } from "@/components/leads/EtiquetaEtapa";
import { MesclarLead, type Cadastro } from "@/components/leads/MesclarLead";
import { NovaAnotacao } from "@/components/leads/NovaAnotacao";
import { EtiquetaComercial } from "@/components/pipeline/EtiquetaComercial";
import { MudarEtapa } from "@/components/pipeline/MudarEtapa";
import { Aviso } from "@/components/ui/Aviso";
import { botao } from "@/components/ui/estilos";
import { MENSAGEM_WHATSAPP, MENSAGEM_WHATSAPP_MANUAL, VALIDADE_LINK_ATIVACAO_DIAS } from "@/config/contato";
import { ETAPA_PERDIDO, posicaoDaEtapa, rotuloEtapaComercial, rotuloMotivo } from "@/config/pipeline";
import { anotacoesDe, podeAnotar, type Anotacao } from "@/lib/anotacoes";
import { rotuloEtapa } from "@/lib/etapas";
import {
  diasDesde,
  formatarData,
  formatarDataHora,
  formatarWhatsapp,
  passouDias,
  preencherMensagem,
  primeiroNome,
} from "@/lib/formatos";
import { abrirFicha, principalVisivelDe, type Ficha } from "@/lib/leads";
import { cadastrosMescladosEm, duplicadosSugeridosPara, podeMesclar, type CadastroMesclado } from "@/lib/mescla";
import { historicoDeEtapas, podeMudarEtapa, type MudancaNoHistorico } from "@/lib/pipeline";
import { responsaveisPossiveis } from "@/lib/atribuicao";
import { ACESSO_ROTAS, podeAcessar } from "@/lib/papeis";
import { marcacaoDesfazivel, PRAZO_DESFAZER_HORAS } from "@/lib/reuniao";
import { checklistDeProntidao, textoDaResposta, type Resposta } from "@/lib/respostas";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Ficha do lead" };

export default async function PaginaFicha({ params, searchParams }: PageProps<"/leads/[id]">) {
  const usuario = await exigirUsuario(ACESSO_ROTAS.leads);
  // Lead alheio (vendas) ou inexistente: 404, sem diferença entre os dois.
  const id = (await params).id;
  const lead = await abrirFicha(usuario, id, "tela");
  if (!lead) {
    // Cadastro mesclado em outro: vai para a ficha do principal (se ela for visível).
    const principal = await principalVisivelDe(usuario, id);
    if (principal) redirect(`/leads/${principal}`);
    notFound();
  }

  // Lead cadastrado à mão não "se cadastrou no teste": mensagem própria.
  const mensagem = preencherMensagem(lead.cadastro_manual ? MENSAGEM_WHATSAPP_MANUAL : MENSAGEM_WHATSAPP, {
    nome: primeiroNome(lead.nome),
    atendente: primeiroNome(usuario.nome) || "a equipe",
  });
  const linkWhatsapp = `https://wa.me/${lead.whatsapp}?text=${encodeURIComponent(mensagem)}`;
  const linkPodeTerVencido = passouDias(lead.created_at, VALIDADE_LINK_ATIVACAO_DIAS);
  const linkValeAte = new Date(new Date(lead.created_at).getTime() + VALIDADE_LINK_ATIVACAO_DIAS * 86_400_000);
  // Recém-cadastrado pela tela "Novo lead" (só muda o aviso; nada é gravado).
  const recemCadastrado = lead.cadastro_manual && (await searchParams).novo === "1";
  const podeAtribuir = podeAcessar(usuario.papel, "atribuir");
  const podeMarcar = podeAcessar(usuario.papel, "marcarReuniao");
  const mesclador = podeMesclar(usuario.papel);
  const [opcoesResponsavel, desfazivel, mesclados, sugestoes] = await Promise.all([
    podeAtribuir ? responsaveisPossiveis() : [],
    podeMarcar ? marcacaoDesfazivel(lead.id, lead.status) : null,
    cadastrosMescladosEm(usuario, lead.id),
    mesclador ? duplicadosSugeridosPara(usuario, lead.id) : [],
  ]);
  // Histórico e anotações do lead e dos cadastros mesclados nele.
  const ids = [lead.id, ...mesclados.map((m) => m.id)];
  const nomeDoMesclado = new Map(mesclados.map((m) => [m.id, m.nome]));
  const [historico, anotacoes] = await Promise.all([
    historicoDeEtapas(ids),
    podeAnotar(usuario.papel) ? anotacoesDe(ids) : ([] as Anotacao[]),
  ]);
  const sugerirReuniao =
    lead.agendado_em !== null &&
    lead.etapa_comercial !== ETAPA_PERDIDO &&
    posicaoDaEtapa(lead.etapa_comercial) < posicaoDaEtapa("reuniao_marcada");

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/leads" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-petroleo-forte hover:underline">
        <ArrowLeft size={16} aria-hidden="true" />
        Voltar para os leads
      </Link>

      {recemCadastrado && (
        <div className="mt-2">
          <Aviso tipo="sucesso">
            Lead cadastrado. Agora copie o link de ativação (ou a mensagem pronta com o link) e mande para a pessoa: ela
            mesma preenche a ativação.
          </Aviso>
        </div>
      )}

      <header className="mt-2 rounded-2xl border border-borda bg-fundo p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {lead.cadastro_manual && (
              <p className="mb-1">
                <span className="inline-block rounded-full bg-petroleo-suave px-2.5 py-0.5 text-xs font-semibold text-petroleo-escuro">
                  Cadastro manual
                </span>
              </p>
            )}
            <h1 className="text-2xl font-semibold wrap-anywhere sm:text-3xl">{lead.nome}</h1>
            <p className="mt-1 text-sm text-texto-suave">
              Responsável: {lead.responsavel_nome ?? "sem responsável"}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-1 text-sm">
            <dt className="text-texto-suave">Situação do teste</dt>
            <dd>
              <EtiquetaEtapa status={lead.status} />
            </dd>
            <dt className="text-texto-suave">Etapa comercial</dt>
            <dd>
              <EtiquetaComercial etapa={lead.etapa_comercial} />
            </dd>
          </dl>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-texto-suave">WhatsApp</dt>
            <dd className="font-medium">{formatarWhatsapp(lead.whatsapp)}</dd>
          </div>
          <div>
            <dt className="text-sm text-texto-suave">E-mail</dt>
            <dd className="font-medium wrap-anywhere">
              <a href={`mailto:${lead.email}`} className="inline-flex min-h-11 items-center gap-1 text-petroleo-forte hover:underline">
                <Mail size={16} aria-hidden="true" />
                {lead.email}
              </a>
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start">
          <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className={botao.primario}>
            <MessageCircle size={18} aria-hidden="true" />
            Abrir conversa no WhatsApp
            <span className="sr-only">(abre em outra aba)</span>
          </a>
          {!lead.cadastro_manual && <CopiarLinkAtivacao leadId={lead.id} />}
        </div>
        {!lead.cadastro_manual && linkPodeTerVencido && (
          <p className="mt-2 text-sm text-atencao">
            O link de ativação vale {VALIDADE_LINK_ATIVACAO_DIAS} dias desde o cadastro; o deste lead pode ter vencido.
          </p>
        )}

        {lead.cadastro_manual && (
          <section aria-labelledby="titulo-link-ativacao" className="mt-5 rounded-lg border border-borda bg-superficie p-4">
            <h2 id="titulo-link-ativacao" className="font-semibold">
              Link de ativação
            </h2>
            <p className="mt-1 text-sm">
              Mande para a pessoa: com ele, ela mesma preenche a ativação do teste grátis.{" "}
              {linkPodeTerVencido ? (
                <strong className="font-semibold text-atencao">
                  O link venceu em {formatarData(linkValeAte)} ({VALIDADE_LINK_ATIVACAO_DIAS} dias desde o cadastro).
                </strong>
              ) : (
                <>
                  Vale até <strong className="font-semibold">{formatarData(linkValeAte)}</strong> ({VALIDADE_LINK_ATIVACAO_DIAS}{" "}
                  dias desde o cadastro).
                </>
              )}
            </p>
            {/* Grade: a confirmação de cópia quebra dentro da coluna, sem empurrar o outro botão. */}
            <div className="mt-3 grid items-start gap-3 sm:grid-cols-2">
              <CopiarLinkAtivacao leadId={lead.id} formato="mensagem" />
              <CopiarLinkAtivacao leadId={lead.id} />
            </div>
          </section>
        )}
      </header>

      {(podeAtribuir || podeMarcar) && (
        <section aria-labelledby="titulo-atendimento" className="mt-6 grid gap-6 rounded-2xl border border-borda bg-fundo p-5 sm:p-6 lg:grid-cols-2">
          <h2 id="titulo-atendimento" className="font-semibold lg:col-span-2">
            Atendimento
          </h2>
          {podeAtribuir && (
            <div className="min-w-0">
              <AtribuirResponsavel leadId={lead.id} atual={lead.responsavel_id} opcoes={opcoesResponsavel} />
            </div>
          )}
          {podeMarcar && (
            <div className="min-w-0">
              <h3 className="mb-1 text-sm font-medium">Desfecho da reunião</h3>
              {lead.status === "agendado" || desfazivel ? (
                <>
                  {lead.status === "agendado" && (
                    <p className="mb-3 text-sm text-texto-suave">
                      Data da reunião: {lead.reuniao_em ? formatarDataHora(lead.reuniao_em) : "sem dados"}. Marque depois da
                      conversa; dá para desfazer em até {PRAZO_DESFAZER_HORAS} horas.
                    </p>
                  )}
                  <MarcarReuniao
                    leadId={lead.id}
                    status={lead.status}
                    desfazivel={desfazivel && { desfecho: desfazivel.desfecho, ate: desfazivel.desfazerAte.toISOString() }}
                  />
                </>
              ) : (
                <p className="text-sm text-texto-suave">
                  {lead.status === "realizado" || lead.status === "nao_compareceu"
                    ? `Desfecho já marcado. O prazo de ${PRAZO_DESFAZER_HORAS} horas para desfazer acabou (ou a marcação não foi feita pelo painel).`
                    : "Os botões aparecem quando o lead estiver agendado."}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Bloco titulo="Etapa comercial">
          <EtapaComercialDoLead
            lead={lead}
            historico={historico}
            nomeDoMesclado={nomeDoMesclado}
            podeMudar={podeMudarEtapa(usuario.papel)}
            sugerirReuniao={sugerirReuniao}
          />
        </Bloco>

        {podeAnotar(usuario.papel) && (
          <Bloco titulo="Anotações internas">
            <NovaAnotacao leadId={lead.id} />
            <ListaDeAnotacoes anotacoes={anotacoes} nomeDoMesclado={nomeDoMesclado} />
          </Bloco>
        )}

        <Bloco titulo="Prontidão para o onboarding">
          <Checklist itens={checklistDeProntidao(lead)} />
        </Bloco>

        <Bloco titulo="Situação do teste">
          <p className="mb-4 text-sm text-texto-suave">
            Etapas do teste grátis, gravadas pelo site. Não mudam com a etapa comercial.
          </p>
          <LinhaDoTempo lead={lead} />
        </Bloco>

        <Bloco titulo="Negócio">
          <Campos
            linhas={[
              ["O que vende", lead.negocio_nome_oferta],
              ["Onde atende", ondeAtende(lead)],
              ["O que quer que a pessoa faça ao ver o anúncio", acaoDesejada(lead)],
            ]}
          />
        </Bloco>

        <Bloco titulo="Experiência com anúncios e redes">
          <Campos
            linhas={[
              ["Experiência com anúncios", textoDaResposta("experiencia_anuncios", lead.experiencia_anuncios)],
              ["Acesso às redes", textoDaResposta("acesso_redes", lead.acesso_redes)],
            ]}
          />
        </Bloco>

        <Bloco titulo="Origem">
          <Campos
            linhas={[
              ["Criativo", lead.utm_content],
              ["Campanha (utm_campaign)", lead.utm_campaign],
              ["Versão do título", lead.lp_variant],
              ["Fonte (utm_source)", lead.utm_source],
              ["Meio (utm_medium)", lead.utm_medium],
              ["Página de entrada", lead.pagina_entrada],
              ["Data do cadastro", formatarDataHora(lead.created_at)],
            ]}
          />
        </Bloco>

        <Bloco titulo="Observações do lead">
          <p className="mb-2 text-sm text-texto-suave">Escritas pelo próprio lead na ativação.</p>
          {lead.observacoes ? (
            <p className="whitespace-pre-line wrap-anywhere">{lead.observacoes}</p>
          ) : (
            <p className="text-texto-suave">Sem observações.</p>
          )}
        </Bloco>
      </div>

      {(mesclados.length > 0 || mesclador) && (
        <section aria-labelledby="titulo-mesclados" className="mt-6 rounded-2xl border border-borda bg-fundo p-5 sm:p-6">
          <h2 id="titulo-mesclados" className="mb-4 font-semibold">
            Cadastros mesclados
          </h2>
          {mesclados.length === 0 ? (
            <p className="text-sm text-texto-suave">Nenhum cadastro mesclado neste lead.</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-texto-suave">
                Cadastros duplicados deste lead. Eles não aparecem em listas nem em contagens; as anotações e o histórico
                de etapas deles aparecem nos blocos acima. Este lead mantém a própria etapa e a própria origem.
              </p>
              <ul className="space-y-4">
                {mesclados.map((m) => (
                  <li key={m.id}>
                    <Mesclado cadastro={m} podeDesfazer={mesclador} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {mesclador && (
            <div className="mt-6 border-t border-borda pt-5">
              <MesclarLead leadId={lead.id} sugestoes={sugestoes.map(paraCliente)} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function paraCliente(c: Omit<Cadastro, "created_at"> & { created_at: Date }): Cadastro {
  return { ...c, created_at: new Date(c.created_at).toISOString() };
}

function Mesclado({ cadastro: m, podeDesfazer }: { cadastro: CadastroMesclado; podeDesfazer: boolean }) {
  return (
    <article aria-label={`Cadastro mesclado: ${m.nome}`} className="rounded-lg border border-borda p-4">
      <h3 className="font-semibold wrap-anywhere">{m.nome}</h3>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-texto-suave">E-mail</dt>
        <dd className="wrap-anywhere">{m.email}</dd>
        <dt className="text-texto-suave">WhatsApp</dt>
        <dd>{formatarWhatsapp(m.whatsapp)}</dd>
        <dt className="text-texto-suave">Situação do teste</dt>
        <dd>{rotuloEtapa(m.status)}</dd>
        <dt className="text-texto-suave">Etapa comercial</dt>
        <dd>{rotuloEtapaComercial(m.etapa_comercial)}</dd>
        <dt className="text-texto-suave">Responsável</dt>
        <dd className="wrap-anywhere">{m.responsavel_nome ?? "sem responsável"}</dd>
        <dt className="text-texto-suave">Origem</dt>
        <dd className="wrap-anywhere">
          {m.source} / {m.medium} / {m.campaign}
        </dd>
        <dt className="text-texto-suave">Cadastro</dt>
        <dd>{formatarDataHora(m.created_at)}</dd>
        <dt className="text-texto-suave">Mesclado</dt>
        <dd className="wrap-anywhere">
          {formatarDataHora(m.mesclado_em)}
          {m.mesclado_por ? ` por ${m.mesclado_por}` : ""}
        </dd>
      </dl>
      {podeDesfazer && (
        <div className="mt-3">
          <DesfazerMescla duplicadoId={m.id} nome={m.nome} />
        </div>
      )}
    </article>
  );
}

function DoMesclado({ leadId, nomeDoMesclado }: { leadId: string; nomeDoMesclado: Map<string, string> }) {
  const nome = nomeDoMesclado.get(leadId);
  if (!nome) return null;
  return (
    <span className="mt-1 block w-fit rounded-full bg-superficie px-2 py-0.5 text-xs text-texto-suave wrap-anywhere">
      no cadastro mesclado “{nome}”
    </span>
  );
}

function EtapaComercialDoLead(props: {
  lead: Ficha;
  historico: MudancaNoHistorico[];
  nomeDoMesclado: Map<string, string>;
  podeMudar: boolean;
  sugerirReuniao: boolean;
}) {
  const { lead, historico } = props;
  return (
    <div className="space-y-4">
      <div>
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-texto-suave">Etapa atual:</span>
          <EtiquetaComercial etapa={lead.etapa_comercial} />
        </p>
        <p className="mt-1 text-sm">
          Nesta etapa {diasDesde(lead.na_etapa_desde) === "hoje" ? "desde hoje" : diasDesde(lead.na_etapa_desde)} (desde{" "}
          {formatarData(lead.na_etapa_desde)}).
        </p>
        {lead.etapa_comercial === ETAPA_PERDIDO && (
          <p className="mt-1 text-sm wrap-anywhere">
            Motivo: {rotuloMotivo(lead.motivo_perda)}
            {lead.motivo_perda_texto && <span className="whitespace-pre-line"> — {lead.motivo_perda_texto}</span>}
          </p>
        )}
      </div>

      {props.sugerirReuniao && (
        <Aviso tipo="info">
          Este lead já agendou o teste
          {lead.agendado_em ? ` (em ${formatarData(lead.agendado_em)})` : ""}. Se fizer sentido, mude a etapa para “Reunião
          marcada”.
        </Aviso>
      )}

      {props.podeMudar ? (
        <MudarEtapa leadId={lead.id} nome={lead.nome} etapa={lead.etapa_comercial} modo="ficha" />
      ) : (
        <p className="text-sm text-texto-suave">Seu papel vê a etapa comercial, mas não muda.</p>
      )}

      <div>
        <h3 className="text-sm font-semibold">Histórico de mudanças</h3>
        {historico.length === 0 ? (
          <p className="mt-1 text-sm text-texto-suave">
            Nenhuma mudança ainda. Sem registro, o lead fica em “Não contatado” desde o cadastro.
          </p>
        ) : (
          <ol className="mt-2 space-y-3 text-sm">
            {historico.map((h) => (
              <li key={h.id} className="border-l-2 border-borda pl-3">
                <p className="wrap-anywhere">
                  <strong className="font-medium">{h.usuario_nome ?? "Alguém"}</strong> mudou de “{rotuloEtapaComercial(h.etapa_de)}”
                  para “{rotuloEtapaComercial(h.etapa_para)}”
                </p>
                <p className="text-texto-suave">{formatarDataHora(h.criado_em)}</p>
                {h.motivo_perda && (
                  <p className="wrap-anywhere">
                    Motivo: {rotuloMotivo(h.motivo_perda)}
                    {h.motivo_perda_texto && <span className="whitespace-pre-line"> — {h.motivo_perda_texto}</span>}
                  </p>
                )}
                <DoMesclado leadId={h.lead_id} nomeDoMesclado={props.nomeDoMesclado} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Anotações da mais recente para a mais antiga, sempre como texto (quebras de linha preservadas). */
function ListaDeAnotacoes({ anotacoes, nomeDoMesclado }: { anotacoes: Anotacao[]; nomeDoMesclado: Map<string, string> }) {
  if (anotacoes.length === 0) return <p className="mt-4 text-sm text-texto-suave">Nenhuma anotação ainda.</p>;
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold">Anotações, da mais recente para a mais antiga</h3>
      <ol className="mt-2 space-y-3">
        {anotacoes.map((a) => (
          <li key={a.id} className="rounded-lg border border-borda bg-superficie p-3">
            <p className="text-sm text-texto-suave">
              <span className="font-medium text-texto">{a.autor ?? "Alguém"}</span> · {formatarDataHora(a.criado_em)}
            </p>
            <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{a.texto}</p>
            <DoMesclado leadId={a.lead_id} nomeDoMesclado={nomeDoMesclado} />
          </li>
        ))}
      </ol>
    </>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const id = `bloco-${titulo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-borda bg-fundo p-5 sm:p-6">
      <h2 id={id} className="mb-4 font-semibold">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

type Valor = string | Resposta | null;

function Campos({ linhas }: { linhas: [string, Valor][] }) {
  return (
    <dl className="space-y-3">
      {linhas.map(([termo, valor]) => (
        <div key={termo}>
          <dt className="text-sm text-texto-suave">{termo}</dt>
          <dd className="wrap-anywhere">
            {valor === null || valor === "" ? (
              <span className="text-texto-suave">Não respondeu</span>
            ) : typeof valor === "string" ? (
              valor
            ) : (
              <>
                {valor.texto}
                {valor.semMapa && <span className="text-texto-suave"> (resposta sem texto cadastrado)</span>}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ondeAtende(lead: Ficha): string | null {
  const partes = [lead.cidade_bairro];
  if (lead.atende_todo_brasil === true) partes.push("atende todo o Brasil");
  if (lead.atende_todo_brasil === false) partes.push("não atende todo o Brasil");
  return partes.filter(Boolean).join(" · ") || null;
}

function acaoDesejada(lead: Ficha): Resposta | null {
  const resposta = textoDaResposta("acao_desejada", lead.acao_desejada);
  if (resposta && lead.acao_desejada === "outro" && lead.acao_desejada_outro) {
    return { ...resposta, texto: `Outro: ${lead.acao_desejada_outro}` };
  }
  return resposta;
}

/**
 * Datas de cada etapa. Reunião e realizada ainda não são preenchidas por
 * nenhum fluxo: vazias aparecem como "sem dados", não como "não aconteceu".
 */
function LinhaDoTempo({ lead }: { lead: Ficha }) {
  const realizada =
    lead.status === "nao_compareceu"
      ? "não compareceu"
      : lead.realizada_em
        ? formatarDataHora(lead.realizada_em)
        : lead.status === "realizado"
          ? "realizada (sem data)"
          : null;

  const eventos: { titulo: string; valor: string | null; vazio: string }[] = [
    { titulo: "Cadastro", valor: formatarDataHora(lead.created_at), vazio: "" },
    { titulo: "Ativação preenchida", valor: formatarDataHora(lead.etapa2_concluida_em), vazio: "ainda não" },
    { titulo: "Agendamento", valor: formatarDataHora(lead.agendado_em), vazio: "ainda não" },
    { titulo: "Reunião", valor: formatarDataHora(lead.reuniao_em), vazio: "sem dados" },
    { titulo: "Reunião realizada", valor: realizada, vazio: "sem dados" },
    { titulo: "Última retomada do cadastro", valor: formatarData(lead.ultima_retomada_em), vazio: "nenhuma" },
  ];

  return (
    <ol className="relative space-y-4 border-l-2 border-borda pl-5">
      {eventos.map((e) => (
        <li key={e.titulo} className="relative">
          <span
            aria-hidden="true"
            className={`absolute top-1.5 -left-[27px] h-3 w-3 rounded-full border-2 ${
              e.valor ? "border-petroleo-forte bg-petroleo-forte" : "border-borda-campo bg-fundo"
            }`}
          />
          <p className="font-medium">{e.titulo}</p>
          <p className={`text-sm ${e.valor ? "" : "text-texto-suave"}`}>{e.valor ?? e.vazio}</p>
        </li>
      ))}
    </ol>
  );
}
