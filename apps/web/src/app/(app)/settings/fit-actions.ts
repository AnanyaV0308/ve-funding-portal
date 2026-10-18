"use server";

import { FIT_PARTS, type FitSettings, fitSettingsProblems, INDIAN_STATES, parseInr } from "@ve/core";
import { auditLog, db, funders, markFullRescore, saveFitSettings } from "@ve/db";
import { rescoreFunders } from "@ve/ingest";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NotAllowedError, requirePermission } from "@/lib/authz";

export type FitFormState = { ok: boolean; message: string; problems?: string[] } | null;

/** Below this many companies, saving rescores them straight away; above it, the worker does it. */
const RESCORE_NOW_LIMIT = 2000;

export async function saveFitSettingsAction(_prev: FitFormState, formData: FormData): Promise<FitFormState> {
  let user;
  try {
    user = await requirePermission("settings:manage");
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, message: e.message };
    throw e;
  }

  const floor = parseInr(String(formData.get("floor") ?? ""));
  const settings: FitSettings = {
    weights: Object.fromEntries(FIT_PARTS.map((p) => [p, Number(formData.get(`weight-${p}`) || 0)])) as FitSettings["weights"],
    floorRupees: floor ?? -1,
    veStates: formData.getAll("veStates").map(String).filter((s) => (INDIAN_STATES as readonly string[]).includes(s)),
    peerNgos: String(formData.get("peerNgos") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200),
  };
  const problems = fitSettingsProblems(settings);
  if (floor === null) problems.unshift("Write the floor as an amount, like 5 lakh.");
  if (problems.length) return { ok: false, message: "The settings weren't saved.", problems: [...new Set(problems)] };

  await saveFitSettings(settings, user.id);
  await db.insert(auditLog).values({ actorId: user.id, action: "settings.fit_saved", targetType: "settings", targetId: "fit", detail: settings });

  const [companies] = await db.select({ n: sql<number>`count(*)::int` }).from(funders).where(eq(funders.type, "company"));
  let message = "Saved. The worker is rescoring every company now; the leads list updates within a few minutes.";
  if ((companies?.n ?? 0) <= RESCORE_NOW_LIMIT) {
    const startedAt = new Date();
    await rescoreFunders();
    await markFullRescore(startedAt);
    message = "Saved, and every company has been rescored.";
  }
  revalidatePath("/settings");
  revalidatePath("/leads");
  revalidatePath("/");
  return { ok: true, message };
}
