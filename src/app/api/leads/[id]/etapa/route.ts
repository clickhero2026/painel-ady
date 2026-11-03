import * as z from "zod";
import { ETAPAS_COMERCIAIS } from "@/config/pipeline";
import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { ErroEtapa, etapaDoLead, mudarEtapa } from "@/lib/pipeline";

const corpo = z.object({
  esperada: z.enum(ETAPAS_COMERCIAIS),
  etapa: z.enum(ETAPAS_COMERCIAIS),
  motivo: z.string().max(100).nullish(),
  motivoTexto: z.string().max(5000).nullish(),
});

/** GET /api/leads/:id/etapa — etapa comercial atual e histórico. Admin, suporte e vendas (só os seus); 404 fora do escopo. */
export async function GET(_: Request, { params }: RouteContext<"/api/leads/[id]/etapa">) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.leads);
  if (erro) return erro;
  const etapa = await etapaDoLead(usuario, (await params).id);
  return etapa ? json(etapa) : naoEncontrado();
}

/**
 * PUT /api/leads/:id/etapa — muda a etapa comercial. Condicional: `esperada`
 * é a etapa que a pessoa via; se mudou antes, 409 com a mensagem. Perdido
 * exige motivo (e texto, no motivo "Outro"). Admin em qualquer lead;
 * vendas só nos seus (404 nos outros); suporte e leitura 403.
 */
export async function PUT(request: Request, { params }: RouteContext<"/api/leads/[id]/etapa">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.mudarEtapa);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  const dados = corpo.safeParse(await request.json().catch(() => null));
  if (!dados.success) return json({ erro: "pedido_invalido", mensagem: "Pedido inválido." }, 400);
  try {
    await mudarEtapa(usuario, id, dados.data);
    return json({ ok: true });
  } catch (e) {
    if (!(e instanceof ErroEtapa)) throw e;
    if (e.motivo === "nao_encontrado") return naoEncontrado();
    if (e.motivo === "sem_permissao") return json({ erro: "sem_permissao" }, 403);
    return json({ erro: e.motivo, mensagem: e.message }, e.motivo === "conflito" ? 409 : 422);
  }
}
