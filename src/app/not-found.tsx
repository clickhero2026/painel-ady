import { PaginaDeAviso } from "@/components/PaginaDeAviso";

export default function NaoEncontrada() {
  return (
    <PaginaDeAviso
      codigo="Erro 404"
      titulo="Página não encontrada"
      texto="O endereço pode ter sido digitado errado ou a página não existe mais."
    />
  );
}
