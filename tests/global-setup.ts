import { BANCO_TESTE, recriarBanco } from "./banco";

export default async function setup() {
  await recriarBanco(BANCO_TESTE.dono);
}
