"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Aviso } from "@/components/ui/Aviso";
import { enviar } from "@/components/leads/enviar";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import {
  ETAPA_PERDIDO,
  ETAPAS_COMERCIAIS,
  MAX_TEXTO_MOTIVO,
  MOTIVOS_DE_PERDA,
  ROTULO_ETAPA_COMERCIAL,
  type EtapaComercial,
} from "@/config/pipeline";

/**
 * Mudar a etapa comercial de um lead. Dois jeitos, mesma regra:
 *   - "ficha": seletor + botão "Salvar etapa";
 *   - "cartao": botão "Mover para…" que abre a lista de etapas (teclado e
 *     toque; Esc fecha e devolve o foco).
 * Escolher "Negócio perdido" abre o pedido de motivo antes de gravar.
 * O envio leva a etapa que a pessoa via (`esperada`): se alguém mudou
 * antes, o servidor recusa com a mensagem e a tela é atualizada.
 */
export function MudarEtapa(props: { leadId: string; nome: string; etapa: EtapaComercial; modo: "ficha" | "cartao" }) {
  const { leadId, nome, etapa, modo } = props;
  const router = useRouter();
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState<EtapaComercial>(etapa);
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [erroMotivo, setErroMotivo] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const primeiraOpcao = useRef<HTMLButtonElement>(null);
  const grupoMotivo = useRef<HTMLFieldSetElement>(null);

  // A etapa mudou no servidor (router.refresh): volta o seletor para ela.
  const [etapaVista, setEtapaVista] = useState(etapa);
  if (etapa !== etapaVista) {
    setEtapaVista(etapa);
    setEscolhida(etapa);
  }

  useEffect(() => {
    if (aberto) primeiraOpcao.current?.focus();
  }, [aberto]);
  useEffect(() => {
    if (pedindoMotivo) grupoMotivo.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [pedindoMotivo]);

  function fecharMenu(voltarFoco: boolean) {
    setAberto(false);
    if (voltarFoco) requestAnimationFrame(() => botaoMenu.current?.focus());
  }

  async function gravar(nova: EtapaComercial, comMotivo?: { motivo: string; texto: string }) {
    setGravando(true);
    setResultado(null);
    const r = await enviar(`/api/leads/${leadId}/etapa`, "PUT", {
      esperada: etapa,
      etapa: nova,
      motivo: comMotivo?.motivo ?? null,
      motivoTexto: comMotivo?.texto || null,
    });
    setGravando(false);
    if (r.ok) {
      setPedindoMotivo(false);
      setMotivo("");
      setTexto("");
      setResultado({ ok: true, texto: `Etapa mudada para “${ROTULO_ETAPA_COMERCIAL[nova]}”.` });
    } else {
      setResultado({ ok: false, texto: r.mensagem });
    }
    router.refresh();
  }

  function escolher(nova: EtapaComercial) {
    setResultado(null);
    setErroMotivo(null);
    if (nova === ETAPA_PERDIDO) {
      setEscolhida(nova);
      setPedindoMotivo(true);
      return;
    }
    setPedindoMotivo(false);
    void gravar(nova);
  }

  function confirmarPerda(evento: React.FormEvent) {
    evento.preventDefault();
    const m = MOTIVOS_DE_PERDA.find((x) => x.chave === motivo);
    if (!m) return setErroMotivo("Escolha o motivo da perda.");
    if (m.exigeTexto && !texto.trim()) return setErroMotivo(`Com o motivo “${m.rotulo}”, escreva qual foi o motivo.`);
    setErroMotivo(null);
    void gravar(ETAPA_PERDIDO, { motivo, texto: texto.trim() });
  }

  function cancelarPerda() {
    setPedindoMotivo(false);
    setEscolhida(etapa);
    setErroMotivo(null);
    requestAnimationFrame(() => (modo === "cartao" ? botaoMenu.current : document.getElementById(`${id}-etapa`))?.focus());
  }

  const exigeTexto = MOTIVOS_DE_PERDA.find((x) => x.chave === motivo)?.exigeTexto ?? false;

  return (
    <div className="min-w-0">
      {modo === "ficha" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (escolhida !== etapa) escolher(escolhida);
          }}
          aria-label="Mudar a etapa comercial"
        >
          <label htmlFor={`${id}-etapa`} className={rotulo}>
            Mudar para
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <select
              id={`${id}-etapa`}
              value={escolhida}
              onChange={(e) => {
                setEscolhida(e.target.value as EtapaComercial);
                setPedindoMotivo(false);
                setResultado(null);
              }}
              className={`${campo} sm:w-auto sm:min-w-0 sm:flex-1`}
            >
              {ETAPAS_COMERCIAIS.map((e) => (
                <option key={e} value={e}>
                  {ROTULO_ETAPA_COMERCIAL[e]}
                  {e === etapa ? " (atual)" : ""}
                </option>
              ))}
            </select>
            <button type="submit" disabled={gravando || escolhida === etapa || pedindoMotivo} className={`${botao.primario} shrink-0`}>
              {gravando && !pedindoMotivo ? "Salvando…" : "Salvar etapa"}
            </button>
          </div>
        </form>
      ) : (
        <div className="relative">
          <button
            ref={botaoMenu}
            type="button"
            aria-expanded={aberto}
            aria-controls={`${id}-menu`}
            disabled={gravando}
            onClick={() => setAberto((v) => !v)}
            className={`${botao.secundario} w-full justify-between`}
          >
            <span>
              Mover para…<span className="sr-only"> (lead {nome})</span>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {aberto && (
            <ul
              id={`${id}-menu`}
              aria-label={`Etapas para mover ${nome}`}
              className="mt-1 space-y-1 rounded-lg border border-borda-campo bg-fundo p-1"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  fecharMenu(true);
                }
              }}
            >
              {ETAPAS_COMERCIAIS.filter((e) => e !== etapa).map((e, k) => (
                <li key={e}>
                  <button
                    ref={k === 0 ? primeiraOpcao : undefined}
                    type="button"
                    onClick={() => {
                      fecharMenu(e !== ETAPA_PERDIDO);
                      escolher(e);
                    }}
                    className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-superficie"
                  >
                    {ROTULO_ETAPA_COMERCIAL[e]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pedindoMotivo && (
        <form onSubmit={confirmarPerda} noValidate className="mt-3 rounded-lg border border-borda-campo bg-superficie p-4">
          <fieldset ref={grupoMotivo} aria-describedby={erroMotivo ? `${id}-erro` : undefined}>
            <legend className="font-medium">Por que o negócio foi perdido?</legend>
            <div className="mt-2 space-y-1">
              {MOTIVOS_DE_PERDA.map((m) => (
                <label key={m.chave} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name={`${id}-motivo`}
                    value={m.chave}
                    checked={motivo === m.chave}
                    onChange={() => setMotivo(m.chave)}
                    className="h-5 w-5 shrink-0 accent-petroleo-forte"
                  />
                  {m.rotulo}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`${id}-texto`} className={`${rotulo} mt-3`}>
            {exigeTexto ? "Qual foi o motivo? (obrigatório)" : "Detalhes (opcional)"}
          </label>
          <textarea
            id={`${id}-texto`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={MAX_TEXTO_MOTIVO}
            rows={3}
            aria-required={exigeTexto}
            className={`${campo} py-2`}
          />
          {erroMotivo && (
            <p id={`${id}-erro`} role="alert" className="mt-2 text-sm font-medium text-erro">
              {erroMotivo}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="submit" disabled={gravando} className={botao.primario}>
              {gravando ? "Gravando…" : "Confirmar: negócio perdido"}
            </button>
            <button type="button" disabled={gravando} onClick={cancelarPerda} className={botao.secundario}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {resultado && (
        <div className="mt-3">
          <Aviso tipo={resultado.ok ? "sucesso" : "erro"}>{resultado.texto}</Aviso>
        </div>
      )}
    </div>
  );
}
