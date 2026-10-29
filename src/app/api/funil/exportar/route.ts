import { NextResponse } from "next/server";
import { json, origemValida, usuarioDaApi } from "@/lib/api";
import { registrarAuditoria } from "@/lib/auditoria";
import { AMOSTRA_MINIMA, hojeEmSaoPaulo, lerFiltrosFunil } from "@/lib/filtrosFunil";
import { csvComparativo, indicadoresDoFunil } from "@/lib/funil";
import { ACESSO_ROTAS } from "@/lib/papeis";

/**
 * POST /api/funil/exportar — CSV da tabela comparativa (por criativo e por
 * versão do título) com os cortes do formulário. Só admin; grava
 * `exportar_funil` na auditoria com os cortes usados. POST (e não um link)
 * pra que só o próprio painel dispare a exportação.
 */
export async function POST(request: Request) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.exportarFunil);
  if (erro) return erro;

  const form = await request.formData().catch(() => null);
  const entrada = new URLSearchParams();
  for (const [chave, valor] of form ?? []) if (typeof valor === "string") entrada.set(chave, valor);
  const filtros = lerFiltrosFunil(entrada);
  const indicadores = await indicadoresDoFunil(filtros);

  await registrarAuditoria({
    usuarioId: usuario.id,
    acao: "exportar_funil",
    detalhe: {
      filtros: Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined)),
      linhas: indicadores.porCriativo.length + indicadores.porVersao.length,
    },
  });

  return new NextResponse(csvComparativo(indicadores, AMOSTRA_MINIMA), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="funil-comparativo-${hojeEmSaoPaulo()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
