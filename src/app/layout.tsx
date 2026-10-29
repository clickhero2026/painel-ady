import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { gantari } from "@/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "painel ady", template: "%s · painel ady" },
  description: "Painel interno do ady.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#17708A",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Toda página é dinâmica: a CSP do proxy leva um nonce por requisição, e
  // o Next só consegue aplicá-lo em scripts de página renderizada na hora.
  await headers();
  return (
    <html lang="pt-BR" className={`${gantari.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
