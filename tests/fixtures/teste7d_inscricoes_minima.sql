-- Só para testes: versão mínima de teste7d_inscricoes (a tabela de verdade
-- é do site, clickhero2026/site-ady), o bastante para a chave estrangeira
-- de painel_lead_responsavel existir no banco local de teste.
CREATE TABLE IF NOT EXISTS teste7d_inscricoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  email text NOT NULL
);
