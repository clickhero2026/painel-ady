-- CÓPIA, só para testes, das migrações do site (clickhero2026/site-ady,
-- ../site/db/migrations, commit ada80a6): schema real de teste7d_inscricoes,
-- com as colunas sensíveis, pra conferir que o painel_app não as enxerga.

-- Inscrições da campanha perpétua do teste grátis de 7 dias (ady).
--
-- NÃO roda sozinho: colar no SQL Editor do Neon e executar uma vez, no
-- banco apontado por DATABASE_URL. Só cria coisa nova — nenhuma tabela
-- existente (workshop_leads etc.) é tocada.
--
-- Fluxo (briefing "ady: campanha perpétua do teste grátis", seção 2):
--   etapa 1 (landing page: nome, e-mail, WhatsApp)
--   → etapa 2 (briefing de ativação, perguntas do formulário de onboarding)
--   → agendamento no Calendly → conversa com o Denilson → 7 dias de teste.
-- O que importa é conversa agendada e realizada, por isso o status.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid() (já nativo no PG13+, mas não custa)

CREATE TABLE IF NOT EXISTS teste7d_inscricoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ── Etapa 1 ──
  nome text NOT NULL,
  email text NOT NULL,
  -- Só dígitos, já com o 55 na frente (ex. 5585999999999).
  whatsapp text NOT NULL CHECK (whatsapp ~ '^55[1-9]{2}[0-9]{8,9}$'),
  consentimento_lgpd boolean NOT NULL DEFAULT false,
  consentimento_em timestamptz,

  -- ── Rastreio ──
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,          -- nome do criativo, ex. T7D-R1-H01-VID
  utm_term text,
  lp_variant text CHECK (lp_variant IN ('A', 'B', 'C', 'D', 'E', 'F')),
  fbclid text,
  referrer text,
  landing_url text,
  user_agent text,
  ip_hash text,              -- HMAC-SHA256 do IP; o IP puro nunca é gravado

  -- ── Etapa 2 (briefing de ativação) — tudo opcional, salva por bloco ──
  negocio_nome_oferta text,
  cidade_bairro text,
  atende_todo_brasil boolean,
  acao_desejada text,
  acao_desejada_outro text,
  experiencia_anuncios text,
  acesso_redes text,
  conta_anuncios text,
  cartao_pagamento text,
  arquivo_logo text,
  reuniao_computador text,
  observacoes text,
  etapa2_concluida_em timestamptz,

  -- ── Agendamento ──
  calendly_evento_uri text,
  agendado_em timestamptz,   -- quando a pessoa marcou
  reuniao_em timestamptz,    -- quando a conversa vai acontecer
  realizada_em timestamptz,
  status text NOT NULL DEFAULT 'inscrito' CHECK (status IN (
    'inscrito', 'ativacao_preenchida', 'agendado', 'realizado', 'nao_compareceu'
  )),

  -- ── Bitrix24 ──
  bitrix_lead_id text,
  bitrix_sync_status text NOT NULL DEFAULT 'pendente' CHECK (bitrix_sync_status IN (
    'pendente', 'ok', 'erro'
  )),
  bitrix_sync_em timestamptz,
  bitrix_erro text
);

CREATE UNIQUE INDEX IF NOT EXISTS teste7d_inscricoes_email_uidx
  ON teste7d_inscricoes (lower(email));

CREATE INDEX IF NOT EXISTS teste7d_inscricoes_status_idx
  ON teste7d_inscricoes (status);
CREATE INDEX IF NOT EXISTS teste7d_inscricoes_created_at_idx
  ON teste7d_inscricoes (created_at);
CREATE INDEX IF NOT EXISTS teste7d_inscricoes_utm_content_idx
  ON teste7d_inscricoes (utm_content);
CREATE INDEX IF NOT EXISTS teste7d_inscricoes_lp_variant_idx
  ON teste7d_inscricoes (lp_variant);

-- Usados pelo rate limit (ip_hash + janela de tempo) e pelo reenvio ao
-- Bitrix (/api/teste7d/reenviar-bitrix busca os pendentes/erro).
CREATE INDEX IF NOT EXISTS teste7d_inscricoes_ip_hash_idx
  ON teste7d_inscricoes (ip_hash, updated_at);
CREATE INDEX IF NOT EXISTS teste7d_inscricoes_bitrix_pendentes_idx
  ON teste7d_inscricoes (updated_at)
  WHERE bitrix_sync_status <> 'ok';

-- updated_at automático em todo UPDATE.
CREATE OR REPLACE FUNCTION teste7d_inscricoes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teste7d_inscricoes_updated_at ON teste7d_inscricoes;
CREATE TRIGGER teste7d_inscricoes_updated_at
  BEFORE UPDATE ON teste7d_inscricoes
  FOR EACH ROW
  EXECUTE FUNCTION teste7d_inscricoes_set_updated_at();

-- Retomada do teste grátis por link (/ativar-conta?t=<token>) ou por
-- WhatsApp + e-mail (/ativar-conta). NÃO roda sozinho: colar no SQL
-- Editor do Neon e executar uma vez, depois de 20261027_teste7d_inscricoes.sql.
-- Só acrescenta colunas e um índice em teste7d_inscricoes.

ALTER TABLE teste7d_inscricoes
  ADD COLUMN IF NOT EXISTS token_retomada text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN IF NOT EXISTS ultima_retomada_em timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS teste7d_inscricoes_token_retomada_uidx
  ON teste7d_inscricoes (token_retomada);

-- Contador de tentativas erradas de retomada por WhatsApp + e-mail, por
-- cadastro: sobe quando um dos dois bate e o outro não; com muitas falhas
-- na janela (TESTE7D.retomadaLimite), a retomada desse cadastro fica
-- bloqueada até a janela passar. Zera numa retomada certa.
ALTER TABLE teste7d_inscricoes
  ADD COLUMN IF NOT EXISTS retomada_falhas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retomada_falhas_desde timestamptz;
