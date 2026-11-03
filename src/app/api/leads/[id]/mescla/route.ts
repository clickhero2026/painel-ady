import type { NextRequest } from "next/server";
import * as z from "zod";
import { json, naoEncontrado, origemValida, usuarioDaApi } from "@/lib/api";
import {
  candidatosParaMescla,
  compararParaMescla,
  desfazerMescla,
  duplicadosSugeridosPara,
  ErroMescla,
  mesclar,
} from "@/lib/mescla";
import { ACESSO_ROTAS } from "@/lib/papeis";

/** Só admin em tudo aqui. */

function resposta(e: unknown) {
  if (!(e instanceof ErroMescla)) throw e;
  if (e.motivo === "nao_encontrado") return naoEncontrado();
  if (e.motivo === "sem_permissao") return json({ erro: "sem_permissao" }, 403);
  return json({ erro: "invalido", mensagem: e.message }, 422);
}

/**
 * GET /api/leads/:id/mescla
 *   ?q=texto  → candidatos (nome, e-mail ou WhatsApp), fora este lead e os já mesclados;
 *   ?com=id   → os dois cadastros lado a lado e o principal sugerido (404 se algum não serve);
 *   sem nada  → possíveis duplicados deste lead (mesmo WhatsApp ou nome normalizado).
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/leads/[id]/mescla">) {
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.mesclar);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  const busca = request.nextUrl.searchParams;
  const com = busca.get("com");
  if (com) {
    const comparacao = await compararParaMescla(usuario, id, com);
    return comparacao ? json(comparacao) : naoEncontrado();
  }
  const q = busca.get("q");
  if (q !== null) return json({ candidatos: await candidatosParaMescla(usuario, id, q.slice(0, 100)) });
  return json({ sugestoes: await duplicadosSugeridosPara(usuario, id) });
}

const corpo = z.object({ com: z.uuid(), principal: z.uuid() });

/** POST /api/leads/:id/mescla — mescla este lead com `com`; `principal` é um dos dois, o outro vira duplicado. */
export async function POST(request: Request, { params }: RouteContext<"/api/leads/[id]/mescla">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.mesclar);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  const dados = corpo.safeParse(await request.json().catch(() => null));
  if (!dados.success) return json({ erro: "pedido_invalido", mensagem: "Pedido inválido." }, 400);
  const { com, principal } = dados.data;
  const ids = [id.toLowerCase(), com.toLowerCase()];
  if (!ids.includes(principal.toLowerCase())) {
    return json({ erro: "pedido_invalido", mensagem: "O principal tem de ser um dos dois cadastros." }, 400);
  }
  const duplicado = ids.find((x) => x !== principal.toLowerCase()) ?? principal;
  try {
    return json(await mesclar(usuario, principal, duplicado));
  } catch (e) {
    return resposta(e);
  }
}

/** DELETE /api/leads/:id/mescla — desfaz a mescla deste cadastro (o duplicado). */
export async function DELETE(request: Request, { params }: RouteContext<"/api/leads/[id]/mescla">) {
  if (!origemValida(request)) return json({ erro: "origem_invalida" }, 403);
  const { usuario, erro } = await usuarioDaApi(ACESSO_ROTAS.mesclar);
  if (erro) return erro;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return naoEncontrado();
  try {
    return json(await desfazerMescla(usuario, id));
  } catch (e) {
    return resposta(e);
  }
}
