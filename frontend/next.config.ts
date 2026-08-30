import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The frontend lives inside the EvidenceOS monorepo; scope Turbopack's
  // lockfile detection to the repo so it ignores stray locks outside it.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
