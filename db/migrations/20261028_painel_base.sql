-- Base do painel interno do ady (painel.useady.com.br): usuários, papéis,
-- responsável por lead, auditoria e as tabelas do login (Better Auth).
--
-- NÃO roda sozinho: colar no SQL Editor do Neon e executar uma vez, no
-- MESMO banco em que já existe teste7d_inscricoes (painel_lead_responsavel
-- aponta pra ela). Só cria coisa nova; teste7d_inscricoes não é alterada.
-- Rodar com o dono do banco (não com painel_app); as permissões do
-- painel_app estão no fim do arquivo.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid() (já nativo no PG13+)

-- ── Usuários e papéis ──
-- Acesso SEMPRE por esta lista (e-mail + ativo), nunca por domínio.
CREATE TABLE IF NOT EXISTS painel_usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  nome text,
  papel text NOT NULL CHECK (papel IN ('admin', 'suporte', 'vendas', 'leitura')),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS painel_usuarios_email_uidx ON painel_usuarios (lower(email));

-- ── Responsável por lead ──
CREATE TABLE IF NOT EXISTS painel_lead_responsavel (
  lead_id uuid PRIMARY KEY REFERENCES teste7d_inscricoes(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES painel_usuarios(id),
  atribuido_por uuid REFERENCES painel_usuarios(id),
  atribuido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS painel_lead_responsavel_usuario_idx ON painel_lead_responsavel (usuario_id);

-- ── Auditoria ──
CREATE TABLE IF NOT EXISTS painel_auditoria (
  id bigserial PRIMARY KEY,
  usuario_id uuid REFERENCES painel_usuarios(id),
  acao text NOT NULL,
  lead_id uuid,
  detalhe jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS painel_auditoria_criado_em_idx ON painel_auditoria (criado_em);
CREATE INDEX IF NOT EXISTS painel_auditoria_lead_idx ON painel_auditoria (lead_id);

-- ── Login (Better Auth) ──
-- Geradas a partir de src/lib/auth.ts (scripts/gerar-sql-auth.ts). Os nomes
-- de tabela e coluna são os mapeados lá; mudar um lado exige mudar o outro.
-- O vínculo com painel_usuarios é pelo e-mail (sem diferenciar maiúsculas).

CREATE TABLE IF NOT EXISTS painel_auth_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma linha por sessão aberta. expires_at anda 8h a cada uso; created_at
-- marca a autenticação (o painel exige login de novo 7 dias depois dela).
CREATE TABLE IF NOT EXISTS painel_auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL REFERENCES painel_auth_user (id) ON DELETE CASCADE,
  papel text -- informativo; o papel valendo é o de painel_usuarios
);
CREATE INDEX IF NOT EXISTS painel_auth_session_user_id_idx ON painel_auth_session (user_id);

-- Contas vinculadas (Google). Tokens do Google gravados criptografados.
CREATE TABLE IF NOT EXISTS painel_auth_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES painel_auth_user (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS painel_auth_account_user_id_idx ON painel_auth_account (user_id);

-- Links mágicos pendentes (token guardado como hash, 10 min, uso único) e
-- estado do OAuth.
CREATE TABLE IF NOT EXISTS painel_auth_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS painel_auth_verification_identifier_idx ON painel_auth_verification (identifier);

-- Limite de tentativas (do Better Auth e do envio do link mágico, chaves
-- "painel:*" — ver src/lib/limite.ts).
CREATE TABLE IF NOT EXISTS painel_auth_rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);

-- ── Permissões do painel_app ──
-- Em db/grants/painel_app.sql (rodar depois desta migração).
