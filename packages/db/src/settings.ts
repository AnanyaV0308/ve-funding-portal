import { DEFAULT_FIT_SETTINGS, type FitSettings, fitSettingsProblems } from "@ve/core";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { appSettings } from "./schema";

const FIT = "fit";
/** When the fit settings last changed, so the worker knows to score every company again. */
const FIT_CHANGED = "fit_changed_at";
const FULL_RESCORE = "full_rescore_at";

/** The fit-score settings, falling back to the defaults for anything missing or invalid. */
export async function getFitSettings(): Promise<FitSettings> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, FIT) });
  const value = { ...DEFAULT_FIT_SETTINGS, ...((row?.value as Partial<FitSettings> | undefined) ?? {}) };
  return fitSettingsProblems(value).length ? DEFAULT_FIT_SETTINGS : value;
}

async function put(key: string, value: unknown, userId: string | null) {
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId, updatedAt: sql`now()` } });
}

async function getTime(key: string): Promise<Date | null> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  return typeof row?.value === "string" ? new Date(row.value) : null;
}

export async function saveFitSettings(value: FitSettings, userId: string) {
  await put(FIT, value, userId);
  await put(FIT_CHANGED, new Date().toISOString(), userId);
}

/** True when the settings changed after the last time every company was scored. */
export async function fullRescoreDue(): Promise<boolean> {
  const [changed, done] = await Promise.all([getTime(FIT_CHANGED), getTime(FULL_RESCORE)]);
  return Boolean(changed && (!done || changed > done));
}

export async function markFullRescore(at: Date) {
  await put(FULL_RESCORE, at.toISOString(), null);
}
