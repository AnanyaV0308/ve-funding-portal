"use server";

import { AMOUNT_UNITS } from "@ve/core";
import { auditLog, dataImports, db } from "@ve/db";
import { CSR_PORTAL } from "@ve/ingest";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type CurrentUser, NotAllowedError, requirePermission } from "@/lib/authz";
import { createUploadUrl, isValidKey, MAX_UPLOAD_BYTES, newKey, storedSize } from "@/lib/storage";

type Result = { ok: boolean; message: string };

async function importer(): Promise<{ user: CurrentUser } | { error: Result }> {
  try {
    return { user: await requirePermission("leads:edit") };
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: { ok: false, message: e.message } };
    throw e;
  }
}

const startInput = z.object({ fileName: z.string().min(1).max(300), size: z.number().int().positive() });

/** Step one of an import: a signed link the browser uploads the CSV to. */
export async function startCsrUpload(
  input: z.infer<typeof startInput>,
): Promise<Result | { ok: true; key: string; uploadUrl: string }> {
  const auth = await importer();
  if ("error" in auth) return auth.error;
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a CSV file." };
  // Browsers report CSV files under several types (Windows often says Excel), so go by the name.
  if (!/\.csv$/i.test(parsed.data.fileName)) {
    return { ok: false, message: "Save the sheet as CSV first. In Excel: File, Save As, CSV UTF-8." };
  }
  if (parsed.data.size > MAX_UPLOAD_BYTES) return { ok: false, message: "Files can be up to 50 MB. Split a larger export by year." };
  const key = newKey(parsed.data.fileName);
  return { ok: true, key, uploadUrl: createUploadUrl(key) };
}

const queueInput = z.object({ key: z.string(), fileName: z.string().min(1).max(300), unit: z.enum(AMOUNT_UNITS) });

/** Step two: record the uploaded file so the worker imports it. */
export async function queueCsrImport(input: z.infer<typeof queueInput>): Promise<Result> {
  const auth = await importer();
  if ("error" in auth) return auth.error;
  const parsed = queueInput.safeParse(input);
  if (!parsed.success || !isValidKey(parsed.data.key)) return { ok: false, message: "That upload couldn't be saved. Try again." };
  if ((await storedSize(parsed.data.key)) === null) return { ok: false, message: "The file didn't finish uploading. Try again." };

  const [row] = await db
    .insert(dataImports)
    .values({ source: CSR_PORTAL, fileKey: parsed.data.key, fileName: parsed.data.fileName, unit: parsed.data.unit, createdBy: auth.user.id })
    .returning({ id: dataImports.id });
  await db.insert(auditLog).values({
    actorId: auth.user.id,
    action: "leads.import_queued",
    targetType: "data_import",
    targetId: row!.id,
    detail: { fileName: parsed.data.fileName },
  });
  revalidatePath("/leads/import");
  return { ok: true, message: "Uploaded. The import runs in the background, usually within a minute; this page shows when it's done." };
}
