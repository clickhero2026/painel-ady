import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRONTIDAO } from "@/config/prontidao";
import { chavesSemMapa, checklistDeProntidao, MAPAS_DE_RESPOSTA, textoDaResposta } from "@/lib/respostas";
import { LEADS } from "../fixtures/leads";

describe("mapa de respostas", () => {
  it("ALERTA: toda chave presente nos dados de teste tem texto no mapa", () => {
    // Se falhar, alguém gravou (ou o site passou a gravar) uma opção que o
    // painel não conhece: atualizar src/lib/teste7dOptions.ts a partir do site.
    expect(chavesSemMapa(LEADS)).toEqual([]);
  });

  it("chave sem mapa aparece crua, marcada, sem quebrar", () => {
    expect(textoDaResposta("acesso_redes", "chave_nova")).toEqual({ texto: "chave_nova", semMapa: true });
    expect(textoDaResposta("acesso_redes", null)).toBeNull();
    expect(chavesSemMapa([{ acesso_redes: "chave_nova", arquivo_logo: "sim" }])).toEqual([["acesso_redes", "chave_nova"]]);
  });

  it("a cópia do mapa é igual à do site (quando ../site existe)", () => {
    const doSite = path.resolve("../site/src/lib/teste7dOptions.ts");
    if (!existsSync(doSite)) return;
    const copia = readFileSync("src/lib/teste7dOptions.ts", "utf8");
    // A cópia só acrescenta o cabeçalho de origem no topo.
    expect(copia.endsWith(readFileSync(doSite, "utf8"))).toBe(true);
  });
});

describe("checklist de prontidão", () => {
  it("ALERTA: toda opção de cada item tem uma cor definida em src/config/prontidao.ts", () => {
    for (const item of PRONTIDAO) {
      expect(Object.keys(item.cores).sort(), item.campo).toEqual(Object.keys(item.opcoes).sort());
      expect(item.opcoes).toBe(MAPAS_DE_RESPOSTA[item.campo]);
    }
  });

  it("regras da seção 6", () => {
    const cores = checklistDeProntidao({
      acesso_redes: "ambos_com_login",
      conta_anuncios: "nao_sei",
      cartao_pagamento: "nao_tem",
      arquivo_logo: "so_print",
      reuniao_computador: "so_celular",
    }).map((i) => i.cor);
    expect(cores).toEqual(["verde", "amarelo", "vermelho", "amarelo", "vermelho"]);
  });

  it("sem resposta e chave desconhecida nunca ficam verdes", () => {
    const [redes, conta] = checklistDeProntidao({ acesso_redes: null, conta_anuncios: "talvez" });
    expect(redes).toMatchObject({ cor: null, resposta: null });
    expect(conta).toMatchObject({ cor: null, resposta: { texto: "talvez", semMapa: true } });
  });
});
