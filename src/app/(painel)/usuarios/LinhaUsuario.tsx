"use client";

import { useActionState, useId } from "react";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo } from "@/components/ui/estilos";
import { PAPEIS, ROTULO_PAPEL, type Papel } from "@/lib/papeis";
import { mudarAtivo, mudarPapel } from "./acoes";

interface Props {
  usuario: { id: string; email: string; nome: string | null; papel: Papel; ativo: boolean; ultimoAcesso: string | null };
  ehVoce: boolean;
}

const formatoData = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export function LinhaUsuario({ usuario, ehVoce }: Props) {
  const [resPapel, enviarPapel, mudandoPapel] = useActionState(mudarPapel, null);
  const [resAtivo, enviarAtivo, mudandoAtivo] = useActionState(mudarAtivo, null);
  const idPapel = useId();
  const resultado = resAtivo ?? resPapel;
  const nome = usuario.nome || usuario.email;

  return (
    <li className={`px-4 py-4 sm:px-5 ${usuario.ativo ? "" : "bg-superficie"}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{nome}</span>
            {ehVoce && <span className="rounded-full bg-petroleo-suave px-2 py-0.5 text-xs text-petroleo-escuro">você</span>}
            {!usuario.ativo && (
              <span className="rounded-full border border-borda-campo px-2 py-0.5 text-xs text-texto-suave">desativado</span>
            )}
          </p>
          {usuario.nome && <p className="truncate text-sm text-texto-suave">{usuario.email}</p>}
          <p className="text-xs text-texto-suave">
            {usuario.ultimoAcesso ? `Último acesso: ${formatoData.format(new Date(usuario.ultimoAcesso))}` : "Ainda não entrou"}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form action={enviarPapel} className="flex items-center gap-2">
            <input type="hidden" name="id" value={usuario.id} />
            <label htmlFor={idPapel} className="sr-only">
              Papel de {nome}
            </label>
            <select id={idPapel} name="papel" defaultValue={usuario.papel} className={`${campo} w-36`}>
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAPEL[p]}
                </option>
              ))}
            </select>
            <button type="submit" disabled={mudandoPapel} className={botao.secundario} aria-label={`Salvar papel de ${nome}`}>
              Salvar
            </button>
          </form>
          {!ehVoce && (
            <form action={enviarAtivo}>
              <input type="hidden" name="id" value={usuario.id} />
              <input type="hidden" name="ativo" value={String(!usuario.ativo)} />
              <button
                type="submit"
                disabled={mudandoAtivo}
                className={`${usuario.ativo ? botao.perigo : botao.secundario} w-full sm:w-auto`}
                aria-label={`${usuario.ativo ? "Desativar" : "Reativar"} ${nome}`}
              >
                {usuario.ativo ? "Desativar" : "Reativar"}
              </button>
            </form>
          )}
        </div>
      </div>
      {resultado && (
        <div className="mt-3">
          <Aviso tipo={resultado.ok ? "sucesso" : "erro"}>{resultado.mensagem}</Aviso>
        </div>
      )}
    </li>
  );
}
