"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { registrarAuditoria } from "@/lib/auditoria";
import { auth } from "@/lib/auth";
import { usuarioAtual } from "@/lib/sessao";

/** Sai do painel: encerra a sessão no banco e apaga o cookie. */
export async function sair() {
  const usuario = await usuarioAtual();
  await auth().api.signOut({ headers: await headers() });
  if (usuario) await registrarAuditoria({ usuarioId: usuario.id, acao: "logout" });
  redirect("/login");
}
