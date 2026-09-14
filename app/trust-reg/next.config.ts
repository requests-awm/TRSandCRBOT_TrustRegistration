import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image: .next/standalone/server.js plus traced node_modules.
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd()),
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
