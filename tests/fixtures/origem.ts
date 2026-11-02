/**
 * Cadastros de teste da origem, conhecidos e fixos (inseridos pelo dono do
 * banco). Outubro de 2026, horário de São Paulo. Grupos normalizados:
 *   meta / ga2 / ad16      12 (variações de maiúsculas e espaços)
 *   meta / ga2 / ad17       3 (pequeno: "leitura" não vê)
 *   meta / ga3 / promo natal 6 (com espaços internos repetidos)
 *   google / cpc / brand    8
 *   (sem origem) × 3        7 (nulo, vazio e só espaços)
 *   <img…> / html / =cmd…   6 (texto malicioso)
 *   tiktok / ads / x1       2 (na virada do dia, 10/10 23h30 e 11/10 00h10)
 *   news / email / pessoa@… 1 (e-mail dentro do UTM: não pode sair)
 */
type Sql = (texto: string, valores?: unknown[]) => Promise<unknown>;

export const HTML_MALICIOSO = "<IMG src=x onerror=alert(1)>";
export const FORMULA = '=HYPERLINK("http://mal.example","x")';
export const EMAIL_NO_UTM = "pessoa.vazada@exemplo.com";

interface Grupo {
  n: number;
  source: (i: number) => string | null;
  medium: (i: number) => string | null;
  campaign: (i: number) => string | null;
  dia?: (i: number) => string;
}

const fixo = (v: string | null) => () => v;
const variar = (lista: (string | null)[]) => (i: number) => lista[i % lista.length];

export const GRUPOS_ORIGEM: Grupo[] = [
  { n: 12, source: variar(["Meta", "meta", " META ", "mEtA"]), medium: variar(["GA2", "ga2 "]), campaign: variar(["AD16", "ad16"]) },
  { n: 3, source: fixo("meta"), medium: fixo("ga2"), campaign: fixo("ad17") },
  { n: 6, source: fixo("meta"), medium: fixo("ga3"), campaign: variar(["Promo   Natal", "promo natal"]) },
  { n: 8, source: fixo("Google"), medium: fixo("CPC"), campaign: fixo("Brand") },
  { n: 7, source: variar([null, "", "   "]), medium: variar([null, "", "  "]), campaign: variar([null, " ", ""]) },
  { n: 6, source: fixo(HTML_MALICIOSO), medium: fixo("html"), campaign: fixo(FORMULA) },
  {
    n: 2,
    source: fixo("tiktok"),
    medium: fixo("ads"),
    campaign: fixo("x1"),
    dia: (i) => (i === 0 ? "2026-10-10T23:30:00-03:00" : "2026-10-11T00:10:00-03:00"),
  },
  { n: 1, source: fixo("news"), medium: fixo("email"), campaign: fixo(EMAIL_NO_UTM) },
];

export const TOTAL_ORIGEM = GRUPOS_ORIGEM.reduce((s, g) => s + g.n, 0);

/** Nomes, e-mails e WhatsApps do conjunto: nada disso pode sair no bloco. */
export const pessoalOrigem = (n: number) => [`Pessoa Origem ${n}`, `origem${n}@exemplo.com.br`, `55859700${String(n).padStart(5, "0")}`];

export async function semearOrigem(sql: Sql): Promise<void> {
  let n = 0;
  for (const g of GRUPOS_ORIGEM) {
    for (let i = 0; i < g.n; i++, n++) {
      const [nome, email, whatsapp] = pessoalOrigem(n);
      // Ativou: 2 de cada 3. Agendou: 1 de cada 3.
      await sql(
        `INSERT INTO teste7d_inscricoes (id, created_at, nome, email, whatsapp, token_retomada,
           utm_source, utm_medium, utm_campaign, etapa2_concluida_em, agendado_em)
         VALUES (gen_random_uuid(), $1::timestamptz, $2, $3, $4, $5, $6, $7, $8,
           CASE WHEN $9 % 3 <> 0 THEN $1::timestamptz + interval '1 hour' END,
           CASE WHEN $9 % 3 = 1 THEN $1::timestamptz + interval '2 hours' END)`,
        [
          g.dia?.(i) ?? `2026-10-${String(1 + (n % 9)).padStart(2, "0")}T12:00:00-03:00`,
          nome,
          email,
          whatsapp,
          `tokenorigem${String(n).padStart(21, "0")}`,
          g.source(i),
          g.medium(i),
          g.campaign(i),
          n,
        ],
      );
    }
  }
}
