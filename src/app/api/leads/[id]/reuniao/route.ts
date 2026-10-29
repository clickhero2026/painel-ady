import * as z from "zod";
import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { DESFECHOS, desfazerMarcacao, ErroReuniao, marcarDesfecho, type Desfecho } from "@/lib/reuniao";

const corpo = z.object({ desfecho: z.enum(DESFECHOS as [Desfecho, ...Desfecho[]]) });

function resposta(e: unknown) {
  if (!(e instanceof ErroReuniao)) throw e;
  if (e.motivo === "nao_encontrado") return naoEncontrado();
  return json({ erro: e.motivo, mensagem: e.message }, 409);
}

/** POST /api/leads/:id/reuniao — marca realizada ou não compareceu (só a partir de agendado). Suporte e admin. */
export async function POST(request: Request, { params }: RouteContext<"/api/leads/[id]/reuniao">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.marcarReuniao);
  if (erro) return erro;
  const dados = corpo.safeParse(await request.json().catch(() => null));
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  if (!dados.success) return json({ erro: "pedido_invalido", mensagem: "Pedido inválido." }, 400);
  try {
    await marcarDesfecho(id, dados.data.desfecho, usuario.id);
    return json({ ok: true });
  } catch (e) {
    return resposta(e);
  }
}

/** DELETE /api/leads/:id/reuniao — desfaz a marcação (até 24 horas depois). Suporte e admin. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/leads/[id]/reuniao">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.marcarReuniao);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  try {
    await desfazerMarcacao(id, usuario.id);
    return json({ ok: true });
  } catch (e) {
    return resposta(e);
  }
}
