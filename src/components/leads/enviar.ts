/** Chamada às APIs de escrita do painel (mesma origem: o navegador manda o Origin certo). */
export async function enviar<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  corpo?: unknown,
): Promise<{ ok: true; dados: T } | { ok: false; status: number; mensagem: string }> {
  try {
    const resposta = await fetch(url, {
      method,
      cache: "no-store",
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.ok) return { ok: true, dados: dados as T };
    const mensagem =
      typeof dados.mensagem === "string"
        ? dados.mensagem
        : resposta.status === 403
          ? "Você não tem permissão para isso."
          : resposta.status === 404
            ? "Lead não encontrado. Atualize a página."
            : "Não deu para gravar. Tente de novo.";
    return { ok: false, status: resposta.status, mensagem };
  } catch {
    return { ok: false, status: 0, mensagem: "Sem conexão. Tente de novo." };
  }
}
