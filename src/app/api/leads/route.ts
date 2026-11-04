import type { NextRequest } from "next/server";
import * as z from "zod";
import { json, origemValida, usuarioDaApi } from "@/lib/api";
import { lerFiltros } from "@/lib/filtrosLeads";
import { criarLeadManual, ErroLeadManual } from "@/lib/leadManual";
import { listarLeads } from "@/lib/leads";
import { podeTentarCriarLead } from "@/lib/limite";
import { ACESSO_ROTAS } from "@/lib/papeis";

/** GET /api/leads — mesma lista (e mesmos filtros) da tela, só com os leads visíveis. */
export async function GET(request: NextRequest) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.leads);
  if (erro) return erro;
  const pagina = await listarLeads(usuario, lerFiltros(request.nextUrl.searchParams, usuario.papel));
  return json(pagina);
}

// Só a forma do pedido; as regras de cada campo (e as mensagens) ficam em leadManual.ts.
const corpo = z.object({
  nome: z.string().max(1_000),
  email: z.string().max(1_000),
  whatsapp: z.string().max(100),
  anotacao: z.string().max(20_000).nullish(),
  responsavelId: z.string().max(100).nullish(),
  via: z.enum(["tela", "api"]).optional(),
});

/**
 * POST /api/leads — cadastra um lead à mão (admin e vendas). 201 com o id;
 * 403 sem permissão; 422 com os erros de cada campo; 409 se o e-mail já
 * existe (com o id do lead só se ele for visível para quem pediu); 429 com
 * tentativas demais.
 */
export async function POST(request: Request) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.criarLead);
  if (erro) return erro;
  if (!(await podeTentarCriarLead(usuario.id))) {
    return json({ erro: "muitas_tentativas", mensagem: "Muitos cadastros em pouco tempo. Espere alguns minutos e tente de novo." }, 429);
  }
  const dados = corpo.safeParse(await request.json().catch(() => null));
  if (!dados.success) return json({ erro: "pedido_invalido", mensagem: "Pedido inválido." }, 400);
  const { via, ...lead } = dados.data;
  try {
    return json(await criarLeadManual(usuario, lead, via ?? "api"), 201);
  } catch (e) {
    if (!(e instanceof ErroLeadManual)) throw e;
    if (e.motivo === "sem_permissao") return json({ erro: "sem_permissao" }, 403);
    if (e.motivo === "email_existente") {
      return json({ erro: "email_existente", mensagem: e.message, ...(e.leadExistente ? { leadId: e.leadExistente } : {}) }, 409);
    }
    return json({ erro: "invalido", mensagem: e.message, erros: e.erros }, 422);
  }
}
