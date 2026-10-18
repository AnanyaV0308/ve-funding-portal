"use server";

import { CONSENT_STATUSES, DOCUMENT_KINDS, KNOWLEDGE_CATEGORIES } from "@ve/core";
import { auditLog, db, documents, documentVersions, knowledgeFacts } from "@ve/db";
import { eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type CurrentUser, NotAllowedError, requirePermission } from "@/lib/authz";
import { ALLOWED_TYPES, createUploadUrl, isValidKey, MAX_UPLOAD_BYTES, newKey, storedSize } from "@/lib/storage";

export type FormState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  /** What the person submitted, so the form can show it again after a validation error. */
  values?: Record<string, string>;
} | null;

function submitted(formData: FormData): Record<string, string> {
  return Object.fromEntries([...formData].filter((e): e is [string, string] => typeof e[1] === "string"));
}

const optional = (schema: z.ZodString) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

const factInput = z.object({
  id: optional(z.string().uuid()),
  category: z.enum(KNOWLEDGE_CATEGORIES, { message: "Choose a category" }),
  title: z.string().trim().min(1, "Give the fact a short name").max(200),
  body: z.string().trim().min(1, "Write the fact itself").max(20_000),
  asOf: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date")),
  sourceLabel: optional(z.string().trim().max(200)),
  sourceUrl: optional(z.string().trim().url("Enter a full web address, starting with https://").max(2000)),
  consent: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CONSENT_STATUSES).optional()),
  ownerId: optional(z.string()),
  refreshMonths: z.coerce.number().int().min(1, "At least 1 month").max(60, "At most 60 months"),
});

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = String(issue.path[0] ?? "form");
    out[k] ??= issue.message;
  }
  return out;
}

type Denied = { ok: false; message: string };

async function editor(): Promise<{ user: CurrentUser } | { error: Denied }> {
  try {
    return { user: await requirePermission("knowledge:edit") };
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: { ok: false, message: e.message } };
    throw e;
  }
}

export async function saveFact(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const { user } = auth;

  const parsed = factInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values: submitted(formData) };
  }
  const { id, ...data } = parsed.data;
  const values = {
    ...data,
    asOf: data.asOf ?? null,
    sourceLabel: data.sourceLabel ?? null,
    sourceUrl: data.sourceUrl ?? null,
    consent: data.consent ?? null,
    ownerId: data.ownerId ?? null,
    updatedBy: user.id,
    updatedAt: new Date(),
    // Saving a fact means a person has just written or checked it.
    confirmedAt: new Date(),
    confirmedBy: user.id,
  };

  try {
    if (id) {
      const [row] = await db.update(knowledgeFacts).set(values).where(eq(knowledgeFacts.id, id)).returning({ id: knowledgeFacts.id });
      if (!row) return { ok: false, message: "That fact no longer exists.", values: submitted(formData) };
    } else {
      await db.insert(knowledgeFacts).values(values);
    }
  } catch (e) {
    if (e instanceof Error && /knowledge_facts_category_title_idx/.test(String((e as { cause?: unknown }).cause ?? e.message))) {
      return {
        ok: false,
        message: "A fact with this name already exists in this category.",
        fieldErrors: { title: "Already used in this category" },
        values: submitted(formData),
      };
    }
    throw e;
  }

  await db.insert(auditLog).values({
    actorId: user.id,
    action: id ? "knowledge.fact_updated" : "knowledge.fact_created",
    targetType: "knowledge_fact",
    targetId: id ?? null,
    detail: { category: data.category, title: data.title },
  });
  revalidatePath("/knowledge");
  redirect(`/knowledge?category=${data.category}&saved=1`);
}

const idOnly = z.object({ id: z.string().uuid() });

export async function confirmFact(formData: FormData): Promise<void> {
  const user = await requirePermission("knowledge:edit");
  const { id } = idOnly.parse(Object.fromEntries(formData));
  await db.update(knowledgeFacts).set({ confirmedAt: new Date(), confirmedBy: user.id }).where(eq(knowledgeFacts.id, id));
  await db.insert(auditLog).values({ actorId: user.id, action: "knowledge.fact_confirmed", targetType: "knowledge_fact", targetId: id });
  revalidatePath("/knowledge");
}

export async function deleteFact(formData: FormData): Promise<void> {
  const user = await requirePermission("knowledge:edit");
  const { id } = idOnly.parse(Object.fromEntries(formData));
  const [row] = await db.delete(knowledgeFacts).where(eq(knowledgeFacts.id, id)).returning();
  if (row) {
    await db.insert(auditLog).values({
      actorId: user.id,
      action: "knowledge.fact_deleted",
      targetType: "knowledge_fact",
      targetId: id,
      detail: { category: row.category, title: row.title, body: row.body },
    });
  }
  revalidatePath("/knowledge");
  redirect("/knowledge?deleted=1");
}

// ---------------------------------------------------------------------------
// Documents: the browser asks for an upload link, PUTs the file, then saves the record.
// ---------------------------------------------------------------------------

const startInput = z.object({
  fileName: z.string().min(1).max(300),
  contentType: z.string(),
  size: z.number().int().positive(),
});

export type StartUploadResult = { ok: true; key: string; uploadUrl: string } | { ok: false; message: string };

export async function startUpload(input: z.infer<typeof startInput>): Promise<StartUploadResult> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a file to upload." };
  const { fileName, contentType, size } = parsed.data;
  if (size > MAX_UPLOAD_BYTES) return { ok: false, message: "Files can be up to 50 MB." };
  if (!ALLOWED_TYPES[contentType]) {
    return { ok: false, message: "Upload a PDF, Word, Excel, PowerPoint, image, text or CSV file." };
  }
  const key = newKey(fileName);
  return { ok: true, key, uploadUrl: createUploadUrl(key) };
}

const saveDocInput = z.object({
  documentId: optional(z.string().uuid()),
  key: z.string().refine(isValidKey),
  fileName: z.string().min(1).max(300),
  contentType: z.string().refine((t) => Boolean(ALLOWED_TYPES[t])),
  title: optional(z.string().trim().max(300)),
  kind: z.preprocess((v) => (v === "" ? undefined : v), z.enum(DOCUMENT_KINDS).optional()),
  period: optional(z.string().trim().max(40)),
  notes: optional(z.string().trim().max(2000)),
});

export async function saveDocument(input: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const { user } = auth;

  const parsed = saveDocInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That upload couldn't be saved. Try again." };
  const d = parsed.data;
  if (!d.documentId && (!d.title || !d.kind)) return { ok: false, message: "Give the document a title and a type." };

  const size = await storedSize(d.key);
  if (size === null) return { ok: false, message: "The file didn't finish uploading. Try again." };

  const result = await db.transaction(async (tx) => {
    let documentId = d.documentId;
    if (!documentId) {
      const [doc] = await tx
        .insert(documents)
        .values({ title: d.title!, kind: d.kind!, period: d.period ?? null, notes: d.notes ?? null, createdBy: user.id })
        .returning({ id: documents.id });
      documentId = doc!.id;
    } else {
      // Lock the document so two uploads at once can't both claim the same version number.
      const locked = await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).for("update");
      if (!locked.length) return null;
    }
    const [latest] = await tx
      .select({ v: max(documentVersions.version) })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId));
    const version = (latest?.v ?? 0) + 1;
    await tx.insert(documentVersions).values({
      documentId,
      version,
      fileKey: d.key,
      fileName: d.fileName,
      contentType: d.contentType,
      sizeBytes: size,
      uploadedBy: user.id,
    });
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "knowledge.document_uploaded",
      targetType: "document",
      targetId: documentId,
      detail: { version, fileName: d.fileName },
    });
    return version;
  });

  if (result === null) return { ok: false, message: "That document no longer exists." };
  revalidatePath("/knowledge/documents");
  return { ok: true, message: result === 1 ? "Document added." : `Version ${result} uploaded.` };
}
