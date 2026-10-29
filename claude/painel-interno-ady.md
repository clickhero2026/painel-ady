# Painel interno do ady: briefing de execução (para um chat novo)

Preparado em 28/10/2026, a partir do chat da landing page do teste grátis. Este documento reúne o contexto, as decisões tomadas, o que ainda está em aberto e os prompts para o Claude Code. Um chat novo, sem a conversa anterior, deve conseguir executar a tarefa só com ele.

## 0. Como usar este documento

Abra um chat novo dentro do projeto "Marketing ADY" e envie:

> Leia o documento claude/painel-interno-ady.md por inteiro. Vamos executar o painel interno do ady. Comece confirmando em poucas linhas o que entendeu, liste só as decisões em aberto (seção 4) que ainda precisam de resposta e depois me entregue o prompt da Fase 1 para o Claude Code.

Regras de trabalho com o Rafael (valem para todo o trabalho):

- Português do Brasil, direto, sem enrolação nem tom corporativo.
- Implementação sempre por **prompts prontos para o Claude Code**. Nunca escrever código de aplicação direto no chat. SQL e JSON de fluxo do n8n podem ser entregues no chat.
- Plano com raciocínio antes de construir. O Rafael aprova a abordagem antes da execução.
- Todo prompt tem: contexto, itens numerados, testes e o fechamento "commit local no branch atual, sem push e sem deploy".
- **Migrações:** o Claude Code cria o arquivo, mas NÃO executa. O Rafael roda no SQL Editor do Neon. O arquivo gerado é a fonte de verdade. Já houve divergência entre um SQL passado no chat e o arquivo do código, então sempre comparar.
- Revisar cada relatório do Claude Code e responder com: o que ficou bom, o que exige ação, riscos, e uma lista do que depende do Rafael ou da equipe. Separar fato de hipótese. Se não dá para verificar algo, dizer.
- Variáveis na Vercel são cadastradas pelo Rafael. As `NEXT_PUBLIC_*` entram como **Config** (a Vercel recusa "Secret" para elas). Segredos entram como **Secret**.
- "ady" sempre em minúsculas. A restrição de termos (lead, funil, conversão, engajamento, etc.) vale para as páginas **públicas**. No painel interno, usar o vocabulário da equipe.
- Não oferecer abrir URLs nem navegador sem confirmar que a extensão do Chrome está conectada.

## 1. Objetivo

Um app **interno**, em subdomínio próprio (`painel.useady.com.br`), com login e gestão de usuários, que serve a três usos:

1. **Suporte (onboarding):** estudar o perfil de cada lead antes da reunião de ativação.
2. **Vendas:** estudar o perfil de cada lead antes de iniciar o relacionamento e buscar o fechamento. Cada vendedor vê só os seus leads.
3. **Gestão e marketing:** indicadores do funil por criativo, campanha e versão do título, e estatísticas do perfil dos leads.

**Não é um CRM.** A empresa já tem um CRM rodando em paralelo (Bitrix24 no plano gratuito, sem webhook nem API para criar lead de fora). O painel não guarda notas, status comercial nem funil de vendas. A única informação de gestão que ele precisa é **quem é o responsável por cada lead** (para a regra "cada vendedor vê só os seus") e a marcação de reunião realizada ou não.

## 2. O que já existe

### 2.1 Fluxo público do teste grátis (já no ar)

- Site: repositório `clickhero2026/site-ady` (Next.js 16, App Router, CSS Modules, Vercel). O mesmo projeto Vercel serve o site (`useady.com.br`) e a LP (`lp.useady.com.br`), separados por host em `src/proxy.ts`.
- Fluxo da pessoa: LP (formulário curto: nome, WhatsApp, e-mail) → `/ativacao` (10 perguntas, salva por bloco) → `/agendar` (Calendly embutido) → `/obrigado`. Quem parou no meio retoma por `/ativar-conta` (link com token pessoal ou WhatsApp + e-mail).
- Rastreio: GTM (container `ady-web`) com Pixel do Meta. Conversões: **Lead** (cadastro), **CompleteRegistration** (ativação completa) e **Schedule** (agendamento). Eventos do dataLayer: `generate_lead`, `activation_complete`, `schedule`.
- Bitrix24: integração desligada por flag (`TESTE7D_BITRIX_ATIVO`, padrão "false"). O código continua no repositório.
- Planilha de apoio: um fluxo do n8n copia o Neon para o Google Sheets a cada 5 minutos (colunas incluem `link_ativacao` e `mensagem_whatsapp`). É uma solução provisória até o painel existir.

### 2.2 Banco de dados (Neon, projeto de marketing)

Tabela principal: `teste7d_inscricoes`. **41 colunas originais + 4 da migração de retomada** (`token_retomada`, `ultima_retomada_em`, `retomada_falhas`, `retomada_falhas_desde`).

- Identificação: `id` (uuid), `created_at`, `updated_at`, `nome`, `email` (único, sem diferenciar maiúsculas), `whatsapp` (só dígitos, com 55 na frente), `consentimento_lgpd`, `consentimento_em`.
- Origem: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (nome do criativo, padrão `T7D-R1-H01-VID`), `utm_term`, `lp_variant` (A a F), `fbclid`, `referrer`, `landing_url`, `user_agent`, `ip_hash`.
- Etapa 2 (ativação), todas opcionais: `negocio_nome_oferta`, `cidade_bairro`, `atende_todo_brasil`, `acao_desejada`, `acao_desejada_outro`, `experiencia_anuncios`, `acesso_redes`, `conta_anuncios`, `cartao_pagamento`, `arquivo_logo`, `reuniao_computador`, `observacoes`, `etapa2_concluida_em`.
- Agendamento: `calendly_evento_uri`, `agendado_em`, `reuniao_em`, `realizada_em`, `status`.
- Bitrix (hoje sem uso): `bitrix_lead_id`, `bitrix_sync_status`, `bitrix_sync_em`, `bitrix_erro`.
- `status` aceita: `inscrito`, `ativacao_preenchida`, `agendado`, `realizado`, `nao_compareceu`.
- **As respostas da etapa 2 ficam gravadas como chaves curtas**, não como o texto da opção (por exemplo `so_instagram`). O mapa de chaves e textos está em `src/lib/teste7dOptions.ts` no repositório do site. O painel precisa do mesmo mapa para mostrar o texto humano.
- Link de ativação de cada lead: `https://lp.useady.com.br/ativar-conta?t=<token_retomada>` (válido por 30 dias desde `created_at`). O token funciona como senha da pessoa: quem tem o link abre e altera o cadastro dela.

Como o funil aparece nos dados:

| Etapa | Como medir |
|---|---|
| Cadastro | linha existe (`created_at`) |
| Ativação completa | `etapa2_concluida_em` não nulo |
| Agendou | `agendado_em` não nulo |
| Reunião realizada | `status = 'realizado'` ou `realizada_em` não nulo |
| Não compareceu | `status = 'nao_compareceu'` |

### 2.3 Lacunas conhecidas nos dados

- **`reuniao_em`, `realizada_em` e os status `realizado` e `nao_compareceu` não são preenchidos por nada hoje.** `agendado_em` vem do navegador da pessoa (o Calendly avisa a página), então pode faltar se a pessoa fechar a aba. Corrigir isso é a Fase 0.
- `cidade_bairro` e `negocio_nome_oferta` são texto livre, sem padronização.
- Não há dado de venda fechada nem de pagamento.
- Não há gasto de anúncios no banco.

## 3. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Subdomínio | `painel.useady.com.br` |
| Projeto | Projeto Vercel **separado** e repositório próprio. A LP ficou junto do site por causa do roteamento por host, mas ferramenta interna não deve compartilhar deploy com o site público. |
| Banco | Mesmo Neon, com usuário de banco próprio (`painel_app`), leitura restrita por colunas e escrita só nas tabelas do painel e em duas colunas da tabela de cadastros (`status`, `realizada_em`). |
| Login | Google. A equipe usa Google Workspace, **exceto 2 pessoas (que serão admins)**. Por isso: lista de usuários autorizados por **e-mail** (não por domínio) e, como segunda via, **link mágico por e-mail via SendGrid** (a empresa já tem conta). Quem não está na lista, ou está desativado, não entra por nenhum dos dois métodos. |
| Papéis | `admin`, `suporte`, `vendas`, `leitura` |
| Visibilidade | **Vendedor vê só os leads dos quais é responsável.** Admin vê todos. Suporte vê todos. Leitura vê só números agregados, sem dados pessoais. |
| Escopo | Sem CRM: sem notas, status comercial ou funil de vendas. Há responsável por lead e a marcação de reunião realizada ou não. |
| Prioridade | Fase 1 com fichas dos leads e funil, nessa ordem. |
| Visual | Identidade do ady: tema claro, Gantari, petróleo `#1E88A8` e `#17708A`, laranja `#CF6F03` só como detalhe pequeno. Área interna: clareza antes de enfeite. |

## 4. Decisões em aberto (o chat novo deve pedir só o que ainda faltar)

> Os itens 1 a 5 foram fechados em 28/10/2026: ver a seção 13. Só o item 6 (Fase 3) continua em aberto.

1. **Como cada lead é atribuído a um vendedor.** Opções: (a) o admin atribui manualmente, um a um ou em lote; (b) atribuição automática em rodízio assim que o cadastro entra; (c) regra por campanha ou criativo. Recomendação: começar por (a), com uma fila "Sem responsável" visível para o admin, e deixar o rodízio para depois. Sem uma regra, nenhum vendedor vê lead nenhum.
2. **Ferramenta de agendamento.** O Calendly só mostra a agenda do Denilson se ele for um usuário pago, o que aumenta o custo. Uma alternativa é o link da agenda do Google dele (`calendar.app.google/...`). Resumo da análise feita no chat anterior:
   - O link do Google é gratuito, usa a agenda real dele e cria o Meet, mas **não avisa a nossa página quando alguém marca** e não aceita pré-preenchimento por parâmetro. Perdemos o redirecionamento automático para `/obrigado`, o evento Schedule no Meta e o status `agendado` imediato. Também não há webhook: a data teria de vir de um fluxo do n8n que observa a agenda do Denilson e casa o evento com o cadastro pelo e-mail digitado (que pode diferir do cadastrado).
   - Alternativa com o Calendly: compartilhar a agenda do Google do Denilson com a conta do Google conectada ao Calendly e marcá-la como agenda para checar conflitos. Isso pode evitar o custo do usuário extra, mas o convite sairia em nome do dono da conta do Calendly. É preciso testar na tela "Calendar connections".
   - Pagar o usuário extra costuma sair mais barato do que manter uma gambiarra que quebra a métrica de conversa agendada e realizada.
   - Recomendação: testar a agenda compartilhada no Calendly; se não funcionar, pagar o usuário extra. O link do Google fica como plano de emergência manual.
   - Esta decisão define como a Fase 0 será feita.
3. **Quem são os 2 admins sem Google Workspace** e qual e-mail cada um usa. O link mágico por e-mail resolve esse caso.
4. **Visibilidade dos indicadores para vendas.** Padrão sugerido: indicadores agregados globais para todos os papéis, sem dados pessoais. Confirmar com o Rafael.
5. **Retenção e base legal (LGPD).** Por quanto tempo os dados ficam no painel e qual a base legal para vendas e suporte usarem as respostas. O Rafael deve alinhar com quem cuida da LGPD. O consentimento atual do formulário cobre contato por WhatsApp e e-mail sobre o teste.
6. **Fase 3 (depois):** de onde vem o gasto do Meta (a sugestão é um fluxo do n8n com a API de marketing do Meta gravando gasto diário por anúncio no Neon) e se haverá normalização de cidade e segmento com IA.

## 5. Escopo por fase

### Fase 0: dados que faltam (antes do painel)

- **Webhook do Calendly para o Neon**, em um fluxo do n8n (o plano pago do Calendly libera webhooks). Eventos: agendamento criado e cancelado. Regras: casar com a linha pelo e-mail do convidado (comparação sem diferenciar maiúsculas), com o telefone da primeira pergunta personalizada como segunda chave; gravar `calendly_evento_uri`, `reuniao_em` (início da reunião) e `status = 'agendado'` sem rebaixar quem já está `realizado`; no cancelamento, limpar `reuniao_em` e voltar o status para `ativacao_preenchida` (se a ativação estava concluída) ou `inscrito`. Remarcação deve atualizar `reuniao_em`. O chat novo entrega o JSON do fluxo para importar. Se a decisão 2 for o link do Google, o fluxo muda (observar a agenda do Denilson).
- Criar o repositório e o projeto Vercel, o domínio e o DNS, o cliente OAuth do Google e a chave do SendGrid (seção 9).

### Fase 1: base, fichas e funil

1. Estrutura, login (Google + link mágico), papéis, tela de usuários (admin) e auditoria.
2. Lista de leads e **ficha do lead**.
3. **Indicadores do funil.**

### Fase 2: perfil e operação

4. **Perfil estatístico dos leads.**
5. **Responsável por lead** (atribuição) e **marcar reunião como realizada ou não compareceu.** (Se a atribuição for necessária para a Fase 1 funcionar com vendedores, antecipar este item.)
6. Exportação em CSV (só admin).

### Fase 3: depois

- Gasto do Meta e custo por etapa por criativo.
- Normalização de cidade e segmento (inclusive com IA).
- Alertas de cadastro parado por e-mail ou WhatsApp.
- Ligar a venda fechada (Asaas ou o próprio produto) ao funil.

## 6. Telas e comportamento

### Lista de leads
- Filtros: status, criativo (`utm_content`), campanha, versão do título, período, responsável, busca por nome, e-mail ou WhatsApp. Ordenação e paginação no servidor.
- Visões prontas: "Cadastros parados" (`inscrito` ou `ativacao_preenchida`, com tempo parado), "Agendados esta semana", "Sem reunião marcada", "Sem responsável" (admin).

### Ficha do lead
- Cabeçalho: nome, WhatsApp (botão para abrir a conversa com mensagem pronta e configurável), e-mail, etapa atual e data de cada etapa.
- Origem: criativo, campanha, versão do título, data.
- Negócio: o que vende, onde atende, o que quer que a pessoa faça ao ver o anúncio.
- Experiência com anúncios e acesso às redes.
- **Checklist de prontidão para o onboarding**, para o suporte, com verde, amarelo e vermelho. Regras iniciais (ficam em um arquivo de configuração fácil de editar; o Denilson valida):
  - Redes: "Tenho os dois e sei o login e a senha" verde; "Tenho só o Instagram", "Tenho só o Facebook" e "Tenho, mas quem sabe a senha é outra pessoa" amarelo; "Ainda não tenho" vermelho.
  - Conta de anúncios: "Sim, já tenho" verde; "Não tenho" e "Não sei o que é isso" amarelo.
  - Cartão: "Sim, o cartão está comigo" verde; "Sim, mas o cartão é de outra pessoa" amarelo; "Ainda não tenho" vermelho.
  - Logo: "Sim, tenho o arquivo da logo" verde; "Tenho a logo, mas só em print ou foto de qualidade ruim" e "Não tenho logo" amarelo.
  - Computador: "Sim, consigo pelo computador" verde; "Consigo pelo computador, mas vou precisar de alguém me ajudando" amarelo; "Só consigo pelo celular" vermelho.
- Linha do tempo: cadastro, ativação, agendamento, reunião, realizada, retomadas (`ultima_retomada_em`).
- Ações: copiar o link de ativação (o servidor monta o link; o token nunca aparece solto na tela). Marcar reunião realizada ou não compareceu (suporte e admin).
- Nunca exibir `ip_hash`, `user_agent` nem o token em texto.

### Indicadores do funil
- KPIs do período: cadastros, ativações completas, agendamentos, reuniões realizadas, taxas entre etapas, tempo mediano entre etapas.
- Cortes: período, criativo, campanha, **versão do título A a F** (é o teste da rodada 2), origem.
- Tabela comparativa por criativo e por versão do título, com aviso de **amostra pequena** (por exemplo menos de 30 cadastros).
- Série diária de cadastros e funil em barras.
- Abandono por pergunta da ativação, se os dados permitirem (confirmar no código se o salvamento é por pergunta ou por bloco).
- Corte por coorte de cadastro (a data do cadastro define o período; as etapas seguintes contam mesmo que ocorram depois).

### Perfil estatístico dos leads
- Distribuição de cada resposta da ativação, com filtros iguais aos do funil.
- Comparação do perfil de quem **agendou** com o de quem **abandonou**, e por criativo.
- Cidades e negócios: na Fase 2, lista dos termos mais frequentes depois de normalização simples (sem acento, maiúsculas e espaços). A normalização com IA fica para a Fase 3.
- Para o papel "leitura", ocultar qualquer célula com menos de 5 pessoas.

## 7. Papéis e permissões

| Recurso | admin | suporte | vendas | leitura |
|---|---|---|---|---|
| Lista e ficha de leads | todos | todos | só os seus | não |
| Dados pessoais (nome, WhatsApp, e-mail) | sim | sim | só dos seus | não |
| Link de ativação | sim | sim | só dos seus | não |
| Marcar realizada ou não compareceu | sim | sim | não | não |
| Atribuir responsável | sim | não | não | não |
| Indicadores e perfil agregados | sim | sim | sim (padrão sugerido) | sim, sem dados pessoais |
| Usuários e auditoria | sim | não | não | não |
| Exportar CSV | sim | não | não | não |

A restrição por papel e por responsável deve ser aplicada **no acesso a dados do servidor**, em uma função única (por exemplo `leadsVisiveis(usuario)`), e não só escondendo itens na interface. Teste obrigatório: um vendedor não consegue ler a ficha de um lead alheio nem pela URL direta nem pela API.

## 8. Segurança e LGPD (requisitos)

- Sem rotas públicas. Todas as páginas e APIs exigem sessão válida e usuário ativo na lista. `noindex` em tudo.
- Sessão com tempo limite (8 horas de inatividade e nova autenticação a cada 7 dias).
- Auditoria: quem abriu qual ficha, exportações, atribuições, marcações e mudanças de usuário.
- O usuário de banco do painel não enxerga as colunas sensíveis de que o painel não precisa (`ip_hash`, `user_agent`, `fbclid`, `bitrix_*`, contadores de tentativa).
- Cabeçalhos de segurança (CSP básico, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`), cookies `httpOnly` e `Secure`.
- Limite de tentativas no login por link mágico. O link mágico expira em poucos minutos e é de uso único.
- O token de retomada nunca vai para logs, mensagens de erro nem HTML.
- O Rafael não é advogado nem o assistente: base legal e retenção devem ser alinhadas com quem cuida da LGPD.

## 9. Pré-requisitos manuais do Rafael

1. Criar o repositório `clickhero2026/painel-ady` (ou nome equivalente) e um projeto Vercel novo ligado a ele.
2. Adicionar o domínio `painel.useady.com.br` a esse projeto e criar o CNAME no DNS que a Vercel indicar. Não mexer nos registros do domínio principal.
3. No Google Cloud Console, criar um cliente OAuth (aplicativo da Web) com as URIs de redirecionamento que o prompt 1 indicar, e guardar o ID e o segredo.
4. No SendGrid: chave de API restrita a envio de e-mail e remetente verificado (por exemplo `painel@useady.com.br`).
5. No Neon: criar o usuário de banco do painel e rodar os SQLs de permissão (seção 10.2), depois da migração do prompt 1.
6. Deixar o repositório do site acessível ao Claude Code (por exemplo, o repositório do painel ao lado do repositório do site), ou copiar `src/lib/teste7dOptions.ts` para o novo repositório.
7. Cadastrar as variáveis na Vercel (Production e Preview):
   - `DATABASE_URL` (Secret): a string do Neon com o usuário `painel_app`
   - `AUTH_SECRET` (Secret)
   - `AUTH_GOOGLE_ID` (Secret) e `AUTH_GOOGLE_SECRET` (Secret)
   - `SENDGRID_API_KEY` (Secret) e `EMAIL_FROM` (Config)
   - `PAINEL_ADMIN_INICIAL` (Config): e-mail do primeiro admin
   - `NEXT_PUBLIC_APP_URL` (Config)

## 10. Prompts para o Claude Code

Entregar um por vez, na ordem, só depois de o anterior estar revisado.

### 10.1 Prompt 1: estrutura, login, papéis e usuários

```text
CONTEXTO
Estamos criando o painel interno do ady (painel.useady.com.br), um app SEPARADO do site público, em um repositório e um projeto Vercel novos. Ele lê os cadastros do teste grátis de 7 dias (tabela teste7d_inscricoes, no Neon) e tem login, papéis e gestão de usuários. Neste prompt construímos só a base: estrutura, login, papéis, tela de usuários, auditoria e migração das tabelas do painel. As telas de leads e indicadores vêm nos próximos prompts. Leia o documento claude/painel-interno-ady.md do projeto (se não o encontrar, use o que está neste prompt).

PASSO 0 — RECONHECIMENTO (não escreva código ainda)
Veja se o repositório está vazio e quais pastas existem ao lado (o repositório do site, clickhero2026/site-ady, é referência de convenções). Me devolva um resumo curto do que achou e proponha: o framework e a versão do Next (a mais estável), a biblioteca de interface (sugestão: Tailwind + shadcn/ui + Recharts) e a biblioteca de login. Para o login, compare Auth.js v5 e Better Auth em até 5 linhas e escolha o mais simples para: Google OAuth + link mágico por e-mail (SendGrid) + lista de usuários autorizados por e-mail guardada no Neon. Só continue se não houver bloqueio.

PASSO 1 — ESTRUTURA E VISUAL
- Next.js App Router com TypeScript, lint e testes, e driver @neondatabase/serverless. No Next 16 o antigo middleware se chama proxy.ts.
- Identidade do ady no tema claro: fonte Gantari, petróleo #1E88A8 e #17708A como cor principal, texto #0C0D0A, fundos #FFFFFF e #F4F9FB; laranja #CF6F03 só como detalhe pequeno. "ady" sempre em minúsculas. Interface em português do Brasil, contraste mínimo AA, foco visível, navegação por teclado e uso confortável também em celular.
- Layout com barra lateral, cujos itens dependem do papel (por enquanto: Início, Usuários para admin), página de login, página 403 e página 404.

PASSO 2 — LOGIN E PAPÉIS
- Login com Google e com link mágico por e-mail (SendGrid; link de uso único e válido por 10 minutos). Só entra quem estiver na tabela painel_usuarios com ativo = true, pelos dois métodos. Quem não estiver vê a mesma mensagem neutra, sem revelar se o e-mail existe.
- Papéis: admin, suporte, vendas, leitura. O papel vai para a sessão e é reconferido no servidor a cada requisição (não confiar só no que está na sessão).
- Sessão com expiração: 8 horas de inatividade e nova autenticação a cada 7 dias. Cookies httpOnly e Secure.
- O primeiro admin é criado a partir da variável PAINEL_ADMIN_INICIAL, na primeira tentativa de login, só se a tabela de usuários estiver vazia.
- proxy.ts protege todas as rotas, exceto as de login. Todas as páginas e APIs com noindex e Referrer-Policy: no-referrer; cabeçalhos de segurança básicos (CSP, X-Content-Type-Options).
- Limite de tentativas no envio do link mágico (por e-mail e por IP).

PASSO 3 — TELA DE USUÁRIOS (somente admin)
Lista de usuários; adicionar (e-mail, nome, papel); alterar papel; desativar e reativar. Não pode desativar nem rebaixar o último admin ativo. Cada ação grava auditoria.

PASSO 4 — MIGRAÇÃO (NÃO EXECUTAR; eu rodo no Neon)
Crie db/migrations/<data>_painel_base.sql com exatamente estas tabelas (se a biblioteca de login exigir tabelas próprias, acrescente no mesmo arquivo, com o prefixo painel_auth_):

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

CREATE TABLE IF NOT EXISTS painel_lead_responsavel (
  lead_id uuid PRIMARY KEY REFERENCES teste7d_inscricoes(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES painel_usuarios(id),
  atribuido_por uuid REFERENCES painel_usuarios(id),
  atribuido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS painel_lead_responsavel_usuario_idx ON painel_lead_responsavel (usuario_id);

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

Não toque na tabela teste7d_inscricoes. O banco do painel usa o usuário painel_app, que eu crio à parte.

TESTES (banco de desenvolvimento local; nunca o Neon de produção)
Login com e-mail permitido, não permitido e desativado, nos dois métodos; link mágico expirado e reutilizado; acesso a cada rota por papel (inclusive pela URL direta); último admin protegido; PAINEL_ADMIN_INICIAL; limite de tentativas; sessão expirada. Lint, tipos e build. Capturas do login, do início e da tela de usuários em 360 e 1280 de largura.

ENTREGA
Documente todas as variáveis no .env.example (DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, SENDGRID_API_KEY, EMAIL_FROM, PAINEL_ADMIN_INICIAL, NEXT_PUBLIC_APP_URL) e as URIs de redirecionamento do Google que preciso cadastrar. Liste o que depende de mim. Commit local no branch atual, sem push e sem deploy.
```

### 10.2 SQL de permissões (o Rafael roda no Neon depois da migração do prompt 1)

Trocar a senha antes de rodar. Montar a `DATABASE_URL` do painel com a string do Neon, trocando usuário e senha por `painel_app`.

```sql
CREATE ROLE painel_app LOGIN PASSWORD 'TROCAR_POR_UMA_SENHA_FORTE';
GRANT USAGE ON SCHEMA public TO painel_app;

-- Leitura dos cadastros, sem as colunas sensíveis que o painel não usa
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
```

Se a biblioteca de login criar tabelas próprias (`painel_auth_*`), o Claude Code deve informar os `GRANT` correspondentes. Se alguma coluna da lista não existir, o Neon mostra o erro e é só ajustar a lista.

### 10.3 Prompt 2: leads e ficha

```text
CONTEXTO
Continuação do painel interno do ady. A base (login, papéis, usuários, auditoria) já existe. Agora construímos a lista de leads e a ficha do lead. Releia o documento claude/painel-interno-ady.md (seções 2, 6 e 7). O banco do painel usa o usuário painel_app, que só lê colunas autorizadas da tabela teste7d_inscricoes. Se alguma coluna de que precisar não estiver autorizada, me avise em vez de contornar.

1. MAPA DE RESPOSTAS
As respostas da ativação estão gravadas como chaves curtas. Use src/lib/teste7dOptions.ts do repositório do site (ou a cópia no repositório do painel) para mostrar o texto humano de cada opção. Se uma chave não existir no mapa, mostre a chave bruta sem quebrar a tela. Crie um teste que alerte se uma chave presente no banco não estiver no mapa.

2. VISIBILIDADE (aplicar no servidor)
Crie uma função única de acesso a dados (por exemplo leadsVisiveis(usuario)) usada por TODA consulta de lead:
- admin e suporte: todos os leads; vendas: só os leads em painel_lead_responsavel com usuario_id igual ao do usuário; leitura: nenhum acesso a leads individuais.
- Um vendedor não pode ler a ficha de lead alheio nem pela URL direta, nem pela API, nem por busca. Resposta 404 para o que não é dele.

3. LISTA DE LEADS
Paginação e ordenação no servidor. Filtros: status, criativo (utm_content), campanha, versão do título, período, responsável, busca por nome, e-mail ou WhatsApp. Visões prontas: "Cadastros parados" (inscrito ou ativacao_preenchida, com o tempo parado), "Agendados esta semana", "Sem reunião marcada" e "Sem responsável" (esta só para admin). Colunas: nome, etapa, criativo, versão do título, data do cadastro, responsável, reunião.

4. FICHA DO LEAD
- Cabeçalho: nome, WhatsApp (botão que abre o wa.me com uma mensagem pronta; o texto fica em um arquivo de configuração), e-mail, etapa atual.
- Blocos: origem (criativo, campanha, versão do título), negócio (o que vende, onde atende, o que quer que a pessoa faça ao ver o anúncio), experiência com anúncios e acesso às redes, observações.
- Checklist de prontidão para o onboarding (redes, conta de anúncios, cartão, logo, computador) com verde, amarelo e vermelho, conforme as regras da seção 6 do documento. As regras ficam em um arquivo de configuração fácil de editar.
- Linha do tempo: cadastro, ativação, agendamento, reunião, realizada, retomadas.
- Botão "Copiar link de ativação": o servidor monta o link (https://lp.useady.com.br/ativar-conta?t=<token>) e o entrega só no clique; o token nunca aparece em texto na tela, em HTML inicial ou em log. Apenas admin, suporte e o vendedor responsável.
- Nunca exibir ip_hash, user_agent nem fbclid.
- Cada abertura de ficha grava auditoria (ver_lead); cada cópia de link grava auditoria (copiar_link).

5. TESTES
Cada papel contra cada rota e cada API; vendedor tentando ler lead alheio (URL direta, API e busca); filtros e paginação; chaves sem mapa; token ausente de HTML, respostas e logs; auditoria gravada. Interface legível em 360, 390 e 1280 de largura, texto a 200% sem cortar, axe sem violações, Lighthouse com acessibilidade 100. Lint, tipos e build.

ENTREGA
Capturas da lista e da ficha em 360 e 1280. Liste o que depende de mim e as decisões que tomou por conta própria. Commit local no branch atual, sem push e sem deploy.
```

### 10.4 Prompt 3: indicadores do funil

```text
CONTEXTO
Continuação do painel interno do ady. Agora construímos os indicadores do funil. Releia o documento claude/painel-interno-ady.md (seções 2.2, 2.3 e 6). Todos os papéis veem os indicadores agregados, sem dados pessoais (padrão sugerido; se o Rafael decidir outro, ele avisa).

1. DEFINIÇÕES (usar exatamente estas, em um único módulo de consultas)
- Cadastro: linha em teste7d_inscricoes (created_at no período).
- Ativação completa: etapa2_concluida_em não nulo.
- Agendou: agendado_em não nulo.
- Reunião realizada: status = 'realizado' ou realizada_em não nulo.
- Não compareceu: status = 'nao_compareceu'.
- Corte por coorte: a data do cadastro define o período; as etapas seguintes contam mesmo que ocorram depois.
- Quando reuniao_em, realizada_em e status de reunião ainda estiverem vazios (Fase 0 pendente), mostre "sem dados" nos indicadores de reunião, sem zero enganoso.

2. TELA DE FUNIL
- KPIs: cadastros, ativações completas, agendamentos, reuniões realizadas, taxa de cada passo e tempo mediano entre etapas.
- Funil em barras e série diária de cadastros.
- Cortes: período, criativo (utm_content), campanha (utm_campaign), origem (utm_source e utm_medium) e versão do título (lp_variant, A a F).
- Tabela comparativa por criativo e por versão do título, com ordenação e aviso de "amostra pequena" quando houver menos de 30 cadastros.
- Abandono por pergunta da ativação, se o salvamento permitir. Confirme no código do site (repositório clickhero2026/site-ady) se as respostas são gravadas por pergunta ou por bloco, e mostre só o que for verdadeiro.
- Exporte a tabela comparativa em CSV apenas para admin, com auditoria.

3. DESEMPENHO E QUALIDADE
Consultas agregadas no servidor, usando os índices existentes (status, created_at, utm_content, lp_variant). Confira o plano de execução das consultas principais e me avise se algum índice novo ajudaria (não crie). Gráficos acessíveis (cores com contraste, rótulos, alternativa em tabela) e legíveis em 360px.

4. TESTES
Os números batem com uma contagem independente em SQL sobre um conjunto de dados de teste conhecido; filtros combinados; períodos vazios; amostra pequena; sem dados de reunião. Lint, tipos e build. Capturas em 360 e 1280.

ENTREGA
Liste decisões tomadas por conta própria e o que depende de mim. Commit local no branch atual, sem push e sem deploy.
```

### 10.5 Prompt 4: perfil estatístico

```text
CONTEXTO
Continuação do painel interno do ady. Agora construímos a tela de perfil estatístico dos leads. Releia o documento claude/painel-interno-ady.md (seções 2.2 e 6).

1. DISTRIBUIÇÕES
Para cada resposta da ativação (acao_desejada, experiencia_anuncios, acesso_redes, conta_anuncios, cartao_pagamento, arquivo_logo, reuniao_computador) e para atende_todo_brasil: contagem e percentual, com o texto humano das opções (mapa de teste7dOptions), os mesmos filtros do funil (período, criativo, campanha, versão do título) e o total de leads considerado.

2. COMPARAÇÕES
Para cada pergunta, mostre lado a lado o perfil de quem chegou a agendar e o de quem não chegou, e permita o corte por criativo. Destaque diferenças relevantes só quando a amostra for suficiente (aviso de amostra pequena abaixo de 30).

3. CIDADES E NEGÓCIOS (texto livre)
Cidade e negócio são texto livre. Faça uma normalização simples (minúsculas, sem acentos, espaços e pontuação) e mostre os termos mais frequentes. Não invente categorias. A classificação com IA é uma fase posterior.

4. PRIVACIDADE
Esta tela mostra só agregados. Para o papel "leitura", oculte qualquer célula com menos de 5 pessoas. Nenhum dado pessoal aparece aqui.

5. TESTES
Os números batem com contagens independentes em SQL; células pequenas ocultas para "leitura"; filtros combinados; chaves sem mapa. Acessibilidade (gráficos com alternativa em tabela), 360 e 1280 de largura, lint, tipos e build.

ENTREGA
Capturas, decisões por conta própria e o que depende de mim. Commit local no branch atual, sem push e sem deploy.
```

### 10.6 Prompt 5: responsável e reunião realizada

```text
CONTEXTO
Continuação do painel interno do ady. Agora implementamos (a) a atribuição de responsável por lead e (b) a marcação de reunião realizada ou não compareceu. Releia o documento claude/painel-interno-ady.md (seções 3, 4 e 7). A regra de atribuição escolhida pelo Rafael está registrada no documento (decisão em aberto nº 1); se ainda estiver em aberto, implemente a atribuição manual pelo admin.

1. ATRIBUIÇÃO (admin)
- Na lista e na ficha, o admin atribui ou troca o responsável (só usuários ativos com papel vendas ou admin). Atribuição em lote a partir da lista (seleção de vários leads).
- Fila "Sem responsável" para o admin, ordenada pelos mais recentes, com contador no menu.
- Cada atribuição grava em painel_lead_responsavel e na auditoria. O vendedor só passa a ver o lead depois da atribuição.
- Ao desativar um vendedor, os leads dele aparecem na fila "Sem responsável" (não ficam órfãos nem apagados).

2. REUNIÃO REALIZADA (suporte e admin)
- Na ficha de um lead com status agendado, botões "Reunião realizada" e "Não compareceu". Gravam status e realizada_em (o usuário do painel só pode atualizar essas duas colunas).
- Validar a transição no servidor: só a partir de agendado; permitir desfazer para agendado dentro de 24 horas, com auditoria.
- Visão "Reuniões para fechar": agendados cuja reunião (reuniao_em, quando existir) já passou.

3. TESTES
Quem pode e quem não pode atribuir e marcar (por papel); lote; vendedor desativado; transições inválidas; desfazer; auditoria. Lint, tipos e build. Capturas em 360 e 1280.

ENTREGA
Decisões por conta própria e o que depende de mim. Commit local no branch atual, sem push e sem deploy.
```

## 11. Verificação final antes de liberar para a equipe

1. Login com cada papel, incluindo um dos admins sem Google (link mágico).
2. Um vendedor de teste só vê os leads atribuídos a ele (e recebe 404 nos demais).
3. O papel "leitura" não vê nenhum dado pessoal, nem em exportações.
4. Os números do funil batem com uma contagem direta no Neon.
5. O token de retomada não aparece em HTML, respostas ou logs.
6. A auditoria registra abertura de ficha, cópia de link, atribuição e marcação de reunião.
7. O painel não está indexado e `painel.useady.com.br` não responde sem login.
8. Teste em celular real (iPhone e Android).
9. Remover a planilha provisória do n8n só depois de a equipe usar o painel por alguns dias.

## 12. Fora do escopo

CRM (notas, status comercial, funil de vendas), cobrança, integração de pagamento, e qualquer alteração no site público ou na LP. Se uma mudança no site for necessária (por exemplo, o webhook do Calendly), tratar em prompt separado, no repositório do site.

## 13. Decisões fechadas em 28/10/2026

1. Atribuição de lead: manual pelo admin, com fila "Sem responsável". Rodízio fica para depois.
2. Agendamento (Calendly ou Google): fora do escopo do painel. Enquanto reuniao_em, realizada_em e os status de reunião não forem preenchidos por algum fluxo, os indicadores de reunião mostram "sem dados".
3. Os 2 admins sem Google Workspace usam e-mails @vendedormestre.com.br e @marketinglabs.com.br e entram por link mágico. O acesso é sempre por lista de e-mails, nunca por domínio.
4. Indicadores para vendas: agregados globais, sem dados pessoais.
5. LGPD (retenção e base legal): tratada pelo Rafael fora deste projeto.
6. Estrutura de pastas: o repositório do site fica em ../site, ao lado do painel.
