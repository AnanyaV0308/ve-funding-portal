import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Document storage. Uploads go straight from the browser to storage through a short-lived signed
 * URL, so large files never pass through a server action (Vercel caps request bodies at 4.5 MB).
 *
 * Only the local-disk driver exists so far. A Supabase Storage driver with the same interface is
 * added when the Supabase project is created; until then a production build refuses to store files
 * rather than writing them to a server's temporary disk.
 *
 * The turbopackIgnore comments stop Next from bundling the whole project into the server output
 * just because these paths are computed at runtime.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "image/png": "Image",
  "image/jpeg": "Image",
  "text/plain": "Text",
  "text/csv": "CSV",
};

const KEY_PATTERN = /^uploads\/\d{4}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.includes("..");
}

export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-120);
  return cleaned || "file";
}

export function newKey(fileName: string, now = new Date()): string {
  return `uploads/${now.getUTCFullYear()}/${randomUUID()}/${safeFileName(fileName)}`;
}

function storageRoot(): string {
  const dir = process.env.FILE_STORAGE_DIR;
  if (dir) return path.resolve(/*turbopackIgnore: true*/ dir);
  if (process.env.NODE_ENV === "production") {
    throw new Error("File storage isn't configured for production yet. Set up Supabase Storage first.");
  }
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data", "uploads");
}

export function localPath(key: string): string {
  if (!isValidKey(key)) throw new Error("Invalid file key");
  return path.join(/*turbopackIgnore: true*/ storageRoot(), key);
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(key: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${key}.${exp}`).digest("base64url");
}

export function verifyUploadSignature(key: string, exp: number, sig: string, now = Date.now()): boolean {
  if (!isValidKey(key) || !Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = Buffer.from(sign(key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A URL the browser can PUT the file to, valid for 15 minutes. */
export function createUploadUrl(key: string): string {
  const exp = Math.floor(Date.now() / 1000) + UPLOAD_URL_TTL_SECONDS;
  const params = new URLSearchParams({ key, exp: String(exp), sig: sign(key, exp) });
  return `/api/files/upload?${params}`;
}

/** Size in bytes of a stored file, or null if nothing was uploaded under that key. */
export async function storedSize(key: string): Promise<number | null> {
  try {
    const s = await stat(/*turbopackIgnore: true*/ localPath(key));
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

export async function ensureDirFor(key: string): Promise<string> {
  const p = localPath(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(p), { recursive: true });
  return p;
}

export function openForDownload(key: string) {
  return createReadStream(/*turbopackIgnore: true*/ localPath(key));
}
