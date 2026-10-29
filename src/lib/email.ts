import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { naVercel } from "./env";

/**
 * Envio de e-mail pela API v3 do SendGrid (fetch direto, sem SDK).
 *
 * Fora da Vercel e sem SENDGRID_API_KEY, o e-mail não sai: com
 * PAINEL_DEV_EMAIL_DIR ele vira um .json nessa pasta (os testes leem o
 * link de lá); sem ela, o link aparece no console do `next dev`.
 */

interface Email {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

export async function enviarEmail(email: Email): Promise<void> {
  const chave = process.env.SENDGRID_API_KEY;
  if (!chave) {
    if (naVercel) throw new Error("SENDGRID_API_KEY não configurada.");
    return guardarEmailDev(email);
  }

  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM não configurada.");

  const resposta = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: email.para }] }],
      from: { email: from, name: "painel ady" },
      subject: email.assunto,
      content: [
        { type: "text/plain", value: email.texto },
        { type: "text/html", value: email.html },
      ],
      // Link de login não pode passar pelo redirecionador de cliques do
      // SendGrid (o token ficaria nos logs deles e o robô "gastaria" o link).
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
      },
    }),
  });
  if (!resposta.ok) {
    throw new Error(`SendGrid respondeu ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  }
}

async function guardarEmailDev(email: Email): Promise<void> {
  const pasta = process.env.PAINEL_DEV_EMAIL_DIR;
  if (!pasta) {
    console.info(`[e-mail de dev] para ${email.para}: ${email.texto}`);
    return;
  }
  await mkdir(pasta, { recursive: true });
  const nome = `${Date.now()}-${email.para.replace(/[^a-z0-9]/gi, "_")}.json`;
  await writeFile(path.join(pasta, nome), JSON.stringify(email));
}

function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function emailLinkMagico(para: string, url: string): Email {
  const texto =
    `Olá! Use o link abaixo para entrar no painel do ady:\n\n${url}\n\n` +
    "O link vale por 10 minutos e só funciona uma vez. " +
    "Se você não pediu este acesso, é só ignorar este e-mail.";
  const link = escaparHtml(url);
  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#F4F9FB;font-family:Arial,Helvetica,sans-serif;color:#0C0D0A">
  <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:12px;padding:32px">
    <p style="margin:0 0 24px;font-size:22px;font-weight:600;color:#17708A">ady</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5">Olá! Use o botão abaixo para entrar no painel do ady.</p>
    <p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#17708A;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Entrar no painel</a></p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#3D4A4F">O link vale por 10 minutos e só funciona uma vez.</p>
    <p style="margin:0;font-size:14px;line-height:1.5;color:#3D4A4F">Se você não pediu este acesso, é só ignorar este e-mail.</p>
  </div>
</body></html>`;
  return { para, assunto: "Seu link de acesso ao painel do ady", texto, html };
}
