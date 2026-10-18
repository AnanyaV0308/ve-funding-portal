import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextRequest } from "next/server";
import { ensureDirFor, MAX_UPLOAD_BYTES, storedSize, verifyUploadSignature } from "@/lib/storage";

/**
 * Receives a file the browser PUTs to a signed upload URL (local-disk storage only). The signature,
 * minted by a server action that already checked the person's permission, is the authorisation.
 */
export async function PUT(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const key = params.get("key") ?? "";
  const exp = Number(params.get("exp"));
  const sig = params.get("sig") ?? "";

  if (!verifyUploadSignature(key, exp, sig)) {
    return Response.json({ error: "This upload link has expired. Try the upload again." }, { status: 403 });
  }
  if ((await storedSize(key)) !== null) {
    return Response.json({ error: "A file was already uploaded with this link." }, { status: 409 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Files can be up to 50 MB." }, { status: 413 });
  }
  if (!request.body) return Response.json({ error: "The upload was empty." }, { status: 400 });

  const dest = await ensureDirFor(key);
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      cb(received > MAX_UPLOAD_BYTES ? new Error("too_large") : null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(request.body as never), limit, createWriteStream(/*turbopackIgnore: true*/ dest, { flags: "wx" }));
  } catch (e) {
    await rm(/*turbopackIgnore: true*/ dest, { force: true });
    const tooLarge = e instanceof Error && e.message === "too_large";
    return Response.json(
      { error: tooLarge ? "Files can be up to 50 MB." : "The upload failed. Try again." },
      { status: tooLarge ? 413 : 500 },
    );
  }
  return Response.json({ ok: true, size: received });
}
