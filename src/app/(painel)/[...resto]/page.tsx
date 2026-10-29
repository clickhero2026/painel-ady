import { notFound } from "next/navigation";

/**
 * Qualquer endereço que não existe cai aqui, dentro do layout do painel:
 * o 404 aparece com a barra lateral (e exige login, como o resto).
 */
export default function NaoExiste() {
  notFound();
}
