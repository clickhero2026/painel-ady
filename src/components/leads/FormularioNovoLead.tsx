"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";
import { MAX_ANOTACAO } from "@/config/pipeline";
import { ROTULO_PAPEL } from "@/lib/papeis";
import type { CampoDoLead, ErrosDoLead } from "@/lib/validacaoLead";
import type { OpcaoResponsavel } from "./AtribuirResponsavel";
import { enviar } from "./enviar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDEM: CampoDoLead[] = ["nome", "whatsapp", "email", "anotacao", "responsavel"];

/**
 * Cadastro manual de lead (/leads/novo). Quem valida é o servidor
 * (leadManual.ts): aqui só mostramos os erros de cada campo que ele
 * devolve. Admin escolhe o responsável (padrão: nenhum); vendas fica com o lead.
 */
export function FormularioNovoLead({ opcoes }: { /** Só admin; null = vendas (o lead fica com quem cadastra). */ opcoes: OpcaoResponsavel[] | null }) {
  const router = useRouter();
  const id = useId();
  const [valores, setValores] = useState({ nome: "", whatsapp: "", email: "", anotacao: "", responsavel: "" });
  const [erros, setErros] = useState<ErrosDoLead>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [leadExistente, setLeadExistente] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const campos = useRef<Partial<Record<CampoDoLead, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>>>({});
  const restam = MAX_ANOTACAO - valores.anotacao.length;

  const mudar = (c: keyof typeof valores) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValores((v) => ({ ...v, [c]: e.target.value }));

  function mostrarErros(novos: ErrosDoLead) {
    setErros(novos);
    const primeiro = ORDEM.find((c) => novos[c]);
    if (primeiro) campos.current[primeiro]?.focus();
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setErroGeral(null);
    setLeadExistente(null);
    const faltando: ErrosDoLead = {};
    if (!valores.nome.trim()) faltando.nome = "Digite o nome.";
    if (!valores.whatsapp.trim()) faltando.whatsapp = "Digite o WhatsApp, com DDD.";
    if (!valores.email.trim()) faltando.email = "Digite o e-mail.";
    if (Object.keys(faltando).length > 0) {
      mostrarErros(faltando);
      return;
    }

    setGravando(true);
    setErros({});
    const r = await enviar<{ id: string }>("/api/leads", "POST", {
      nome: valores.nome,
      whatsapp: valores.whatsapp,
      email: valores.email,
      anotacao: valores.anotacao || null,
      ...(opcoes ? { responsavelId: valores.responsavel || null } : {}),
      via: "tela",
    });
    if (r.ok && UUID.test(r.dados.id)) {
      // Fica "gravando" até a ficha abrir (evita um segundo envio).
      router.push(`/leads/${r.dados.id}?novo=1`);
      return;
    }
    setGravando(false);
    if (r.ok) {
      setErroGeral("Lead cadastrado, mas não deu para abrir a ficha. Procure pelo nome na lista de leads.");
      return;
    }
    const devolvidos = r.dados.erros as ErrosDoLead | undefined;
    if (r.status === 409) {
      const existente = typeof r.dados.leadId === "string" && UUID.test(r.dados.leadId) ? r.dados.leadId : null;
      setLeadExistente(existente);
      mostrarErros({ email: r.mensagem });
    } else if (r.status === 422 && devolvidos && Object.keys(devolvidos).length > 0) {
      mostrarErros(devolvidos);
    } else {
      setErroGeral(r.mensagem);
    }
  }

  const quantos = Object.keys(erros).length;
  const ajuda = (c: CampoDoLead, extra?: string) => [erros[c] ? `${id}-${c}-erro` : null, extra].filter(Boolean).join(" ") || undefined;
  const erro = (c: CampoDoLead) =>
    erros[c] ? (
      <p id={`${id}-${c}-erro`} className="mt-1 text-sm font-medium text-erro">
        {erros[c]}
      </p>
    ) : null;

  return (
    <form onSubmit={salvar} noValidate aria-label="Novo lead" className="space-y-5">
      {quantos > 0 && (
        <Aviso tipo="erro">
          {quantos === 1 ? "Confira o campo marcado abaixo." : `Confira os ${quantos} campos marcados abaixo.`}
        </Aviso>
      )}
      {erroGeral && <Aviso tipo="erro">{erroGeral}</Aviso>}

      <div>
        <label htmlFor={`${id}-nome`} className={rotulo}>
          Nome
        </label>
        <input
          id={`${id}-nome`}
          ref={(el) => {
            campos.current.nome = el;
          }}
          value={valores.nome}
          onChange={mudar("nome")}
          maxLength={120}
          autoComplete="off"
          required
          aria-invalid={erros.nome ? true : undefined}
          aria-describedby={ajuda("nome")}
          className={campo}
        />
        {erro("nome")}
      </div>

      <div>
        <label htmlFor={`${id}-whatsapp`} className={rotulo}>
          WhatsApp, com DDD
        </label>
        <input
          id={`${id}-whatsapp`}
          ref={(el) => {
            campos.current.whatsapp = el;
          }}
          type="tel"
          inputMode="tel"
          value={valores.whatsapp}
          onChange={mudar("whatsapp")}
          maxLength={30}
          autoComplete="off"
          required
          aria-invalid={erros.whatsapp ? true : undefined}
          aria-describedby={ajuda("whatsapp", `${id}-whatsapp-ajuda`)}
          className={campo}
        />
        <p id={`${id}-whatsapp-ajuda`} className="mt-1 text-sm text-texto-suave">
          Exemplo: (85) 99999-9999. Pode ser com ou sem o 55.
        </p>
        {erro("whatsapp")}
      </div>

      <div>
        <label htmlFor={`${id}-email`} className={rotulo}>
          E-mail
        </label>
        <input
          id={`${id}-email`}
          ref={(el) => {
            campos.current.email = el;
          }}
          type="email"
          inputMode="email"
          value={valores.email}
          onChange={mudar("email")}
          maxLength={180}
          autoComplete="off"
          spellCheck={false}
          required
          aria-invalid={erros.email ? true : undefined}
          aria-describedby={ajuda("email")}
          className={campo}
        />
        {erro("email")}
        {leadExistente && (
          <p className="mt-1 text-sm">
            <Link href={`/leads/${leadExistente}`} className="inline-flex min-h-11 items-center font-semibold text-petroleo-forte underline underline-offset-4">
              Abrir a ficha desse lead
            </Link>
          </p>
        )}
      </div>

      {opcoes ? (
        <div>
          <label htmlFor={`${id}-responsavel`} className={rotulo}>
            Responsável
          </label>
          <select
            id={`${id}-responsavel`}
            ref={(el) => {
              campos.current.responsavel = el;
            }}
            value={valores.responsavel}
            onChange={mudar("responsavel")}
            aria-invalid={erros.responsavel ? true : undefined}
            aria-describedby={ajuda("responsavel", `${id}-responsavel-ajuda`)}
            className={campo}
          >
            <option value="">Sem responsável</option>
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome} ({ROTULO_PAPEL[o.papel]})
              </option>
            ))}
          </select>
          <p id={`${id}-responsavel-ajuda`} className="mt-1 text-sm text-texto-suave">
            Sem responsável, o lead vai para a fila “Sem responsável”.
          </p>
          {erro("responsavel")}
        </div>
      ) : (
        <p className="rounded-lg bg-superficie px-4 py-3 text-sm">O lead fica com você.</p>
      )}

      <div>
        <label htmlFor={`${id}-anotacao`} className={rotulo}>
          Anotação interna (opcional)
        </label>
        <textarea
          id={`${id}-anotacao`}
          ref={(el) => {
            campos.current.anotacao = el;
          }}
          value={valores.anotacao}
          onChange={mudar("anotacao")}
          maxLength={MAX_ANOTACAO}
          rows={4}
          aria-invalid={erros.anotacao ? true : undefined}
          aria-describedby={ajuda("anotacao", `${id}-anotacao-ajuda`)}
          className={`${campo} py-2`}
        />
        <p id={`${id}-anotacao-ajuda`} className="mt-1 text-sm text-texto-suave">
          Por exemplo, de onde veio o contato. Só a equipe vê; não dá para editar nem apagar depois. {restam}{" "}
          {restam === 1 ? "caractere restante" : "caracteres restantes"}.
        </p>
        {erro("anotacao")}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" disabled={gravando} className={botao.primario}>
          {gravando ? "Cadastrando…" : "Cadastrar lead"}
        </button>
        <Link href="/leads" className={botao.secundario}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
