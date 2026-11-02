import { NextResponse } from "next/server";
import { json, origemValida, usuarioDaApi } from "@/lib/api";
import { registrarAuditoria } from "@/lib/auditoria";
import { hojeEmSaoPaulo, lerFiltrosFunil } from "@/lib/filtrosFunil";
import { csvOrigem } from "@/lib/origem";
import { ACESSO_ROTAS } from "@/lib/papeis";

/** POST /api/funil/origem/exportar — CSV da tabela de origem com os cortes do formulário. Só admin, com auditoria. */
export async function POST(request: Request) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.exportarOrigem);
  if (erro) return erro;

  const form = await request.formData().catch(() => null);
  const entrada = new URLSearchParams();
  for (const [chave, valor] of form ?? []) if (typeof valor === "string") entrada.set(chave, valor);
  const filtros = lerFiltrosFunil(entrada);
  const { csv, linhas } = await csvOrigem(filtros, usuario.papel);

  await registrarAuditoria({
    usuarioId: usuario.id,
    acao: "exportar_origem",
    detalhe: {
      filtros: Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined)),
      linhas,
    },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="funil-origem-${hojeEmSaoPaulo()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
