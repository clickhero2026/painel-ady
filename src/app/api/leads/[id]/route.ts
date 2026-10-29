import { json, naoEncontrado, usuarioDaApi } from "@/lib/api";
import { abrirFicha } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";

/** GET /api/leads/:id — ficha do lead; 404 se não existe ou não é visível. */
export async function GET(_: Request, { params }: RouteContext<"/api/leads/[id]">) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.leads);
  if (erro) return erro;
  const ficha = await abrirFicha(usuario, (await params).id, "api");
  return ficha ? json(ficha) : naoEncontrado();
}
