/**
 * Roda antes do `next build` do e2e (ver playwright.config.ts): recria o
 * banco local painel_e2e (com os GRANTs do painel_app) e esvazia a caixa de
 * saída de e-mails.
 */
import { rm } from "node:fs/promises";
import { recriarBanco, urls } from "../banco";

await recriarBanco(urls("painel_e2e").dono);
await rm(".dev-emails/e2e", { recursive: true, force: true });
process.exit(0);
