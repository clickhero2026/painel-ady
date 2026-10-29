/**
 * Imprime o SQL das tabelas que o Better Auth precisa (painel_auth_*), a
 * partir das opções reais de src/lib/auth.ts. Usado pra montar a migração;
 * rodar contra um banco local VAZIO (compara com o que já existe):
 *   DATABASE_DRIVER=pg DATABASE_URL=postgres://...localhost... AUTH_SECRET=... \
 *     npx jiti scripts/gerar-sql-auth.ts
 */
import { getMigrations } from "better-auth/db/migration";
import { criarOpcoesAuth } from "../src/lib/auth";

const { compileMigrations } = await getMigrations(criarOpcoesAuth());
console.log(await compileMigrations());
process.exit(0);
