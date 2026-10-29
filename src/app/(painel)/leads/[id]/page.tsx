import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { CopiarLinkAtivacao } from "@/components/leads/CopiarLinkAtivacao";
import { Checklist } from "@/components/leads/Checklist";
import { EtiquetaEtapa } from "@/components/leads/EtiquetaEtapa";
import { botao } from "@/components/ui/estilos";
import { MENSAGEM_WHATSAPP, VALIDADE_LINK_ATIVACAO_DIAS } from "@/config/contato";
import { formatarData, formatarDataHora, formatarWhatsapp, passouDias, primeiroNome } from "@/lib/formatos";
import { abrirFicha, type Ficha } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { checklistDeProntidao, textoDaResposta, type Resposta } from "@/lib/respostas";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Ficha do lead" };

export default async function PaginaFicha({ params }: PageProps<"/leads/[id]">) {
  const usuario = await exigirUsuario(ACESSO_ROTAS.leads);
  // Lead alheio (vendas) ou inexistente: 404, sem diferença entre os dois.
  const lead = await abrirFicha(usuario, (await params).id, "tela");
  if (!lead) notFound();

  const mensagem = MENSAGEM_WHATSAPP.replaceAll("{nome}", primeiroNome(lead.nome)).replaceAll(
    "{atendente}",
    primeiroNome(usuario.nome) || "a equipe",
  );
  const linkWhatsapp = `https://wa.me/${lead.whatsapp}?text=${encodeURIComponent(mensagem)}`;
  const linkPodeTerVencido = passouDias(lead.created_at, VALIDADE_LINK_ATIVACAO_DIAS);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/leads" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-petroleo-forte hover:underline">
        <ArrowLeft size={16} aria-hidden="true" />
        Voltar para os leads
      </Link>

      <header className="mt-2 rounded-2xl border border-borda bg-fundo p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold wrap-anywhere sm:text-3xl">{lead.nome}</h1>
            <p className="mt-1 text-sm text-texto-suave">
              Responsável: {lead.responsavel_nome ?? "sem responsável"}
            </p>
          </div>
          <div className="text-right">
            <p className="sr-only">Etapa atual:</p>
            <EtiquetaEtapa status={lead.status} />
          </div>
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
          <CopiarLinkAtivacao leadId={lead.id} />
        </div>
        {linkPodeTerVencido && (
          <p className="mt-2 text-sm text-atencao">
            O link de ativação vale {VALIDADE_LINK_ATIVACAO_DIAS} dias desde o cadastro; o deste lead pode ter vencido.
          </p>
        )}
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Bloco titulo="Prontidão para o onboarding">
          <Checklist itens={checklistDeProntidao(lead)} />
        </Bloco>

        <Bloco titulo="Linha do tempo">
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
              ["Campanha", lead.utm_campaign],
              ["Versão do título", lead.lp_variant],
              ["Fonte / meio", [lead.utm_source, lead.utm_medium].filter(Boolean).join(" / ") || null],
              ["Data do cadastro", formatarDataHora(lead.created_at)],
            ]}
          />
        </Bloco>

        <Bloco titulo="Observações">
          {lead.observacoes ? (
            <p className="whitespace-pre-line wrap-anywhere">{lead.observacoes}</p>
          ) : (
            <p className="text-texto-suave">Sem observações.</p>
          )}
        </Bloco>
      </div>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-borda bg-fundo p-5 sm:p-6">
      <h2 className="mb-4 font-semibold">{titulo}</h2>
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
