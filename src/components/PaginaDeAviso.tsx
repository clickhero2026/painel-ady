import Link from "next/link";
import { botao } from "@/components/ui/estilos";

/**
 * Conteúdo das páginas 403 e 404. Elas aparecem sempre dentro do layout do
 * painel (que já tem o <main> e a barra lateral), por isso aqui não há
 * <main> nem logo.
 */
export function PaginaDeAviso({ codigo, titulo, texto }: { codigo: string; titulo: string; texto: string }) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <p className="text-sm font-semibold text-petroleo-forte">{codigo}</p>
      <h1 className="mt-2 text-2xl font-semibold">{titulo}</h1>
      <p className="mt-3 text-texto-suave">{texto}</p>
      <Link href="/" className={`${botao.primario} mt-8`}>
        Voltar para o início
      </Link>
    </div>
  );
}
