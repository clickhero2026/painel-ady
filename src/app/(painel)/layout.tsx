import { BarraLateral } from "@/components/BarraLateral";
import { contadoresDoMenu } from "@/lib/leads";
import { navegacaoDoPapel, ROTULO_PAPEL } from "@/lib/papeis";
import { exigirUsuario } from "@/lib/sessao";
import { sair } from "./acoes";

export default async function LayoutPainel({ children }: LayoutProps<"/">) {
  const usuario = await exigirUsuario();
  // Contadores do menu (só os do papel). O layout é refeito a cada router.refresh().
  const { semResponsavel, paraFechar } = await contadoresDoMenu(usuario.papel);
  const contadores: Record<string, { valor: number; descricao: string }> = {};
  if (semResponsavel !== undefined) contadores["/leads"] = { valor: semResponsavel, descricao: "sem responsável" };
  if (paraFechar !== undefined) contadores["/leads?visao=para_fechar"] = { valor: paraFechar, descricao: "pendentes" };

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-lg bg-fundo px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      <BarraLateral
        itens={navegacaoDoPapel(usuario.papel)}
        contadores={contadores}
        nome={usuario.nome || usuario.email}
        papel={ROTULO_PAPEL[usuario.papel]}
        sair={sair}
      />
      <main id="conteudo" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
