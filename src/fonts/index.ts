import localFont from "next/font/local";

/**
 * Gantari — fonte oficial do guia de marca ady (mesmo arquivo do site),
 * carregada localmente. Licença SIL OFL 1.1 em `OFL.txt`.
 */
export const gantari = localFont({
  src: "./Gantari-Variable.ttf",
  weight: "300 700",
  style: "normal",
  display: "swap",
  variable: "--font-gantari",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
