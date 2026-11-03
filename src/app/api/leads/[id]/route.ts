import { NextResponse } from "next/server";
import { json, naoEncontrado, usuarioDaApi } from "@/lib/api";
import { abrirFicha, principalVisivelDe } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";

/**
 * GET /api/leads/:id — ficha do lead; 404 se não existe ou não é visível.
 * Cadastro mesclado em outro: 308 para a ficha do principal (se visível).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/leads/[id]">) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.leads);
  if (erro) return erro;
  const id = (await params).id;
  const ficha = await abrirFicha(usuario, id, "api");
  if (ficha) return json(ficha);
  const principal = await principalVisivelDe(usuario, id);
  if (principal) return NextResponse.redirect(new URL(`/api/leads/${principal}`, request.url), 308);
  return naoEncontrado();
}
