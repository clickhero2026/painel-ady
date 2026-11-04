-- Permissão do painel_app para o cadastro manual de lead ("Novo lead", só
-- admin e vendas; regra em src/lib/leadManual.ts).
--
-- NÃO roda sozinho. Rodar no SQL Editor do Neon, com o dono do banco. Não
-- depende de migração: teste7d_inscricoes não muda. O mesmo GRANT está no
-- fim de db/grants/painel_app.sql (que vale para um banco novo); rodar os
-- dois não faz mal (GRANT repetido não muda nada).
--
-- Só estas quatro colunas: o resto (id, created_at, status 'inscrito',
-- token_retomada, consentimento_lgpd, bitrix_sync_status...) sai do DEFAULT
-- do banco. O painel_app continua sem UPDATE nessas colunas e sem DELETE.

GRANT INSERT (nome, email, whatsapp, utm_source) ON teste7d_inscricoes TO painel_app;
