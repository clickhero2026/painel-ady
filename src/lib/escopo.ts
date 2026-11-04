/**
 * Condição central dos cadastros mesclados. Um lead mesclado em outro (é
 * `duplicado_id` em painel_lead_mescla) some de TODAS as listas, do
 * pipeline e de TODAS as contagens (funil, funil comercial, perfil, origem,
 * contadores do menu). Toda consulta sobre `teste7d_inscricoes i` passa por
 * aqui: em leads.ts via `leadsVisiveis` e em funil.ts via `condicoes`
 * (que o perfil, a origem e o funil comercial reaproveitam; os leads
 * cadastrados à mão são outra regra, explícita, em `condicoes`).
 *
 * Arquivo sem dependências, pra poder ser importado por qualquer módulo de
 * consulta sem criar ciclo.
 */
export const NAO_MESCLADO = "NOT EXISTS (SELECT 1 FROM painel_lead_mescla mx WHERE mx.duplicado_id = i.id)";
