import { json, usuarioDaApi } from "@/lib/api";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { possiveisDuplicados } from "@/lib/mescla";

/** GET /api/leads/duplicados — grupos de possíveis duplicados (mesmo WhatsApp ou nome normalizado). Só admin; só sugere. */
export async function GET() {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.mesclar);
  if (erro) return erro;
  return json({ grupos: await possiveisDuplicados(usuario) });
}
