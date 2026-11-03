import type { NextRequest } from "next/server";
import { json, usuarioDaApi } from "@/lib/api";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { funilComercial } from "@/lib/funilComercial";
import { ACESSO_ROTAS } from "@/lib/papeis";

/** GET /api/funil/comercial — o bloco de funil comercial (mesmos cortes da tela), protegido para o papel. Só agregados. */
export async function GET(request: NextRequest) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.funil);
  if (erro) return erro;
  const filtros = lerFiltrosFunil(request.nextUrl.searchParams);
  return json({ filtros, ...(await funilComercial(filtros, usuario.papel)) });
}
