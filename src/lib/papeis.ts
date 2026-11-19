/**
 * Papéis do painel e o que cada um enxerga. Arquivo puro (sem banco), usado
 * tanto no servidor (checagem de acesso) quanto na barra lateral.
 *
 * A fonte da verdade do papel de alguém é sempre a tabela
 * `painel_usuarios`, relida a cada requisição (ver `sessao.ts`) — o papel
 * gravado na sessão é só informativo.
 */

export const PAPEIS = ["super_admin", "admin", "gestor", "suporte", "vendas", "leitura"] as const;
export type Papel = (typeof PAPEIS)[number];

/**
 * Papéis que a tela de Usuários pode conceder (e a API aceita). O
 * super_admin fica de fora: só a migração db/migrations/20261118_super_admin.sql
 * o define, e um trigger no banco impede o painel_app de concedê-lo,
 * retirá-lo ou desativá-lo.
 */
export const PAPEIS_ATRIBUIVEIS = ["admin", "gestor", "suporte", "vendas", "leitura"] as const satisfies readonly Papel[];
export type PapelAtribuivel = (typeof PAPEIS_ATRIBUIVEIS)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  gestor: "Gestor",
  suporte: "Suporte",
  vendas: "Vendas",
  leitura: "Leitura",
};

export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor);
}

export function ehPapelAtribuivel(valor: unknown): valor is PapelAtribuivel {
  return typeof valor === "string" && (PAPEIS_ATRIBUIVEIS as readonly string[]).includes(valor);
}

/**
 * Admin ou super admin. O super admin herda TODAS as permissões de admin:
 * toda checagem de "é admin" passa por aqui (nunca `papel === "admin"`).
 */
export function ehAdmin(papel: Papel): boolean {
  return papel === "admin" || papel === "super_admin";
}

/**
 * Gestor: suporte + vendas aplicados a TODOS os leads (vê todos, muda a
 * etapa de qualquer um, anota, marca reunião, cadastra lead manual). Não
 * atribui responsável, não mescla, não exporta, não gerencia usuários e não
 * apaga lead; também não pode ser responsável por lead (fora de
 * PAPEIS_RESPONSAVEL). Lead que ele cadastra entra em "Sem responsável".
 */
export function ehGestor(papel: Papel): boolean {
  return papel === "gestor";
}

/** Texto curto do papel gestor (tela de Usuários). */
export const DESCRICAO_GESTOR =
  "Gestor: vê todos os leads, muda a etapa de qualquer um, anota, marca reunião e cadastra lead. Não atribui responsável, não mescla, não exporta, não gerencia usuários e não é responsável por lead.";

/** Só o super admin (hoje: apagar lead). */
export function ehSuperAdmin(papel: Papel): boolean {
  return papel === "super_admin";
}

/**
 * `papel` está entre os `permitidos`? Uma lista que aceita "admin" aceita
 * também o super admin; uma lista só com "super_admin" não aceita admin.
 * É a checagem usada nas páginas (exigirUsuario), nas APIs (usuarioDaApi),
 * em `podeAcessar` e na barra lateral.
 */
export function temPapel(papel: Papel, permitidos: readonly Papel[]): boolean {
  return permitidos.includes(papel) || (papel === "super_admin" && permitidos.includes("admin"));
}

/** Papéis que podem ser responsáveis por lead (SQL: `papel IN ${SQL_PAPEIS_RESPONSAVEL}`). Gestor não. */
export const PAPEIS_RESPONSAVEL = ["super_admin", "admin", "vendas"] as const satisfies readonly Papel[];
export type PapelResponsavel = (typeof PAPEIS_RESPONSAVEL)[number];
export const SQL_PAPEIS_RESPONSAVEL = `(${PAPEIS_RESPONSAVEL.map((p) => `'${p}'`).join(", ")})`;
/**
 * Quem vê o nome do responsável e filtra/corta por ele (lista, pipeline e
 * funil comercial). Vendas não: só enxerga os seus.
 */
export const VEEM_O_RESPONSAVEL = ["admin", "gestor", "suporte"] as const satisfies readonly Papel[];
/** Papéis que contam para a trava do "último admin ativo". */
export const SQL_PAPEIS_ADMIN = "('super_admin', 'admin')";

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  icone: "inicio" | "leads" | "pipeline" | "duplicados" | "reunioes" | "funil" | "perfil" | "usuarios";
  papeis: readonly Papel[];
}

/** Itens da barra lateral. Uma rota nova entra aqui e em `ACESSO_ROTAS`. */
export const NAVEGACAO: readonly ItemNavegacao[] = [
  { href: "/", rotulo: "Início", icone: "inicio", papeis: PAPEIS },
  { href: "/leads", rotulo: "Leads", icone: "leads", papeis: ["admin", "gestor", "suporte", "vendas"] },
  { href: "/pipeline", rotulo: "Pipeline", icone: "pipeline", papeis: ["admin", "gestor", "suporte", "vendas"] },
  {
    href: "/leads?visao=para_fechar",
    rotulo: "Reuniões para fechar",
    icone: "reunioes",
    papeis: ["admin", "gestor", "suporte"],
  },
  { href: "/funil", rotulo: "Funil", icone: "funil", papeis: PAPEIS },
  { href: "/perfil", rotulo: "Perfil", icone: "perfil", papeis: PAPEIS },
  { href: "/duplicados", rotulo: "Possíveis duplicados", icone: "duplicados", papeis: ["admin"] },
  { href: "/usuarios", rotulo: "Usuários", icone: "usuarios", papeis: ["admin"] },
];

export function navegacaoDoPapel(papel: Papel): ItemNavegacao[] {
  return NAVEGACAO.filter((item) => temPapel(papel, item.papeis));
}

/** Quem pode abrir cada área (checado no servidor, inclusive pela URL direta). */
export const ACESSO_ROTAS = {
  inicio: PAPEIS,
  /** Lista, ficha e link de ativação. Vendas só enxerga os seus (ver leads.ts); gestor, todos. */
  leads: ["admin", "gestor", "suporte", "vendas"],
  /** Indicadores agregados (sem dados pessoais): todos os papéis. */
  funil: PAPEIS,
  /** CSV da tabela comparativa do funil. */
  exportarFunil: ["admin"],
  /** CSV da tabela de origem. */
  exportarOrigem: ["admin"],
  /** Perfil estatístico (só agregados; "leitura" com células pequenas ocultas, ver perfil.ts). */
  perfil: PAPEIS,
  usuarios: ["admin"],
  /** Atribuir, trocar ou remover o responsável por um lead (na ficha e em lote). */
  atribuir: ["admin"],
  /** Marcar reunião realizada ou não compareceu, e desfazer; visão "Reuniões para fechar". */
  marcarReuniao: ["admin", "gestor", "suporte"],
  /** Tela Pipeline (quadro e lista). Suporte só lê; vendas só os seus (leads.ts). */
  pipeline: ["admin", "gestor", "suporte", "vendas"],
  /** Mudar a etapa comercial. Admin e gestor em qualquer lead; vendas só nos seus. Suporte não. */
  mudarEtapa: ["admin", "gestor", "vendas"],
  /** Ler e escrever anotações internas (vendas só nos seus). */
  anotar: ["admin", "gestor", "suporte", "vendas"],
  /** Mesclar e desfazer mescla; tela "Possíveis duplicados". */
  mesclar: ["admin"],
  /**
   * Cadastrar lead à mão ("Novo lead", POST /api/leads). Vendas fica como
   * responsável; gestor não escolhe e o lead entra sem responsável (leadManual.ts).
   */
  criarLead: ["admin", "gestor", "vendas"],
  /** Apagar lead (DELETE /api/leads/:id). SÓ o super admin; admin comum não. */
  apagarLead: ["super_admin"],
} as const satisfies Record<string, readonly Papel[]>;

export function podeAcessar(papel: Papel, area: keyof typeof ACESSO_ROTAS): boolean {
  return temPapel(papel, ACESSO_ROTAS[area]);
}
