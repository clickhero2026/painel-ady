-- Permissões do usuário de banco do painel (painel_app). Fonte de verdade:
-- é ESTE arquivo que os testes aplicam no banco local antes de rodar o app
-- como painel_app, então qualquer coluna fora da lista quebra os testes.
--
-- NÃO roda sozinho. Rodar no SQL Editor do Neon, com o dono do banco,
-- depois de criar o usuário e de rodar db/migrations/20261028_painel_base.sql:
--   CREATE ROLE painel_app LOGIN PASSWORD 'TROCAR_POR_UMA_SENHA_FORTE';
-- É o mesmo SQL da seção 10.2 do claude/painel-interno-ady.md, mais as
-- tabelas do login (painel_auth_*), que lá não aparecem.

GRANT USAGE ON SCHEMA public TO painel_app;

-- Leitura dos cadastros, sem as colunas sensíveis que o painel não usa
-- (ip_hash, user_agent, fbclid, bitrix_*, retomada_falhas*).
GRANT SELECT (
  id, created_at, updated_at, nome, email, whatsapp, consentimento_lgpd, consentimento_em,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term, lp_variant, referrer, landing_url,
  negocio_nome_oferta, cidade_bairro, atende_todo_brasil, acao_desejada, acao_desejada_outro,
  experiencia_anuncios, acesso_redes, conta_anuncios, cartao_pagamento, arquivo_logo,
  reuniao_computador, observacoes, etapa2_concluida_em,
  calendly_evento_uri, agendado_em, reuniao_em, realizada_em, status,
  token_retomada, ultima_retomada_em
) ON teste7d_inscricoes TO painel_app;

-- Única escrita permitida na tabela de cadastros (marcar reunião realizada ou não)
GRANT UPDATE (status, realizada_em) ON teste7d_inscricoes TO painel_app;

-- Tabelas do painel
GRANT SELECT, INSERT, UPDATE, DELETE ON painel_usuarios, painel_lead_responsavel TO painel_app;
GRANT SELECT, INSERT ON painel_auditoria TO painel_app;
GRANT USAGE, SELECT ON SEQUENCE painel_auditoria_id_seq TO painel_app;

-- Tabelas do login (Better Auth)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  painel_auth_user, painel_auth_session, painel_auth_account,
  painel_auth_verification, painel_auth_rate_limit
  TO painel_app;
