import type { NextRequest } from "next/server";
import { json, usuarioDaApi } from "@/lib/api";
import { lerFiltrosPipeline } from "@/lib/filtrosPipeline";
import { ACESSO_ROTAS } from "@/lib/papeis";
import { listaDoPipeline, quadroDoPipeline } from "@/lib/pipeline";

/**
 * GET /api/pipeline — o quadro (padrão) ou a lista (?modo=lista), com os
 * mesmos filtros da tela. Vendas só os seus; admin e suporte todos.
 */
export async function GET(request: NextRequest) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.pipeline);
  if (erro) return erro;
  const filtros = lerFiltrosPipeline(request.nextUrl.searchParams, usuario.papel);
  if (filtros.modo === "lista") return json({ filtros, ...(await listaDoPipeline(usuario, filtros)) });
  return json({ filtros, colunas: await quadroDoPipeline(usuario, filtros) });
}
