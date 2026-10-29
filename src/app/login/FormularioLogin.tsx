"use client";

import { useState, type FormEvent } from "react";
import { Aviso } from "@/components/ui/Aviso";
import { botao, campo, rotulo } from "@/components/ui/estilos";

type Estado =
  | { tipo: "parado" }
  | { tipo: "enviando" }
  | { tipo: "enviado" }
  | { tipo: "erro"; mensagem: string };

const ERRO_GENERICO = "Não deu para continuar agora. Tente de novo em instantes.";

/**
 * Os dois jeitos de entrar. As chamadas vão direto às rotas do Better Auth
 * (/api/auth/*). A resposta do link mágico é a mesma para qualquer e-mail;
 * quem decide se o e-mail sai é o servidor.
 */
export function FormularioLogin({ voltar, comGoogle }: { voltar: string; comGoogle: boolean }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "parado" });
  const [indoProGoogle, setIndoProGoogle] = useState(false);

  async function enviarLink(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const email = String(new FormData(evento.currentTarget).get("email") ?? "").trim();
    setEstado({ tipo: "enviando" });
    try {
      const resposta = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, callbackURL: voltar, errorCallbackURL: "/login" }),
      });
      if (resposta.status === 429) {
        setEstado({ tipo: "erro", mensagem: "Muitas tentativas. Espere alguns minutos e tente de novo." });
      } else if (resposta.status === 400) {
        setEstado({ tipo: "erro", mensagem: "Confira o e-mail digitado." });
      } else if (!resposta.ok) {
        setEstado({ tipo: "erro", mensagem: ERRO_GENERICO });
      } else {
        setEstado({ tipo: "enviado" });
      }
    } catch {
      setEstado({ tipo: "erro", mensagem: ERRO_GENERICO });
    }
  }

  async function entrarComGoogle() {
    setIndoProGoogle(true);
    try {
      const resposta = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: voltar, errorCallbackURL: "/login" }),
      });
      const dados = (await resposta.json()) as { url?: string };
      if (!resposta.ok || !dados.url) throw new Error();
      window.location.assign(dados.url);
    } catch {
      setIndoProGoogle(false);
      setEstado({ tipo: "erro", mensagem: ERRO_GENERICO });
    }
  }

  if (estado.tipo === "enviado") {
    return (
      <div className="space-y-4">
        <Aviso tipo="sucesso">
          Se este e-mail tiver acesso ao painel, o link chega em instantes. Ele vale por 10 minutos e só funciona
          uma vez. Confira também o spam.
        </Aviso>
        <button type="button" className={`${botao.secundario} w-full`} onClick={() => setEstado({ tipo: "parado" })}>
          Usar outro e-mail
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {estado.tipo === "erro" && <Aviso tipo="erro">{estado.mensagem}</Aviso>}

      {comGoogle && (
        <>
          <button
            type="button"
            onClick={entrarComGoogle}
            disabled={indoProGoogle}
            className={`${botao.secundario} w-full`}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            {indoProGoogle ? "Abrindo o Google…" : "Entrar com Google"}
          </button>

          <div className="flex items-center gap-3 text-sm text-texto-suave" aria-hidden="true">
            <span className="h-px flex-1 bg-borda" />
            ou
            <span className="h-px flex-1 bg-borda" />
          </div>
        </>
      )}

      <form onSubmit={enviarLink} className="space-y-4">
        <div>
          <label htmlFor="email" className={rotulo}>
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            className={campo}
            aria-describedby="email-ajuda"
          />
          <p id="email-ajuda" className="mt-1 text-sm text-texto-suave">
            Enviamos um link de acesso, sem senha.
          </p>
        </div>
        <button type="submit" disabled={estado.tipo === "enviando"} className={`${botao.primario} w-full`}>
          {estado.tipo === "enviando" ? "Enviando…" : "Enviar link de acesso"}
        </button>
      </form>
    </div>
  );
}
