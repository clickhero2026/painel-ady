import path from "node:path";
import { defineConfig } from "vitest/config";
import { URL_TESTE } from "./tests/banco";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integracao/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    // Os testes de integração dividem o mesmo banco local.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: URL_TESTE,
      DATABASE_DRIVER: "pg",
      AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres-123",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      PAINEL_ADMIN_INICIAL: "primeiro.admin@vendedormestre.com.br",
      PAINEL_DEV_EMAIL_DIR: ".dev-emails/vitest",
      AUTH_GOOGLE_ID: "google-id-de-teste",
      AUTH_GOOGLE_SECRET: "google-secret-de-teste",
      SENDGRID_API_KEY: "",
    },
  },
});
