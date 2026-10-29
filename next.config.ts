import type { NextConfig } from "next";
import { CABECALHOS_FIXOS } from "./src/lib/seguranca";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // forbidden() → página 403 (src/app/forbidden.tsx) com status 403.
    authInterrupts: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: [...CABECALHOS_FIXOS] }];
  },
};

export default nextConfig;
