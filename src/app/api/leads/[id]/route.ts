import { NextResponse } from "next/server";
import * as z from "zod";
import { apagarLead, ErroApagarLead } from "@/lib/apagarLead";
import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
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

const corpoApagar = z.object({ email: z.string().max(254) });

/**
 * DELETE /api/leads/:id — apaga o lead de vez (só super admin; qualquer
 * outro papel recebe 403 antes de qualquer leitura). Corpo `{ email }`: o
 * e-mail do lead digitado na confirmação, conferido de novo no servidor.
 * 404 se não existe; 422 se está mesclado (duplicado ou principal com
 * duplicados) ou se o e-mail não confere. Regra em src/lib/apagarLead.ts.
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/leads/[id]">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.apagarLead);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  const dados = corpoApagar.safeParse(await request.json().catch(() => null));
  if (!dados.success) return json({ erro: "pedido_invalido", mensagem: "Digite o e-mail do lead para confirmar." }, 400);
  try {
    return json(await apagarLead(usuario, id, dados.data.email));
  } catch (e) {
    if (!(e instanceof ErroApagarLead)) throw e;
    if (e.motivo === "nao_encontrado") return naoEncontrado();
    if (e.motivo === "sem_permissao") return json({ erro: "sem_permissao" }, 403);
    return json({ erro: e.motivo, mensagem: e.message }, 422);
  }
}
