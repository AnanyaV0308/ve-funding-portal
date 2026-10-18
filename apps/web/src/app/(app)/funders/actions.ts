"use server";

import { normaliseFy, parseInr } from "@ve/core";
import { auditLog, db, funderGrantees, funders } from "@ve/db";
import { rescoreFunders } from "@ve/ingest";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type CurrentUser, NotAllowedError, requirePermission } from "@/lib/authz";

export type FormState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
} | null;

async function editor(): Promise<{ user: CurrentUser } | { error: { ok: false; message: string } }> {
  try {
    return { user: await requirePermission("leads:edit") };
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: { ok: false, message: e.message } };
    throw e;
  }
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const submitted = (fd: FormData) => Object.fromEntries([...fd].filter((e): e is [string, string] => typeof e[1] === "string"));

/** What VE adds changes the score, so every save scores the company again before the page reloads. */
async function afterChange(id: string) {
  await rescoreFunders([id]);
  revalidatePath(`/funders/${id}`);
  revalidatePath("/leads");
  revalidatePath("/");
}

const notesInput = z.object({
  id: z.string().uuid(),
  warmPath: z.preprocess(blank, z.string().trim().max(1000).optional()),
  isForeign: z.literal("on").optional(),
});

export async function saveFunderNotes(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = notesInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "That couldn't be saved. Reload the page and try again." };
  const v = parsed.data;
  const [row] = await db
    .update(funders)
    .set({ warmPath: v.warmPath ?? null, isForeign: v.isForeign === "on" })
    .where(eq(funders.id, v.id))
    .returning({ id: funders.id });
  if (!row) return { ok: false, message: "That company no longer exists." };
  await db.insert(auditLog).values({ actorId: auth.user.id, action: "funder.updated", targetType: "funder", targetId: v.id });
  await afterChange(v.id);
  return { ok: true, message: "Saved, and the fit score is up to date." };
}

const granteeInput = z.object({
  funderId: z.string().uuid(),
  name: z.string().trim().min(1, "Give the NGO's name").max(300),
  fy: z.preprocess(blank, z.string().optional()).transform((v, ctx) => {
    if (!v) return null;
    const fy = normaliseFy(v);
    if (!fy) ctx.addIssue({ code: "custom", message: "Write a year like 2023-24" });
    return fy;
  }),
  amount: z.preprocess(blank, z.string().optional()).transform((v, ctx) => {
    if (!v) return null;
    const n = parseInr(v);
    if (n === null) ctx.addIssue({ code: "custom", message: "Write an amount like 40 lakh or 4000000" });
    return n;
  }),
  sourceLabel: z.preprocess(blank, z.string().trim().max(300).optional()),
  sourceUrl: z.preprocess(blank, z.string().trim().url("Enter a full web address, starting with https://").max(1000).optional()),
});

export async function addGrantee(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = granteeInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Some fields need fixing.", fieldErrors, values: submitted(formData) };
  }
  const v = parsed.data;
  await db.insert(funderGrantees).values({
    funderId: v.funderId,
    name: v.name,
    fy: v.fy,
    amount: v.amount,
    sourceLabel: v.sourceLabel ?? null,
    sourceUrl: v.sourceUrl ?? null,
    createdBy: auth.user.id,
  });
  await db.insert(auditLog).values({
    actorId: auth.user.id,
    action: "funder.grantee_added",
    targetType: "funder",
    targetId: v.funderId,
    detail: { name: v.name },
  });
  await afterChange(v.funderId);
  return { ok: true, message: `Added ${v.name}.` };
}

export async function deleteGrantee(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const v = z.object({ id: z.string().uuid(), funderId: z.string().uuid() }).parse(Object.fromEntries(formData));
  const [row] = await db
    .delete(funderGrantees)
    .where(and(eq(funderGrantees.id, v.id), eq(funderGrantees.funderId, v.funderId)))
    .returning({ name: funderGrantees.name });
  if (row) {
    await db.insert(auditLog).values({
      actorId: user.id,
      action: "funder.grantee_removed",
      targetType: "funder",
      targetId: v.funderId,
      detail: { name: row.name },
    });
  }
  await afterChange(v.funderId);
}
