-- Permissões do painel_app nas tabelas do pipeline comercial.
--
-- NÃO roda sozinho. Rodar no SQL Editor do Neon, com o dono do banco,
-- DEPOIS de db/migrations/20261103_painel_pipeline.sql. Os mesmos GRANTs
-- estão no fim de db/grants/painel_app.sql (que vale para um banco novo);
-- rodar os dois não faz mal (GRANT repetido não muda nada).

-- Etapa atual: cria (primeira mudança) e atualiza. Nunca apaga.
GRANT SELECT, INSERT, UPDATE ON painel_lead_etapa TO painel_app;

-- Histórico e anotações: só ler e acrescentar (nada de UPDATE nem DELETE).
GRANT SELECT, INSERT ON painel_lead_etapa_historico, painel_lead_anotacao TO painel_app;
GRANT USAGE ON SEQUENCE painel_lead_etapa_historico_id_seq, painel_lead_anotacao_id_seq TO painel_app;

-- Mescla: INSERT para mesclar, UPDATE para reapontar os duplicados de um
-- principal que foi mesclado em outro (e devolvê-los ao desfazer), DELETE
-- para desfazer.
GRANT SELECT, INSERT, UPDATE, DELETE ON painel_lead_mescla TO painel_app;
