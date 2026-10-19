import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Same rule as isValidKey in apps/web/src/lib/storage.ts, which issues the keys.
const KEY_PATTERN = /^uploads\/\d{4}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;

function repoRoot(from = process.cwd()): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error("Couldn't find the repository root");
    dir = up;
  }
  return dir;
}

/**
 * The folder the web app's local-disk storage writes to. The worker and scripts run from other
 * folders, so the default is worked out from the repository root rather than the current folder.
 */
function storageRoot(): string {
  const dir = process.env.FILE_STORAGE_DIR;
  if (dir) return path.resolve(dir);
  if (process.env.NODE_ENV === "production") {
    throw new Error("File storage isn't configured for production yet. Set up Supabase Storage first.");
  }
  return path.join(repoRoot(), "apps", "web", ".data", "uploads");
}

/** Reads an uploaded file as text. */
export async function readStoredText(key: string): Promise<string> {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("Invalid file key");
  return readFile(path.join(storageRoot(), key), "utf8");
}

/** Reads an uploaded file, such as a PDF. */
export async function readStoredBytes(key: string): Promise<Uint8Array> {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("Invalid file key");
  return new Uint8Array(await readFile(path.join(storageRoot(), key)));
}
