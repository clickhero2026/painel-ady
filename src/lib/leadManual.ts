import { ErroAnotacao, gravarAnotacao, validarTexto } from "./anotacoes";
import { ErroAtribuicao, responsavelValido, TRAVA_ATRIBUICAO } from "./atribuicao";
import { registrarAuditoria } from "./auditoria";
import { pool, transacao } from "./db";
import { ORIGEM_MANUAL } from "./funil";
import { leadsVisiveis, ORIGEM, UUID, type QuemConsulta } from "./leads";
import type { Papel } from "./papeis";
import { Parametros } from "./sql";
import { validarDadosDoLead, type ErrosDoLead } from "./validacaoLead";

/**
 * Cadastro manual de lead ("Novo lead"), decidido em 04/11/2026:
 *
 * - Só admin e vendas (conferido aqui, no servidor; os outros papéis
 *   recebem sem_permissao).
 * - Grava em teste7d_inscricoes só nome, e-mail, WhatsApp e
 *   utm_source = 'manual' (GRANT em db/grants/painel_app_lead_manual.sql).
 *   O resto vem do DEFAULT do banco: status 'inscrito', token_retomada,
 *   created_at... O lead preenche a ativação (etapa 2) pelo link de
 *   ativação, como qualquer cadastro do site; o vendedor não preenche por ele.
 * - Responsável: vendas = o próprio usuário; admin = quem escolher (ativo,
 *   vendas ou admin, a mesma regra de atribuicao.ts) ou ninguém.
 * - Anotação inicial opcional, gravada pelo mesmo caminho das anotações.
 * - Tudo numa transação, com auditoria `criar_lead` (só via e
 *   responsavel_id; nada de nome, e-mail ou WhatsApp).
 * - E-mail repetido (índice único em lower(email)): erro "email_existente".
 *   Se o lead dono do e-mail é visível para quem tentou (e não foi mesclado),
 *   devolve o id dele para a tela oferecer a ficha; se não, só a mensagem,
 *   sem nenhum dado do dono.
 * - WhatsApp repetido grava normalmente (a tela "Possíveis duplicados" do
 *   admin mostra os dois).
 * - Lead manual fica fora dos indicadores de marketing (ver LEAD_MANUAL em
 *   funil.ts).
 */

export function podeCriarLead(papel: Papel): boolean {
  return papel === "admin" || papel === "vendas";
}

export const MENSAGEM_EMAIL_EXISTENTE = "Já existe um cadastro com este e-mail.";

export class ErroLeadManual extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "sem_permissao" | "invalido" | "email_existente",
    /** Erro de cada campo (motivo "invalido"). */
    readonly erros: ErrosDoLead = {},
    /** Lead que já tem o e-mail, só quando é visível para quem tentou (motivo "email_existente"). */
    readonly leadExistente: string | null = null,
  ) {
    super(mensagem);
  }
}

export interface DadosDoLeadManual {
  nome?: unknown;
  email?: unknown;
  whatsapp?: unknown;
  /** Anotação interna inicial (opcional). */
  anotacao?: unknown;
  /** Só admin: id do responsável; null ou vazio = sem responsável. Vendas: ignorado se for o próprio. */
  responsavelId?: unknown;
}

const invalido = (erros: ErrosDoLead) =>
  new ErroLeadManual(Object.values(erros)[0] ?? "Confira os campos.", "invalido", erros);

/** É a violação do índice único de e-mail (código 23505)? */
function emailRepetido(erro: unknown): boolean {
  const e = erro as { code?: string; constraint?: string };
  return e?.code === "23505" && (!e.constraint || e.constraint === "teste7d_inscricoes_email_uidx");
}

/**
 * Cria o lead e devolve o id. Lança ErroLeadManual (sem_permissao,
 * invalido com os erros por campo, email_existente).
 */
export async function criarLeadManual(
  usuario: QuemConsulta,
  dados: DadosDoLeadManual,
  via: "tela" | "api" = "api",
): Promise<{ id: string }> {
  if (!podeCriarLead(usuario.papel)) throw new ErroLeadManual("Você não tem permissão para cadastrar leads.", "sem_permissao");

  const validacao = validarDadosDoLead(dados);
  const erros: ErrosDoLead = validacao.ok ? {} : { ...validacao.erros };

  let anotacao: string | null = null;
  if (typeof dados.anotacao === "string" && dados.anotacao.trim()) {
    try {
      anotacao = validarTexto(dados.anotacao);
    } catch (e) {
      if (!(e instanceof ErroAnotacao)) throw e;
      erros.anotacao = e.message;
    }
  } else if (dados.anotacao !== undefined && dados.anotacao !== null && typeof dados.anotacao !== "string") {
    erros.anotacao = "Anotação inválida.";
  }

  const pedido = typeof dados.responsavelId === "string" && dados.responsavelId ? dados.responsavelId.toLowerCase() : null;
  if (dados.responsavelId !== undefined && dados.responsavelId !== null && typeof dados.responsavelId !== "string") {
    erros.responsavel = "Responsável inválido.";
  } else if (pedido && !UUID.test(pedido)) {
    erros.responsavel = "Responsável inválido.";
  } else if (usuario.papel === "vendas" && pedido && pedido !== usuario.id.toLowerCase()) {
    erros.responsavel = "Quem é de vendas não escolhe o responsável: o lead fica com você.";
  }

  if (!validacao.ok || Object.keys(erros).length > 0) throw invalido(erros);
  const { nome, email, whatsapp } = validacao.dados;
  const responsavelId = usuario.papel === "vendas" ? usuario.id : pedido;

  try {
    return await transacao(async (db) => {
      // Mesma trava das atribuições: o responsável não é desativado no meio.
      await db.query("SELECT pg_advisory_xact_lock($1)", [TRAVA_ATRIBUICAO]);
      let responsavel: { id: string } | null = null;
      if (responsavelId) {
        try {
          responsavel = await responsavelValido(db, responsavelId);
        } catch (e) {
          if (!(e instanceof ErroAtribuicao)) throw e;
          throw invalido({ responsavel: e.message });
        }
      }

      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO teste7d_inscricoes (nome, email, whatsapp, utm_source) VALUES ($1, $2, $3, $4) RETURNING id`,
        [nome, email, whatsapp, ORIGEM_MANUAL],
      );
      const id = rows[0].id;

      if (responsavel) {
        await db.query(
          `INSERT INTO painel_lead_responsavel (lead_id, usuario_id, atribuido_por, atribuido_em) VALUES ($1, $2, $3, now())`,
          [id, responsavel.id, usuario.id],
        );
      }
      if (anotacao) await gravarAnotacao(db, usuario, id, anotacao);
      await registrarAuditoria(
        { usuarioId: usuario.id, acao: "criar_lead", leadId: id, detalhe: { via, responsavel_id: responsavel?.id ?? null } },
        db,
      );
      return { id };
    });
  } catch (e) {
    if (!emailRepetido(e)) throw e;
    throw new ErroLeadManual(MENSAGEM_EMAIL_EXISTENTE, "email_existente", { email: MENSAGEM_EMAIL_EXISTENTE }, await leadVisivelComEmail(usuario, email));
  }
}

/** Id do lead (não mesclado) com este e-mail, se `usuario` pode vê-lo; senão null. */
async function leadVisivelComEmail(usuario: QuemConsulta, email: string): Promise<string | null> {
  const p = new Parametros();
  const { rows } = await pool().query<{ id: string }>(
    `SELECT i.id FROM ${ORIGEM} WHERE ${leadsVisiveis(usuario, p)} AND lower(i.email) = lower(${p.add(email)}) LIMIT 1`,
    p.valores,
  );
  return rows[0]?.id ?? null;
}
