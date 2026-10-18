import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// One .env at the repo root serves the web app, the worker and the db scripts.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No root .env (e.g. in CI or on Vercel, where variables come from the environment).
}

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@ve/core", "@ve/db", "@ve/ingest"],
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
