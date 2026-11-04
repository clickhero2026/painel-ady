import { describe, expect, it } from "vitest";
import { MENSAGEM_LINK_ATIVACAO, MENSAGEM_WHATSAPP_MANUAL } from "@/config/contato";
import { preencherMensagem } from "@/lib/formatos";
import { PAPEIS, podeAcessar } from "@/lib/papeis";
import { normalizarWhatsappBR, telefoneValido, validarDadosDoLead, WHATSAPP_DO_BANCO } from "@/lib/validacaoLead";

describe("normalizarWhatsappBR (igual ao site)", () => {
  it.each([
    ["(85) 99999-9999", "5585999999999"],
    ["85 99999 9999", "5585999999999"],
    ["85999999999", "5585999999999"],
    ["+55 (85) 99999-9999", "5585999999999"],
    ["55 85 99999-9999", "5585999999999"],
    ["5585999999999", "5585999999999"],
    ["+55-11-98765-4321", "5511987654321"],
    // fixo (8 dígitos depois do DDD), com e sem 55
    ["(11) 3333-4444", "551133334444"],
    ["1133334444", "551133334444"],
    ["55 11 3333-4444", "551133334444"],
    ["+55 (21) 2555.1234", "552125551234"],
    // DDD 55 (Rio Grande do Sul) sem o código do país
    ["(55) 99999-8888", "5555999998888"],
  ])("%s → %s", (entrada, saida) => {
    expect(normalizarWhatsappBR(entrada)).toBe(saida);
    expect(saida).toMatch(WHATSAPP_DO_BANCO);
  });

  it.each([
    ["", "vazio"],
    ["9999-9999", "sem DDD"],
    ["(01) 99999-9999", "DDD com zero"],
    ["(10) 99999-9999", "DDD com zero no fim"],
    ["(85) 89999-9999", "11 dígitos sem o 9 do celular"],
    ["(85) 99999-99999", "dígito a mais"],
    ["+1 415 555 0100", "fora do Brasil"],
    ["55 (85) 9999-999", "curto demais com 55"],
    ["abc", "sem dígitos"],
  ])("recusa %s (%s)", (entrada) => {
    expect(normalizarWhatsappBR(entrada)).toBeNull();
  });

  it("telefoneValido: DDD de 11 a 99 + fixo de 8 ou celular de 9 começando em 9", () => {
    expect(telefoneValido("85999999999")).toBe(true);
    expect(telefoneValido("8533334444")).toBe(true);
    expect(telefoneValido("0833334444")).toBe(false);
    expect(telefoneValido("85899999999")).toBe(false);
  });
});

describe("validarDadosDoLead", () => {
  const bons = { nome: "  Maria da Silva  ", email: "  Maria.Silva@Exemplo.COM.br ", whatsapp: "(85) 98888-7777" };

  it("limpa e normaliza", () => {
    expect(validarDadosDoLead(bons)).toEqual({
      ok: true,
      dados: { nome: "Maria da Silva", email: "maria.silva@exemplo.com.br", whatsapp: "5585988887777" },
    });
  });

  it("nome: de 2 a 120 caracteres, sem contar os espaços das pontas", () => {
    expect(validarDadosDoLead({ ...bons, nome: " M " })).toMatchObject({ ok: false, erros: { nome: expect.stringMatching(/curto/) } });
    expect(validarDadosDoLead({ ...bons, nome: "   " })).toMatchObject({ ok: false, erros: { nome: "Digite o nome." } });
    expect(validarDadosDoLead({ ...bons, nome: "x".repeat(121) })).toMatchObject({ ok: false, erros: { nome: expect.stringMatching(/longo/) } });
    expect(validarDadosDoLead({ ...bons, nome: "Bo" }).ok).toBe(true);
    expect(validarDadosDoLead({ ...bons, nome: "x".repeat(120) }).ok).toBe(true);
  });

  it("e-mail: obrigatório, até 180, formato válido", () => {
    expect(validarDadosDoLead({ ...bons, email: "" })).toMatchObject({ ok: false, erros: { email: "Digite o e-mail." } });
    expect(validarDadosDoLead({ ...bons, email: "sem-arroba" })).toMatchObject({ ok: false, erros: { email: expect.stringMatching(/válido/) } });
    expect(validarDadosDoLead({ ...bons, email: "a@b" })).toMatchObject({ ok: false });
    expect(validarDadosDoLead({ ...bons, email: `${"a".repeat(170)}@exemplo.com` })).toMatchObject({
      ok: false,
      erros: { email: expect.stringMatching(/longo/) },
    });
  });

  it("devolve o erro de cada campo de uma vez; tipos errados não passam", () => {
    const r = validarDadosDoLead({ nome: 1, email: null, whatsapp: "123" });
    expect(r).toMatchObject({ ok: false });
    expect(Object.keys((r as { erros: object }).erros).sort()).toEqual(["email", "nome", "whatsapp"]);
  });
});

describe("mensagens do lead manual", () => {
  it("preencherMensagem troca os marcadores numa passada só", () => {
    expect(preencherMensagem(MENSAGEM_LINK_ATIVACAO, { nome: "Maria", atendente: "Vera", link: "https://x/?t=abc" })).toBe(
      "Oi, Maria! Aqui é Vera, do ady. Esse é o link para ativar seu teste grátis de 7 dias: https://x/?t=abc",
    );
    // Um nome com marcador dentro não vira outra coisa.
    expect(preencherMensagem("{nome} {link}", { nome: "{link}", link: "L" })).toBe("{link} L");
    expect(preencherMensagem(MENSAGEM_WHATSAPP_MANUAL, { nome: "Ana", atendente: "Vera" })).toBe(
      "Oi, Ana! Aqui é Vera, do ady. Vou te ajudar a começar o teste grátis de 7 dias. Podemos conversar por aqui?",
    );
  });

  it("só admin e vendas cadastram lead", () => {
    expect(PAPEIS.filter((p) => podeAcessar(p, "criarLead"))).toEqual(["admin", "vendas"]);
  });
});
