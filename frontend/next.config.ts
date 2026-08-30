import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The frontend lives inside the EvidenceOS monorepo; scope Turbopack's
  // lockfile detection to the repo so it ignores stray locks outside it.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  // WebMCP (`document.modelContext`) requires the top-level document to live
  // in an origin-keyed agent cluster. COOP: same-origin opts us into that;
  // without it the browser refuses registerTool with a SecurityError.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }],
      },
    ];
  },
};

export default nextConfig;
