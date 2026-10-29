"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { PAPEIS } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";
import { alterarPapel, criarUsuario, definirAtivo, ErroUsuarios } from "@/lib/usuarios";
import { ACESSO_ROTAS } from "@/lib/papeis";

/**
 * Ações da tela de usuários. Cada uma confere de novo, no servidor, que
 * quem chama é admin ativo — a tela escondida não protege nada sozinha.
 */

export type Resultado = { ok: boolean; mensagem: string } | null;

const id = z.uuid();
const papel = z.enum(PAPEIS, { error: "Escolha um papel." });

const novoUsuario = z.object({
  email: z.email({ error: "Digite um e-mail válido." }).max(254),
  nome: z.string().trim().max(120, { error: "Nome muito longo." }).transform((v) => v || null),
  papel,
});

async function executar(acao: () => Promise<string>): Promise<Resultado> {
  try {
    const mensagem = await acao();
    revalidatePath("/usuarios");
    return { ok: true, mensagem };
  } catch (erro) {
    if (erro instanceof ErroUsuarios) return { ok: false, mensagem: erro.message };
    throw erro;
  }
}

export async function adicionarUsuario(_: Resultado, form: FormData): Promise<Resultado> {
  const admin = await exigirUsuario(ACESSO_ROTAS.usuarios);
  const dados = novoUsuario.safeParse({
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    nome: String(form.get("nome") ?? ""),
    papel: form.get("papel"),
  });
  if (!dados.success) return { ok: false, mensagem: dados.error.issues[0].message };
  return executar(async () => {
    const criado = await criarUsuario(dados.data, admin.id);
    return `${criado.email} adicionado. Já pode entrar pelo Google ou pelo link por e-mail.`;
  });
}

export async function mudarPapel(_: Resultado, form: FormData): Promise<Resultado> {
  const admin = await exigirUsuario(ACESSO_ROTAS.usuarios);
  const alvo = id.safeParse(form.get("id"));
  const novo = papel.safeParse(form.get("papel"));
  if (!alvo.success || !novo.success) return { ok: false, mensagem: "Pedido inválido." };
  return executar(async () => {
    await alterarPapel(alvo.data, novo.data, admin.id);
    return "Papel atualizado.";
  });
}

export async function mudarAtivo(_: Resultado, form: FormData): Promise<Resultado> {
  const admin = await exigirUsuario(ACESSO_ROTAS.usuarios);
  const alvo = id.safeParse(form.get("id"));
  const ativo = form.get("ativo") === "true";
  if (!alvo.success) return { ok: false, mensagem: "Pedido inválido." };
  return executar(async () => {
    await definirAtivo(alvo.data, ativo, admin.id);
    return ativo ? "Acesso reativado." : "Acesso desativado. As sessões abertas foram encerradas.";
  });
}
