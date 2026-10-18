import { Readable } from "node:stream";
import { can } from "@ve/core";
import { db, documentVersions } from "@ve/db";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/authz";
import { openForDownload, storedSize } from "@/lib/storage";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download files.", { status: 401 });
  if (!can(user.roles, "knowledge:view")) return new Response("Your role can't open documents.", { status: 403 });

  const { versionId } = await params;
  if (!z.uuid().safeParse(versionId).success) return new Response("Not found", { status: 404 });

  const version = await db.query.documentVersions.findFirst({ where: eq(documentVersions.id, versionId) });
  if (!version || (await storedSize(version.fileKey)) === null) return new Response("Not found", { status: 404 });

  const stream = Readable.toWeb(openForDownload(version.fileKey)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": version.contentType,
      "Content-Length": String(version.sizeBytes),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(version.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
