"use server";

import {
  ACTIVITY_KINDS,
  ALL_STAGES,
  FUNDER_TYPES,
  isClosed,
  isLost,
  isStageInTrack,
  parseInr,
  stageLabel,
  TRACKS,
} from "@ve/core";
import { auditLog, db, funders, pursuitActivities, pursuits, pursuitStageChanges } from "@ve/db";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type CurrentUser, NotAllowedError, requirePermission } from "@/lib/authz";

export type MoveState = { ok: boolean; message: string; movedId?: string } | null;

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
    ctx.addIssue({ code: "custom", message: "Write an amount like 40 lakh, 1.5 crore or 4000000" });
    return z.NEVER;
  }
  return n;
});

function submitted(formData: FormData): Record<string, string> {
  return Object.fromEntries([...formData].filter((e): e is [string, string] => typeof e[1] === "string"));
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

async function editor(): Promise<{ user: CurrentUser } | { error: { ok: false; message: string } }> {
  try {
    return { user: await requirePermission("pipeline:edit") };
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: { ok: false, message: e.message } };
    throw e;
  }
}

function revalidatePipeline(id?: string) {
  revalidatePath("/pipeline");
  revalidatePath("/");
  if (id) revalidatePath(`/pursuits/${id}`);
}

// ---------------------------------------------------------------------------

const createInput = z
  .object({
    funderId: z.string().refine((v) => v === "__new" || z.uuid().safeParse(v).success, "Choose a funder or add a new one"),
    newFunderName: optionalText(200),
    newFunderType: z.preprocess(blank, z.enum(FUNDER_TYPES).optional()),
    title: z.string().trim().min(1, "Say what VE is asking for, e.g. “STEM labs, FY27”").max(200),
    track: z.enum(TRACKS),
    stage: z.enum(ALL_STAGES),
    ownerId: optionalText(100),
    askAmount: amount,
    nextAction: optionalText(300),
    nextActionDue: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.funderId === "__new") {
      if (!v.newFunderName) ctx.addIssue({ code: "custom", path: ["newFunderName"], message: "Give the funder's name" });
      if (!v.newFunderType) ctx.addIssue({ code: "custom", path: ["newFunderType"], message: "Choose the funder type" });
    }
    if (!isStageInTrack(v.track, v.stage)) ctx.addIssue({ code: "custom", path: ["stage"], message: "Choose a stage from this track" });
    if (isClosed(v.stage)) ctx.addIssue({ code: "custom", path: ["stage"], message: "Start a pursuit in an open stage" });
  });

export async function createPursuit(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const { user } = auth;

  const parsed = createInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values: submitted(formData) };
  }
  const v = parsed.data;

  const id = await db.transaction(async (tx) => {
    let funderId = v.funderId;
    if (funderId === "__new") {
      // Reuse a funder with the same name rather than creating a duplicate.
      const existing = await tx.query.funders.findFirst({ where: sql`lower(${funders.name}) = lower(${v.newFunderName!})` });
      funderId =
        existing?.id ??
        (await tx.insert(funders).values({ name: v.newFunderName!, type: v.newFunderType!, createdBy: user.id }).returning({ id: funders.id }))[0]!.id;
    }
    const [p] = await tx
      .insert(pursuits)
      .values({
        funderId,
        title: v.title,
        track: v.track,
        stage: v.stage,
        ownerId: v.ownerId ?? null,
        askAmount: v.askAmount,
        nextAction: v.nextAction ?? null,
        nextActionDue: v.nextActionDue ?? null,
        createdBy: user.id,
      })
      .returning({ id: pursuits.id });
    await tx.insert(pursuitStageChanges).values({ pursuitId: p!.id, fromStage: null, toStage: v.stage, changedBy: user.id });
    await tx.insert(auditLog).values({ actorId: user.id, action: "pursuit.created", targetType: "pursuit", targetId: p!.id, detail: { title: v.title, stage: v.stage } });
    return p!.id;
  });

  revalidatePipeline();
  redirect(`/pursuits/${id}?created=1`);
}

// ---------------------------------------------------------------------------

const moveInput = z.object({
  id: z.string().uuid(),
  stage: z.enum(ALL_STAGES),
  note: optionalText(1000),
  closedReason: optionalText(1000),
  revisitOn: optionalDate,
});

type MoveInput = z.infer<typeof moveInput>;

/**
 * Moves a pursuit to another stage on its track and records the change. Moving to "Not now or lost"
 * or "Not selected" needs a reason, so without one this sends the person to the pursuit page to give it.
 */
async function applyMove(user: CurrentUser, v: MoveInput): Promise<{ title: string; changed: boolean }> {
  const current = await db.query.pursuits.findFirst({ where: eq(pursuits.id, v.id) });
  if (!current) redirect("/pipeline");
  if (!isStageInTrack(current.track, v.stage)) throw new Error("That stage isn't on this pursuit's track.");
  if (isLost(v.stage) && !v.closedReason) redirect(`/pursuits/${v.id}?close=${v.stage}`);
  if (current.stage === v.stage) return { title: current.title, changed: false };

  await db.transaction(async (tx) => {
    await tx
      .update(pursuits)
      .set({
        stage: v.stage,
        stageChangedAt: new Date(),
        // A probability someone set for the old stage no longer applies.
        probabilityOverride: null,
        closedReason: isLost(v.stage) ? v.closedReason : null,
        revisitOn: isLost(v.stage) ? (v.revisitOn ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(pursuits.id, v.id));
    await tx.insert(pursuitStageChanges).values({
      pursuitId: v.id,
      fromStage: current.stage,
      toStage: v.stage,
      note: v.closedReason ?? v.note ?? null,
      changedBy: user.id,
    });
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "pursuit.moved",
      targetType: "pursuit",
      targetId: v.id,
      detail: { from: current.stage, to: v.stage },
    });
  });
  revalidatePipeline(v.id);
  return { title: current.title, changed: true };
}

/** The move form on the pursuit page, and the close form for a lost stage. */
export async function movePursuit(formData: FormData): Promise<void> {
  const user = await requirePermission("pipeline:edit");
  const v = moveInput.parse(Object.fromEntries(formData));
  const { changed } = await applyMove(user, v);
  redirect(`/pursuits/${v.id}${changed ? "?moved=1" : ""}`);
}

/** The "Move" button and drag-and-drop on the board. Stays on the board and reports what happened. */
export async function moveOnBoard(_prev: MoveState, formData: FormData): Promise<MoveState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = moveInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "That move didn't work. Reload the page and try again." };
  const { title, changed } = await applyMove(auth.user, parsed.data);
  return changed
    ? { ok: true, message: `Moved ${title} to ${stageLabel(parsed.data.stage)}.`, movedId: parsed.data.id }
    : { ok: true, message: `${title} is already in ${stageLabel(parsed.data.stage)}.`, movedId: parsed.data.id };
}

// ---------------------------------------------------------------------------

const updateInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Give the pursuit a title").max(200),
  ownerId: optionalText(100),
  askAmount: amount,
  probabilityOverride: z.preprocess(blank, z.coerce.number().int().min(0, "0 to 100").max(100, "0 to 100").optional()),
  nextAction: optionalText(300),
  nextActionDue: optionalDate,
});

export async function updatePursuit(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = updateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values: submitted(formData) };
  }
  const { id, ...v } = parsed.data;
  const [row] = await db
    .update(pursuits)
    .set({
      title: v.title,
      ownerId: v.ownerId ?? null,
      askAmount: v.askAmount,
      probabilityOverride: v.probabilityOverride ?? null,
      nextAction: v.nextAction ?? null,
      nextActionDue: v.nextActionDue ?? null,
      updatedAt: new Date(),
    })
    .where(eq(pursuits.id, id))
    .returning({ id: pursuits.id });
  if (!row) return { ok: false, message: "That pursuit no longer exists." };
  await db.insert(auditLog).values({ actorId: auth.user.id, action: "pursuit.updated", targetType: "pursuit", targetId: id });
  revalidatePipeline(id);
  return { ok: true, message: "Details saved." };
}

// ---------------------------------------------------------------------------

const activityInput = z.object({
  pursuitId: z.string().uuid(),
  kind: z.enum(ACTIVITY_KINDS),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date"),
  summary: z.string().trim().min(1, "Write what happened").max(5000),
});

export async function addActivity(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = activityInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values: submitted(formData) };
  }
  const v = parsed.data;
  await db.transaction(async (tx) => {
    await tx.insert(pursuitActivities).values({ ...v, createdBy: auth.user.id });
    await tx.update(pursuits).set({ updatedAt: new Date() }).where(eq(pursuits.id, v.pursuitId));
  });
  revalidatePipeline(v.pursuitId);
  return { ok: true, message: "Logged." };
}
