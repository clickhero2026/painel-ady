import type { MetadataRoute } from "next";

/** Painel interno: nenhum robô indexa nada. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
