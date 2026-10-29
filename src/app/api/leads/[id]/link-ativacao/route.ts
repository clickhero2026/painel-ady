import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
import { linkDeAtivacao } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";

/**
 * POST /api/leads/:id/link-ativacao — entrega o link de ativação (com o
 * token) só no clique de "Copiar link". Admin, suporte e o vendedor
 * responsável; 404 para lead alheio. Nunca vai pra log nem pro HTML.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/leads/[id]/link-ativacao">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.leads);
  if (erro) return erro;
  const link = await linkDeAtivacao(usuario, (await params).id);
  return link ? json({ link }) : naoEncontrado();
}
