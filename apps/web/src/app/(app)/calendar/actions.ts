"use server";

import {
  CALL_KINDS,
  CHECK_ANSWERS,
  callEligibility,
  daysUntil,
  ELIGIBILITY_CHECKS,
  ELIGIBILITY_LABELS,
  type EligibilityCheck,
  FUNDER_TYPES,
  normaliseChecklist,
  parseInr,
} from "@ve/core";
import { auditLog, db, funders, opportunities, pursuits, pursuitStageChanges } from "@ve/db";
import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type CurrentUser, NotAllowedError, requirePermission } from "@/lib/authz";

export type FormState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
} | null;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const optionalDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date").optional());
const amount = z.preprocess(blank, z.string().optional()).transform((v, ctx) => {
  if (v === undefined) return null;
  const n = parseInr(v);
  if (n === null) {
    ctx.addIssue({ code: "custom", message: "Write an amount like 5 lakh, 1.5 crore or 500000" });
    return z.NEVER;
  }
  return n;
});
const optionalUrl = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\/\S+$/i.test(v), "Paste the full link, starting with https://")
    .optional(),
);

function submitted(formData: FormData): Record<string, string> {
  return Object.fromEntries([...formData].filter((e): e is [string, string] => typeof e[1] === "string"));
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

async function allowed(permission: "calendar:edit" | "pipeline:edit"): Promise<{ user: CurrentUser } | { error: { ok: false; message: string } }> {
  try {
    return { user: await requirePermission(permission) };
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: { ok: false, message: e.message } };
    throw e;
  }
}

function revalidateCalendar(id?: string) {
  revalidatePath("/calendar");
  revalidatePath("/");
  if (id) revalidatePath(`/calendar/${id}`);
}

// ---------------------------------------------------------------------------
// Adding and editing a call
// ---------------------------------------------------------------------------

const callInput = z
  .object({
    funderId: z.string().refine((v) => v === "__new" || z.uuid().safeParse(v).success, "Choose who runs it, or add them"),
    newFunderName: optionalText(200),
    newFunderType: z.preprocess(blank, z.enum(FUNDER_TYPES).optional()),
    kind: z.enum(CALL_KINDS, { message: "Choose what kind of call this is" }),
    title: z.string().trim().min(1, "Give the call's name, e.g. “National Awards 2027, Best Institution”").max(200),
    url: optionalUrl,
    opensOn: optionalDate,
    deadline: optionalDate,
    usualWindow: optionalText(300),
    amount,
    amountNote: optionalText(200),
    categories: optionalText(500),
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.funderId === "__new") {
      if (!v.newFunderName) ctx.addIssue({ code: "custom", path: ["newFunderName"], message: "Give the organiser's name" });
      if (!v.newFunderType) ctx.addIssue({ code: "custom", path: ["newFunderType"], message: "Choose the organiser type" });
    }
    if (v.opensOn && v.deadline && daysUntil(v.deadline, v.opensOn) < 0) {
      ctx.addIssue({ code: "custom", path: ["deadline"], message: "The deadline can't be before the call opens" });
    }
  });

type CallInput = z.infer<typeof callInput>;

async function organiserId(tx: Pick<typeof db, "query" | "insert">, v: CallInput, userId: string): Promise<string> {
  if (v.funderId !== "__new") return v.funderId;
  // Reuse an organiser with the same name rather than creating a duplicate.
  const existing = await tx.query.funders.findFirst({ where: sql`lower(${funders.name}) = lower(${v.newFunderName!})` });
  if (existing) return existing.id;
  const [f] = await tx.insert(funders).values({ name: v.newFunderName!, type: v.newFunderType!, createdBy: userId }).returning({ id: funders.id });
  return f!.id;
}

function callValues(v: CallInput) {
  return {
    kind: v.kind,
    title: v.title,
    url: v.url ?? null,
    opensOn: v.opensOn ?? null,
    deadline: v.deadline ?? null,
    usualWindow: v.usualWindow ?? null,
    amount: v.amount,
    amountNote: v.amountNote ?? null,
    categories: v.categories ?? null,
    notes: v.notes ?? null,
  };
}

const isDuplicateTitle = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.code ?? err.cause?.code) === "23505";
};
const duplicateTitle = (formData: FormData): FormState => ({
  ok: false,
  message: "Some fields need fixing.",
  fieldErrors: { title: "A call with this name is already in the calendar. Add the year or category to tell them apart." },
  values: submitted(formData),
});

export async function createCall(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await allowed("calendar:edit");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const parsed = callInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values: submitted(formData) };
  const v = parsed.data;

  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const funderId = await organiserId(tx, v, user.id);
      const { verdict, reasons } = callEligibility([]);
      const [row] = await tx
        .insert(opportunities)
        .values({ ...callValues(v), funderId, checks: normaliseChecklist([]), eligibility: verdict, eligibilityReasons: reasons, createdBy: user.id })
        .returning({ id: opportunities.id });
      await tx.insert(auditLog).values({ actorId: user.id, action: "call.created", targetType: "opportunity", targetId: row!.id, detail: { title: v.title } });
      return row!.id;
    });
  } catch (e) {
    if (isDuplicateTitle(e)) return duplicateTitle(formData);
    throw e;
  }
  revalidateCalendar();
  redirect(`/calendar/${id}?created=1`);
}

export async function updateCall(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await allowed("calendar:edit");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "That couldn't be saved. Reload the page and try again." };
  const parsed = callInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values: submitted(formData) };
  const v = parsed.data;

  try {
    const found = await db.transaction(async (tx) => {
      const funderId = await organiserId(tx, v, user.id);
      const [row] = await tx
        .update(opportunities)
        .set({ ...callValues(v), funderId, updatedAt: new Date() })
        .where(eq(opportunities.id, id.data))
        .returning({ id: opportunities.id });
      if (!row) return false;
      await tx.insert(auditLog).values({ actorId: user.id, action: "call.updated", targetType: "opportunity", targetId: id.data });
      return true;
    });
    if (!found) return { ok: false, message: "That call no longer exists." };
  } catch (e) {
    if (isDuplicateTitle(e)) return duplicateTitle(formData);
    throw e;
  }
  revalidateCalendar(id.data);
  redirect(`/calendar/${id.data}?saved=1`);
}

// ---------------------------------------------------------------------------
// Eligibility checklist
// ---------------------------------------------------------------------------

const answer = z.preprocess(blank, z.enum(CHECK_ANSWERS).optional());
const checklistInput = z.object({
  id: z.uuid(),
  ...Object.fromEntries(ELIGIBILITY_CHECKS.flatMap((k) => [[`answer-${k}`, answer], [`note-${k}`, optionalText(500)]])),
});

export async function saveChecklist(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await allowed("calendar:edit");
  if ("error" in auth) return auth.error;
  const parsed = checklistInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "That couldn't be saved. Reload the page and try again." };
  const v = parsed.data as Record<string, string | undefined> & { id: string };

  const checks: EligibilityCheck[] = ELIGIBILITY_CHECKS.map((key) => {
    const note = v[`note-${key}`];
    return { key, answer: (v[`answer-${key}`] as EligibilityCheck["answer"]) ?? null, ...(note ? { note } : {}) };
  });
  const { verdict, reasons } = callEligibility(checks);
  const [row] = await db
    .update(opportunities)
    .set({ checks, eligibility: verdict, eligibilityReasons: reasons, checkedAt: new Date(), checkedBy: auth.user.id, updatedAt: new Date() })
    .where(eq(opportunities.id, v.id))
    .returning({ id: opportunities.id });
  if (!row) return { ok: false, message: "That call no longer exists." };
  await db.insert(auditLog).values({ actorId: auth.user.id, action: "call.checked", targetType: "opportunity", targetId: v.id, detail: { verdict } });
  revalidateCalendar(v.id);
  return { ok: true, message: `Checklist saved. This call is now marked ${ELIGIBILITY_LABELS[verdict].toLowerCase()}.` };
}

// ---------------------------------------------------------------------------
// Deciding: apply, or skip
// ---------------------------------------------------------------------------

/** Opens an application pursuit for the call, owned by whoever pressed the button. */
export async function startApplication(formData: FormData): Promise<void> {
  const user = await requirePermission("pipeline:edit");
  const id = z.uuid().parse(formData.get("id"));
  const call = await db.query.opportunities.findFirst({ where: eq(opportunities.id, id) });
  if (!call) redirect("/calendar");
  const existing = await db.query.pursuits.findFirst({ where: eq(pursuits.opportunityId, id), orderBy: asc(pursuits.createdAt) });
  if (existing) redirect(`/pursuits/${existing.id}`);

  const stage = call.eligibility === "eligible" ? "eligible" : "spotted";
  const pursuitId = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(pursuits)
      .values({
        funderId: call.funderId,
        opportunityId: call.id,
        title: call.title,
        track: "application",
        stage,
        ownerId: user.id,
        askAmount: call.amount,
        nextAction: call.deadline ? "Submit the application" : "Find out this year's dates",
        nextActionDue: call.deadline,
        createdBy: user.id,
      })
      .returning({ id: pursuits.id });
    await tx.insert(pursuitStageChanges).values({ pursuitId: p!.id, fromStage: null, toStage: stage, changedBy: user.id, note: "Started from the awards calendar" });
    // Deciding to apply undoes an earlier "skip".
    await tx.update(opportunities).set({ skippedReason: null, skippedAt: null }).where(eq(opportunities.id, call.id));
    await tx.insert(auditLog).values({ actorId: user.id, action: "pursuit.created", targetType: "pursuit", targetId: p!.id, detail: { title: call.title, stage, opportunityId: call.id } });
    return p!.id;
  });
  revalidateCalendar(id);
  revalidatePath("/pipeline");
  redirect(`/pursuits/${pursuitId}?created=1`);
}

const skipInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1, "Say why VE is skipping it, so nobody checks it again").max(1000),
});

export async function skipCall(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await allowed("calendar:edit");
  if ("error" in auth) return auth.error;
  const parsed = skipInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values: submitted(formData) };
  const v = parsed.data;
  const [row] = await db
    .update(opportunities)
    .set({ skippedReason: v.reason, skippedAt: new Date(), updatedAt: new Date() })
    .where(eq(opportunities.id, v.id))
    .returning({ id: opportunities.id });
  if (!row) return { ok: false, message: "That call no longer exists." };
  await db.insert(auditLog).values({ actorId: auth.user.id, action: "call.skipped", targetType: "opportunity", targetId: v.id, detail: { reason: v.reason } });
  revalidateCalendar(v.id);
  redirect(`/calendar/${v.id}?skipped=1`);
}

export async function unskipCall(formData: FormData): Promise<void> {
  const user = await requirePermission("calendar:edit");
  const id = z.uuid().parse(formData.get("id"));
  await db.update(opportunities).set({ skippedReason: null, skippedAt: null, updatedAt: new Date() }).where(eq(opportunities.id, id));
  await db.insert(auditLog).values({ actorId: user.id, action: "call.unskipped", targetType: "opportunity", targetId: id });
  revalidateCalendar(id);
  redirect(`/calendar/${id}?unskipped=1`);
}
