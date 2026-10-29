/**
 * Papéis do painel e o que cada um enxerga. Arquivo puro (sem banco), usado
 * tanto no servidor (checagem de acesso) quanto na barra lateral.
 *
 * A fonte da verdade do papel de alguém é sempre a tabela
 * `painel_usuarios`, relida a cada requisição (ver `sessao.ts`) — o papel
 * gravado na sessão é só informativo.
 */

export const PAPEIS = ["admin", "suporte", "vendas", "leitura"] as const;
export type Papel = (typeof PAPEIS)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: "Admin",
  suporte: "Suporte",
  vendas: "Vendas",
  leitura: "Leitura",
};

export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor);
}

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  icone: "inicio" | "usuarios";
  papeis: readonly Papel[];
}

/** Itens da barra lateral. Uma rota nova entra aqui e em `ACESSO_ROTAS`. */
export const NAVEGACAO: readonly ItemNavegacao[] = [
  { href: "/", rotulo: "Início", icone: "inicio", papeis: PAPEIS },
  { href: "/usuarios", rotulo: "Usuários", icone: "usuarios", papeis: ["admin"] },
];

export function navegacaoDoPapel(papel: Papel): ItemNavegacao[] {
  return NAVEGACAO.filter((item) => item.papeis.includes(papel));
}

/** Quem pode abrir cada área (checado no servidor, inclusive pela URL direta). */
export const ACESSO_ROTAS = {
  inicio: PAPEIS,
  usuarios: ["admin"],
} as const satisfies Record<string, readonly Papel[]>;

export function podeAcessar(papel: Papel, area: keyof typeof ACESSO_ROTAS): boolean {
  return (ACESSO_ROTAS[area] as readonly Papel[]).includes(papel);
}
