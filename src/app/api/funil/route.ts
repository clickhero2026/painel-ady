import type { NextRequest } from "next/server";
import { json, usuarioDaApi } from "@/lib/api";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { indicadoresDoFunil } from "@/lib/funil";
import { ACESSO_ROTAS } from "@/lib/papeis";

/** GET /api/funil — os mesmos indicadores (e cortes) da tela. Só agregados. */
export async function GET(request: NextRequest) {
  const { erro } = await usuarioDaApi(ACESSO_ROTAS.funil);
  if (erro) return erro;
  const filtros = lerFiltrosFunil(request.nextUrl.searchParams);
  return json({ filtros, ...(await indicadoresDoFunil(filtros)) });
}
