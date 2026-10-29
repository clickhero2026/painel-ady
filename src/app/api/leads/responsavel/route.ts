import * as z from "zod";
import { json, origemValida, usuarioDaApi } from "@/lib/api";
import { atribuir, ErroAtribuicao, LeadNaoEncontrado, MAX_LEADS_POR_LOTE } from "@/lib/atribuicao";
import { ACESSO_ROTAS } from "@/lib/papeis";

const corpo = z.object({
  leads: z.array(z.uuid()).min(1).max(MAX_LEADS_POR_LOTE),
  usuarioId: z.uuid().nullable(),
});

/**
 * POST /api/leads/responsavel — atribuição em lote (até 100 leads). Só
 * admin. Leads que já estavam com esse responsável ficam como estão.
 */
export async function POST(request: Request) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.atribuir);
  if (erro) return erro;
  const dados = corpo.safeParse(await request.json().catch(() => null));
  if (!dados.success) {
    const demais = dados.error.issues.some((i) => i.code === "too_big");
    return json(
      { erro: "pedido_invalido", mensagem: demais ? `No máximo ${MAX_LEADS_POR_LOTE} leads por vez.` : "Pedido inválido." },
      400,
    );
  }
  try {
    return json(await atribuir(dados.data.leads, dados.data.usuarioId, usuario.id));
  } catch (e) {
    if (e instanceof LeadNaoEncontrado) return json({ erro: "nao_encontrado", mensagem: e.message }, 404);
    if (e instanceof ErroAtribuicao) return json({ erro: "invalido", mensagem: e.message }, 422);
    throw e;
  }
}
