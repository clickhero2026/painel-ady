import type { NextRequest } from "next/server";
import { json, usuarioDaApi } from "@/lib/api";
import { lerFiltros } from "@/lib/filtrosLeads";
import { listarLeads } from "@/lib/leads";
import { ACESSO_ROTAS } from "@/lib/papeis";

/** GET /api/leads — mesma lista (e mesmos filtros) da tela, só com os leads visíveis. */
export async function GET(request: NextRequest) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.leads);
  if (erro) return erro;
  const pagina = await listarLeads(usuario, lerFiltros(request.nextUrl.searchParams, usuario.papel));
  return json(pagina);
}
