/**
 * Roda antes do `next build` do e2e (ver playwright.config.ts): recria o
 * banco local painel_e2e e esvazia a caixa de saída de e-mails.
 */
import { rm } from "node:fs/promises";
import { recriarBanco } from "../banco";

const URL_E2E = "postgres://postgres:postgres@localhost:54329/painel_e2e";

await recriarBanco(URL_E2E);
await rm(".dev-emails/e2e", { recursive: true, force: true });
process.exit(0);
