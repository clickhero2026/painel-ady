"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { House, LogOut, Menu, Users, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import type { ItemNavegacao } from "@/lib/papeis";

const ICONES = { inicio: House, usuarios: Users } as const;

interface Props {
  itens: ItemNavegacao[];
  nome: string;
  papel: string;
  sair: () => Promise<void>;
}

/**
 * Barra lateral fixa no desktop; no celular vira uma gaveta aberta pelo
 * botão "Menu" (Esc fecha e o foco volta pro botão).
 */
export function BarraLateral({ itens, nome, papel, sair }: Props) {
  const caminho = usePathname();
  const [aberta, setAberta] = useState(false);
  const idGaveta = useId();
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const [caminhoAberto, setCaminhoAberto] = useState(caminho);

  // Fecha ao navegar.
  if (caminho !== caminhoAberto) {
    setCaminhoAberto(caminho);
    setAberta(false);
  }

  useEffect(() => {
    if (!aberta) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        setAberta(false);
        botaoMenu.current?.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberta]);

  const ativo = (href: string) => (href === "/" ? caminho === "/" : caminho.startsWith(href));

  const conteudo = (
    <div className="flex h-full flex-col">
      <nav aria-label="Principal" className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {itens.map((item) => {
            const Icone = ICONES[item.icone];
            const atual = ativo(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={atual ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg border-l-4 px-3 text-sm font-medium transition-colors ${
                    atual
                      ? "border-petroleo bg-petroleo-suave text-petroleo-escuro"
                      : "border-transparent text-texto hover:bg-superficie"
                  }`}
                >
                  <Icone size={18} aria-hidden="true" />
                  {item.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-borda px-4 py-4">
        <p className="truncate text-sm font-medium" title={nome}>
          {nome}
        </p>
        <p className="text-xs text-texto-suave">{papel}</p>
        <form action={sair} className="mt-3">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-petroleo-forte hover:underline"
          >
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Celular: barra de topo + gaveta */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-borda bg-fundo px-4 lg:hidden">
        <Link href="/" aria-label="ady — início do painel">
          <Logo />
        </Link>
        <button
          ref={botaoMenu}
          type="button"
          aria-expanded={aberta}
          aria-controls={idGaveta}
          onClick={() => setAberta((v) => !v)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium"
        >
          {aberta ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          Menu
        </button>
      </header>
      {aberta && (
        <div className="fixed inset-0 top-14 z-20 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 bg-texto/40"
            onClick={() => setAberta(false)}
          />
          <div id={idGaveta} className="relative h-full w-72 max-w-[85vw] border-r border-borda bg-fundo">
            {conteudo}
          </div>
        </div>
      )}

      {/* Desktop: barra lateral fixa */}
      <aside className="hidden w-64 shrink-0 border-r border-borda bg-fundo lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="flex h-16 items-center border-b border-borda px-5">
            <Link href="/" aria-label="ady — início do painel">
              <Logo />
            </Link>
          </div>
          <div className="min-h-0 flex-1">{conteudo}</div>
        </div>
      </aside>
    </>
  );
}
