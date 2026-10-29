import { defineConfig } from "@playwright/test";

/**
 * Testes de ponta a ponta contra o build de produção (`next build` +
 * `next start`) na porta 3100, com Postgres local (banco painel_e2e,
 * recriado a cada rodada por tests/e2e/preparar-banco.ts) e e-mails na caixa de saída de dev.
 * Usa o Google Chrome instalado na máquina (channel: "chrome").
 */
const PORTA = 3100;
export const URL_E2E = "postgres://postgres:postgres@localhost:54329/painel_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORTA}`,
    channel: "chrome",
    headless: true,
    locale: "pt-BR",
  },
  webServer: {
    command: `npx jiti tests/e2e/preparar-banco.ts && npx next build && npx next start -p ${PORTA}`,
    url: `http://localhost:${PORTA}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: URL_E2E,
      DATABASE_DRIVER: "pg",
      AUTH_SECRET: "segredo-de-e2e-com-mais-de-32-caracteres-abcdef",
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORTA}`,
      PAINEL_ADMIN_INICIAL: "primeiro.admin@vendedormestre.com.br",
      PAINEL_DEV_EMAIL_DIR: ".dev-emails/e2e",
      AUTH_GOOGLE_ID: "google-id-de-teste",
      AUTH_GOOGLE_SECRET: "google-secret-de-teste",
      SENDGRID_API_KEY: "",
    },
  },
});
