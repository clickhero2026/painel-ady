import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
import { linkDeAtivacao, mensagemDeAtivacao } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";

/**
 * POST /api/leads/:id/link-ativacao — entrega o link de ativação (com o
 * token) só no clique de "Copiar link". Admin, suporte e o vendedor
 * responsável; 404 para lead alheio. Nunca vai pra log nem pro HTML.
 *
 * Com `?formato=mensagem`, devolve a mensagem pronta com o link
 * (MENSAGEM_LINK_ATIVACAO, montada aqui no servidor) em vez do link puro.
 * Os dois gravam `copiar_link` na auditoria.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/leads/[id]/link-ativacao">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.leads);
  if (erro) return erro;
  const id = (await params).id;
  if (new URL(request.url).searchParams.get("formato") === "mensagem") {
    const mensagem = await mensagemDeAtivacao(usuario, id, usuario.nome);
    return mensagem ? json({ mensagem }) : naoEncontrado();
  }
  const link = await linkDeAtivacao(usuario, id);
  return link ? json({ link }) : naoEncontrado();
}
