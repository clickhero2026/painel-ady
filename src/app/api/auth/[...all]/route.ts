import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Rotas do Better Auth (login com Google, link mágico, sessão, sair).
export function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
