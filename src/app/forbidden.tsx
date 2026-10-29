import { PaginaDeAviso } from "@/components/PaginaDeAviso";

export default function Proibido() {
  return (
    <PaginaDeAviso
      codigo="Erro 403"
      titulo="Você não tem acesso a esta página"
      texto="O seu papel no painel não inclui esta área. Se precisar dela, fale com um admin."
    />
  );
}
