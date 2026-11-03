import * as z from "zod";
import { anotacoesDoLead, anotar, ErroAnotacao } from "@/lib/anotacoes";
import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
import { ACESSO_ROTAS } from "@/lib/papeis";

const corpo = z.object({ texto: z.string().max(20_000) });

/** GET /api/leads/:id/anotacoes — anotações internas (mais recente primeiro), com as dos cadastros mesclados. */
export async function GET(_: Request, { params }: RouteContext<"/api/leads/[id]/anotacoes">) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.anotar);
  if (erro) return erro;
  const anotacoes = await anotacoesDoLead(usuario, (await params).id);
  return anotacoes ? json({ anotacoes }) : naoEncontrado();
}

/** POST /api/leads/:id/anotacoes — nova anotação (não edita nem apaga). Admin, suporte e vendas (só os seus). */
export async function POST(request: Request, { params }: RouteContext<"/api/leads/[id]/anotacoes">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.anotar);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  const dados = corpo.safeParse(await request.json().catch(() => null));
  if (!dados.success) return json({ erro: "pedido_invalido", mensagem: "Pedido inválido." }, 400);
  try {
    return json({ anotacao: await anotar(usuario, id, dados.data.texto) }, 201);
  } catch (e) {
    if (!(e instanceof ErroAnotacao)) throw e;
    if (e.motivo === "nao_encontrado") return naoEncontrado();
    if (e.motivo === "sem_permissao") return json({ erro: "sem_permissao" }, 403);
    return json({ erro: "invalido", mensagem: e.message }, 422);
  }
}
