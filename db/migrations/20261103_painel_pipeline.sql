-- Pipeline comercial do painel interno do ady: etapa comercial por lead
-- (com histórico), anotações internas e mescla de cadastros duplicados.
--
-- NÃO roda sozinho: colar no SQL Editor do Neon e executar uma vez, com o
-- dono do banco, no MESMO banco de teste7d_inscricoes e depois de
-- 20261028_painel_base.sql. Só cria tabelas e índices novos;
-- teste7d_inscricoes não é alterada (a etapa comercial é independente do
-- `status` do site). Depois desta migração, rodar
-- db/grants/painel_app_pipeline.sql.
--
-- Chaves das etapas e dos motivos de perda: src/config/pipeline.ts. As
-- etapas têm CHECK aqui (mudar a lista exige migração); os motivos não
-- (a lista é editável no código, e um motivo antigo continua aparecendo).

-- ── Etapa atual ──
-- Uma linha por lead que já teve a etapa mudada. Lead sem linha está em
-- "nao_contatado" desde o cadastro (created_at).
CREATE TABLE IF NOT EXISTS painel_lead_etapa (
  lead_id uuid PRIMARY KEY REFERENCES teste7d_inscricoes(id) ON DELETE CASCADE,
  etapa text NOT NULL CHECK (etapa IN (
    'nao_contatado', 'tentativa_contato', 'reuniao_marcada', 'negociacao',
    'negocio_provavel', 'negocio_fechado', 'negocio_perdido'
  )),
  motivo_perda text,
  motivo_perda_texto text CHECK (char_length(motivo_perda_texto) <= 500),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES painel_usuarios(id),
  -- Perdido sempre com motivo; as outras etapas nunca com motivo.
  CONSTRAINT painel_lead_etapa_motivo_ck CHECK (
    (etapa = 'negocio_perdido') = (motivo_perda IS NOT NULL)
    AND (motivo_perda_texto IS NULL OR motivo_perda IS NOT NULL)
  )
);
-- Colunas do pipeline (por etapa, e Fechado/Perdido pelos últimos 30 dias).
CREATE INDEX IF NOT EXISTS painel_lead_etapa_etapa_idx ON painel_lead_etapa (etapa, atualizado_em);

-- ── Histórico das mudanças de etapa ──
-- Só INSERT (o painel_app não tem UPDATE nem DELETE aqui).
CREATE TABLE IF NOT EXISTS painel_lead_etapa_historico (
  id bigserial PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES teste7d_inscricoes(id) ON DELETE CASCADE,
  etapa_de text NOT NULL CHECK (etapa_de IN (
    'nao_contatado', 'tentativa_contato', 'reuniao_marcada', 'negociacao',
    'negocio_provavel', 'negocio_fechado', 'negocio_perdido'
  )),
  etapa_para text NOT NULL CHECK (etapa_para IN (
    'nao_contatado', 'tentativa_contato', 'reuniao_marcada', 'negociacao',
    'negocio_provavel', 'negocio_fechado', 'negocio_perdido'
  )),
  motivo_perda text,
  motivo_perda_texto text CHECK (char_length(motivo_perda_texto) <= 500),
  usuario_id uuid REFERENCES painel_usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT painel_lead_etapa_historico_mudou_ck CHECK (etapa_de <> etapa_para),
  CONSTRAINT painel_lead_etapa_historico_motivo_ck CHECK (
    (etapa_para = 'negocio_perdido') = (motivo_perda IS NOT NULL)
    AND (motivo_perda_texto IS NULL OR motivo_perda IS NOT NULL)
  )
);
-- Histórico da ficha e tempo em cada etapa (funil comercial).
CREATE INDEX IF NOT EXISTS painel_lead_etapa_historico_lead_idx ON painel_lead_etapa_historico (lead_id, criado_em, id);

-- ── Anotações internas ──
-- Só INSERT: não se edita nem se apaga anotação (regra atual).
CREATE TABLE IF NOT EXISTS painel_lead_anotacao (
  id bigserial PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES teste7d_inscricoes(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES painel_usuarios(id),
  texto text NOT NULL CHECK (char_length(btrim(texto)) >= 1 AND char_length(texto) <= 2000),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS painel_lead_anotacao_lead_idx ON painel_lead_anotacao (lead_id, criado_em DESC);

-- ── Mescla de cadastros ──
-- O duplicado some de todas as listas e contagens (o painel filtra por
-- NOT EXISTS nesta tabela); nada é apagado. Desfazer = DELETE da linha.
-- Um principal nunca é duplicado de outro: ao mesclar um principal, os
-- duplicados dele passam a apontar para o novo principal (o painel faz
-- isso na mesma transação).
CREATE TABLE IF NOT EXISTS painel_lead_mescla (
  duplicado_id uuid PRIMARY KEY REFERENCES teste7d_inscricoes(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES teste7d_inscricoes(id) ON DELETE CASCADE,
  mesclado_por uuid REFERENCES painel_usuarios(id),
  mesclado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT painel_lead_mescla_diferentes_ck CHECK (duplicado_id <> principal_id)
);
CREATE INDEX IF NOT EXISTS painel_lead_mescla_principal_idx ON painel_lead_mescla (principal_id);
