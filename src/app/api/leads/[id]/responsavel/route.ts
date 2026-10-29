import * as z from "zod";
import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
import { atribuir, ErroAtribuicao, LeadNaoEncontrado } from "@/lib/atribuicao";
import { ACESSO_ROTAS } from "@/lib/papeis";

const corpo = z.object({ usuarioId: z.uuid().nullable() });

/**
 * PUT /api/leads/:id/responsavel — atribui, troca ou remove (usuarioId
 * null) o responsável. Só admin. Repetir a mesma atribuição é ok (nada muda).
 */
export async function PUT(request: Request, { params }: RouteContext<"/api/leads/[id]/responsavel">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.atribuir);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  const dados = corpo.safeParse(await request.json().catch(() => null));
  if (!dados.success) return json({ erro: "pedido_invalido", mensagem: "Pedido inválido." }, 400);
  try {
    return json(await atribuir([id], dados.data.usuarioId, usuario.id));
  } catch (e) {
    if (e instanceof LeadNaoEncontrado) return naoEncontrado();
    if (e instanceof ErroAtribuicao) return json({ erro: "invalido", mensagem: e.message }, 422);
    throw e;
  }
}
