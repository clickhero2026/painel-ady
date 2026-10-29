"use client";

import dynamic from "next/dynamic";

/**
 * Os gráficos só renderizam no navegador: o Recharts põe estilos em
 * atributo `style`, que a CSP do painel (sem 'unsafe-inline') bloqueia no
 * HTML do servidor, mas aceita quando aplicados pelo JavaScript. Enquanto
 * carrega, um espaço da mesma altura evita que a página pule.
 */

const espaco = (altura: string) =>
  function Espaco() {
    return <div className={`${altura} w-full rounded-lg bg-superficie`} aria-hidden="true" />;
  };

export const GraficoFunil = dynamic(() => import("./Graficos").then((m) => m.GraficoFunil), {
  ssr: false,
  loading: espaco("h-56"),
});

export const GraficoSerie = dynamic(() => import("./Graficos").then((m) => m.GraficoSerie), {
  ssr: false,
  loading: espaco("h-60"),
});
