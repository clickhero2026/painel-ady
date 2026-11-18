-- Super admin do painel interno do ady + permissão para apagar lead.
--
-- NÃO roda sozinho: rodar UMA vez no Postgres da VPS (Easypanel, serviço
-- "site-ady", banco "ady"), com o DONO das tabelas do painel (não com
-- painel_app), depois de 20261028_painel_base.sql, 20261103_painel_pipeline.sql
-- e dos arquivos de db/grants/. Idempotente: rodar de novo não quebra nada
-- nem duplica nada. Tudo numa transação: se algo falhar, nada muda.
--
-- O que faz, na ordem:
--   1. CHECK de painel_usuarios.papel passa a aceitar 'super_admin' (e no
--      máximo UM super admin, por índice único parcial).
--   2. Trava do "último admin ativo" no banco, contando admin + super_admin.
--   3. Trigger que protege o super admin: o painel_app não cria, não
--      apaga, não desativa, não troca papel nem e-mail de super admin, e
--      não concede o papel a ninguém. O dono do banco continua podendo
--      (é assim que se troca o super admin, à mão, se um dia precisar).
--   4. UPSERT de rafael@clickhero.com.br como super_admin ativo (sem mexer
--      em nome nem no histórico se a linha já existe).
--   5. GRANT DELETE em teste7d_inscricoes para o painel_app (apagar lead).
-- No fim, um bloco de SELECTs de conferência (só leitura).

BEGIN;

-- ── 1. Papel super_admin ──
-- Remove qualquer CHECK de painel_usuarios que fale de "papel" (o nome
-- automático é painel_usuarios_papel_check, mas não dependemos dele) e
-- recria com o papel novo.
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
  CHECK (papel IN ('super_admin', 'admin', 'suporte', 'vendas', 'leitura'));

-- No máximo um super admin.
CREATE UNIQUE INDEX IF NOT EXISTS painel_usuarios_um_super_admin_uidx
  ON painel_usuarios ((true)) WHERE papel = 'super_admin';

-- Nos dois triggers abaixo, "ajuste manual" = quem roda é o dono de
-- painel_usuarios (ou superusuário) e não é o painel_app. Só esse passa
-- por cima das travas (é assim que se troca o super admin à mão).

-- ── 2. Trava do último admin ativo (admin + super_admin) ──
-- O código (src/lib/usuarios.ts) já confere isso com as linhas travadas;
-- aqui é a segunda barreira. Só dispara quando a instrução tirou um admin
-- ativo e não sobrou nenhum admin/super admin ativo.
CREATE OR REPLACE FUNCTION painel_usuarios_ultimo_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'painel_app'
     AND pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'USAGE') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM antes WHERE ativo AND papel IN ('super_admin', 'admin'))
     AND NOT EXISTS (SELECT 1 FROM painel_usuarios WHERE ativo AND papel IN ('super_admin', 'admin')) THEN
    RAISE EXCEPTION 'painel_usuarios: precisa sobrar pelo menos um admin ou super admin ativo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS painel_usuarios_ultimo_admin_upd ON painel_usuarios;
CREATE TRIGGER painel_usuarios_ultimo_admin_upd
  AFTER UPDATE ON painel_usuarios
  REFERENCING OLD TABLE AS antes
  FOR EACH STATEMENT EXECUTE FUNCTION painel_usuarios_ultimo_admin();

DROP TRIGGER IF EXISTS painel_usuarios_ultimo_admin_del ON painel_usuarios;
CREATE TRIGGER painel_usuarios_ultimo_admin_del
  AFTER DELETE ON painel_usuarios
  REFERENCING OLD TABLE AS antes
  FOR EACH STATEMENT EXECUTE FUNCTION painel_usuarios_ultimo_admin();

-- ── 3. Proteção do super admin ──
CREATE OR REPLACE FUNCTION painel_usuarios_protege_super_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'painel_app'
     AND pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'USAGE') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.papel = 'super_admin' THEN
    RAISE EXCEPTION 'painel_usuarios: o papel super_admin só é definido por migração'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'DELETE' AND OLD.papel = 'super_admin' THEN
    RAISE EXCEPTION 'painel_usuarios: o super admin não pode ser apagado pelo painel'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'UPDATE' AND (OLD.papel = 'super_admin' OR NEW.papel = 'super_admin')
        AND (NEW.papel IS DISTINCT FROM OLD.papel
             OR NEW.ativo IS DISTINCT FROM OLD.ativo
             OR lower(NEW.email) IS DISTINCT FROM lower(OLD.email)) THEN
    RAISE EXCEPTION 'painel_usuarios: o super admin não pode ter papel, acesso ou e-mail alterados pelo painel'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS painel_usuarios_protege_super_admin ON painel_usuarios;
CREATE TRIGGER painel_usuarios_protege_super_admin
  BEFORE INSERT OR UPDATE OR DELETE ON painel_usuarios
  FOR EACH ROW EXECUTE FUNCTION painel_usuarios_protege_super_admin();

-- ── 4. O super admin ──
-- Linha nova: entra como super_admin ativo. Linha existente (mesmo e-mail,
-- sem diferenciar maiúsculas): só papel e ativo mudam; nome, id, datas e
-- auditoria ficam como estão.
INSERT INTO painel_usuarios (email, papel, ativo)
VALUES ('rafael@clickhero.com.br', 'super_admin', true)
ON CONFLICT ((lower(email))) DO UPDATE
  SET papel = 'super_admin', ativo = true
  WHERE painel_usuarios.papel IS DISTINCT FROM 'super_admin' OR NOT painel_usuarios.ativo;

-- ── 5. GRANTs ──
-- Apagar lead = DELETE na tabela de cadastros. É o ÚNICO privilégio novo.
-- Não é preciso DELETE nas tabelas dependentes (painel_lead_responsavel,
-- painel_lead_etapa, painel_lead_etapa_historico, painel_lead_anotacao,
-- painel_lead_mescla): todas apontam para teste7d_inscricoes com ON DELETE
-- CASCADE, e a cascata roda com os direitos do dono do banco. Assim o
-- histórico e as anotações continuam "só INSERT" para o painel_app.
-- O WHERE id = ... e o RETURNING (status, utm_content, utm_campaign,
-- lp_variant, created_at) usam colunas que o painel_app já lê.
-- Atenção: DELETE não existe por coluna nem por linha no GRANT; isto deixa
-- o painel_app apagar QUALQUER cadastro. A regra "só super admin" fica no
-- código (src/lib/apagarLead.ts). Alternativa mais restrita no relatório.
GRANT DELETE ON teste7d_inscricoes TO painel_app;

COMMIT;

-- ── Conferência (só leitura; rodar depois do COMMIT) ──

-- a) CHECK do papel (deve listar os 5 papéis) e o índice de super admin único.
SELECT conname, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint WHERE conrelid = 'painel_usuarios'::regclass AND contype = 'c';
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'painel_usuarios_um_super_admin_uidx';

-- b) Triggers de painel_usuarios (devem aparecer os 3).
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'painel_usuarios'::regclass AND NOT tgisinternal ORDER BY tgname;

-- c) O super admin (uma linha: rafael@clickhero.com.br, super_admin, ativo).
SELECT id, email, nome, papel, ativo, criado_em FROM painel_usuarios WHERE papel = 'super_admin';

-- d) Admins ativos (admin + super_admin; tem de ser 1 ou mais).
SELECT papel, count(*) FROM painel_usuarios WHERE ativo GROUP BY papel ORDER BY papel;

-- e) Chaves estrangeiras que apontam para teste7d_inscricoes e o ON DELETE
--    de cada uma ('c' = CASCADE). Qualquer linha que não seja 'c' faz o
--    "Apagar lead" falhar (e nada é apagado): avisar antes de usar.
SELECT conrelid::regclass AS tabela, conname, confdeltype AS on_delete, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint WHERE contype = 'f' AND confrelid = 'teste7d_inscricoes'::regclass ORDER BY 1, 2;

-- f) Privilégios do painel_app nas tabelas do lead (DELETE só em teste7d_inscricoes).
SELECT t.tabela,
       has_table_privilege('painel_app', t.tabela, 'SELECT') AS sel,
       has_table_privilege('painel_app', t.tabela, 'INSERT') AS ins,
       has_table_privilege('painel_app', t.tabela, 'UPDATE') AS upd,
       has_table_privilege('painel_app', t.tabela, 'DELETE') AS del
  FROM (VALUES ('teste7d_inscricoes'), ('painel_lead_responsavel'), ('painel_lead_etapa'),
               ('painel_lead_etapa_historico'), ('painel_lead_anotacao'), ('painel_lead_mescla'),
               ('painel_usuarios'), ('painel_auditoria')) AS t(tabela)
 ORDER BY 1;
-- (has_table_privilege SELECT/INSERT/UPDATE dá false em teste7d_inscricoes
--  porque lá os privilégios são por coluna; é o esperado.)

-- g) Dono de painel_usuarios: NÃO pode ser o painel_app (senão a proteção
--    do super admin não vale para ele).
SELECT tableowner FROM pg_tables WHERE tablename = 'painel_usuarios';
