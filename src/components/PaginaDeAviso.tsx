import Link from "next/link";
import { Logo } from "@/components/Logo";
import { botao } from "@/components/ui/estilos";

/** Moldura das páginas 403 e 404. */
export function PaginaDeAviso({ codigo, titulo, texto }: { codigo: string; titulo: string; texto: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <p className="text-sm font-semibold text-petroleo-forte">{codigo}</p>
        <h1 className="mt-2 text-2xl font-semibold">{titulo}</h1>
        <p className="mt-3 text-texto-suave">{texto}</p>
        <Link href="/" className={`${botao.primario} mt-8`}>
          Voltar para o início
        </Link>
      </div>
    </main>
  );
}
