-- Perfil "gestor" no painel interno do ady.
--
-- NÃO roda sozinho: rodar UMA vez no Postgres da VPS (Easypanel, serviço
-- "site-ady", banco "ady"), com o DONO das tabelas do painel (não com
-- painel_app), DEPOIS de 20261118_super_admin.sql. Idempotente: rodar de
-- novo não quebra nada nem duplica nada. Tudo numa transação: se algo
-- falhar, nada muda.
--
-- Pode ser colado INTEIRO no psql interativo (console do Easypanel): não
-- usa metacomandos nem variáveis do psql, e o BEGIN/COMMIT está aqui.
-- Se a saída dos SELECTs do fim for maior que a tela, o psql pode abrir o
-- paginador: aperte q para sair dele.
--
-- O que faz: a CHECK de painel_usuarios.papel passa a aceitar 'gestor'.
-- Só isso. Nenhum usuário muda de papel, nenhum GRANT novo:
--   o gestor só reusa escritas que o painel_app já tem (painel_lead_etapa,
--   painel_lead_etapa_historico, painel_lead_anotacao, status/realizada_em
--   de teste7d_inscricoes para a reunião, o INSERT do lead manual e
--   painel_auditoria). O que o gestor pode ou não fazer fica no código
--   (src/lib/papeis.ts e leadsVisiveis em src/lib/leads.ts).
--
-- Ordem com o deploy: pode rodar ANTES do deploy, sem janela de risco. A
-- CHECK só fica mais larga; o código antigo nunca grava 'gestor' (a tela de
-- Usuários dele nem oferece o papel). O contrário (deploy antes) deixaria a
-- tela oferecer "Gestor" e o banco recusar até a migração rodar.
--
-- Atenção: 20261118_super_admin.sql recria a mesma CHECK SEM 'gestor'. Se
-- ela for rodada de novo depois que existir algum gestor, falha na CHECK e
-- desfaz tudo (nada muda); basta rodar esta aqui de novo em seguida.

BEGIN;

-- Pré-requisito: a migração do super admin já rodou (o trigger dela existe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'painel_usuarios'::regclass
       AND tgname = 'painel_usuarios_protege_super_admin' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Rode antes db/migrations/20261118_super_admin.sql (trigger painel_usuarios_protege_super_admin não encontrado).';
  END IF;
END $$;

-- Remove qualquer CHECK de painel_usuarios que fale de "papel" (o nome
-- usado é painel_usuarios_papel_check, mas não dependemos dele) e recria
-- com o papel novo.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'painel_usuarios'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%papel%'
  LOOP
    EXECUTE format('ALTER TABLE painel_usuarios DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE painel_usuarios ADD CONSTRAINT painel_usuarios_papel_check
  CHECK (papel IN ('super_admin', 'admin', 'gestor', 'suporte', 'vendas', 'leitura'));

COMMIT;

-- ── Conferência (só leitura; rodar depois do COMMIT) ──

-- a) CHECK do papel (deve listar os 6 papéis, com 'gestor').
SELECT conname, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint WHERE conrelid = 'painel_usuarios'::regclass AND contype = 'c';

-- b) Triggers de painel_usuarios (continuam os 3 da migração do super admin).
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'painel_usuarios'::regclass AND NOT tgisinternal ORDER BY tgname;

-- c) Usuários ativos por papel (nada mudou; gestor aparece só depois de alguém ser promovido pela tela).
SELECT papel, count(*) FROM painel_usuarios WHERE ativo GROUP BY papel ORDER BY papel;

-- d) Privilégios do painel_app (iguais aos de antes; nenhum GRANT novo).
SELECT t.tabela,
       has_table_privilege('painel_app', t.tabela, 'INSERT') AS ins,
       has_table_privilege('painel_app', t.tabela, 'UPDATE') AS upd,
       has_table_privilege('painel_app', t.tabela, 'DELETE') AS del
  FROM (VALUES ('painel_lead_etapa'), ('painel_lead_etapa_historico'), ('painel_lead_anotacao'),
               ('painel_lead_responsavel'), ('painel_usuarios'), ('painel_auditoria')) AS t(tabela)
 ORDER BY 1;
