import type { NextRequest } from "next/server";
import { json, usuarioDaApi } from "@/lib/api";
import { lerFiltrosFunil } from "@/lib/filtrosFunil";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { perfilDosLeads } from "@/lib/perfil";

/** GET /api/perfil — o mesmo perfil (e cortes) da tela, com as células ocultas para o papel. */
export async function GET(request: NextRequest) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.perfil);
  if (erro) return erro;
  const filtros = lerFiltrosFunil(request.nextUrl.searchParams);
  return json({ filtros, ...(await perfilDosLeads(filtros, usuario.papel)) });
}
