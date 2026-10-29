# painel ady

Painel interno do ady (painel.useady.com.br). App separado do site público
(clickhero2026/site-ady): lê os cadastros do teste grátis de 7 dias
(`teste7d_inscricoes`, no Neon) e tem login, papéis, gestão de usuários e
auditoria.

**Stack:** Next.js 16 (App Router, `src/proxy.ts`), TypeScript, Tailwind 4,
Better Auth (Google + link mágico), `@neondatabase/serverless`, SendGrid
(API v3 via fetch), Vitest e Playwright.

## Quem entra

Só quem está em `painel_usuarios` com `ativo = true` — pelo Google ou pelo
link mágico por e-mail. Não há regra por domínio. O primeiro admin vem de
`PAINEL_ADMIN_INICIAL` (só com a tabela vazia); os demais, da tela
**Usuários**.

| Papel   | Início | Usuários |
| ------- | :----: | :------: |
| admin   |   ✓    |    ✓     |
| suporte |   ✓    |    —     |
| vendas  |   ✓    |    —     |
| leitura |   ✓    |    —     |

O papel é relido de `painel_usuarios` a cada requisição (o da sessão é só
informativo). Sessão: vence com 8 h sem uso e pede login de novo 7 dias
depois da autenticação. Link mágico: 10 minutos, uso único, até 5 pedidos
por e-mail e 20 por IP a cada 15 minutos.

## Rodar local

```bash
npm install
npm run db:up                         # Postgres local (docker-compose.yml)
psql postgres://postgres:postgres@localhost:54329/painel \
  -f ../site/db/migrations/20261027_teste7d_inscricoes.sql \
  -f db/migrations/20261028_painel_base.sql
cp .env.example .env.local            # e preencher (ver comentários)
npm run dev
```

Sem SendGrid, o link mágico aparece no console (ou em `PAINEL_DEV_EMAIL_DIR`).

## Testes

Sempre contra o Postgres local (os testes recusam qualquer host que não
seja localhost).

```bash
npm run lint
npm run typecheck
npm test            # Vitest: regras + fluxos de login e usuários no banco
npm run test:e2e    # Playwright: build de produção, rotas por papel, sessão, capturas
```

O e2e usa o Google Chrome instalado e grava as capturas em `docs/capturas/`.
O login com Google é testado com o Google simulado (só a verificação do
token é trocada; o resto do fluxo roda de verdade).

## Migrações

Em `db/migrations/`. Não rodam sozinhas: colar no SQL Editor do Neon.
