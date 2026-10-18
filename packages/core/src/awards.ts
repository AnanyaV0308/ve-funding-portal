/**
 * Award and grant calls: the eligibility checklist and its verdict, where a call stands against
 * its dates, and when deadline reminders go out. Dates are YYYY-MM-DD strings in India time.
 */
import { type Eligibility } from "./csr";
import { daysUntil, type Stage, STAGES_BY_TRACK } from "./pipeline";

export const CALL_KINDS = ["award", "grant", "rfp"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

export const CALL_KIND_LABELS: Record<CallKind, string> = {
  award: "Award",
  grant: "Grant",
  rfp: "Call for proposals",
};

// ---------------------------------------------------------------------------
// Eligibility checklist
// ---------------------------------------------------------------------------

/** The PRD's eligibility screen for a call, one line per requirement. */
export const ELIGIBILITY_CHECKS = ["registration", "years", "fcra", "geography", "budget", "theme"] as const;
export type EligibilityCheckKey = (typeof ELIGIBILITY_CHECKS)[number];

export const ELIGIBILITY_CHECK_LABELS: Record<EligibilityCheckKey, { label: string; hint: string }> = {
  registration: { label: "Registration type", hint: "The legal form and registrations the call asks for, such as a trust, section 8 company, 12A or 80G." },
  years: { label: "Years of operation", hint: "How long the organisation must have been running." },
  fcra: { label: "No FCRA needed", hint: "VE has no FCRA registration, so a call paid from foreign funds is out." },
  geography: { label: "Geography", hint: "Where the organisation or its work must be based." },
  budget: { label: "Budget size", hint: "Limits on annual budget or turnover." },
  theme: { label: "Theme", hint: "The cause, category or theme the call is for." },
};

export const CHECK_ANSWERS = ["yes", "no", "unsure"] as const;
export type CheckAnswer = (typeof CHECK_ANSWERS)[number];

export const CHECK_ANSWER_LABELS: Record<CheckAnswer, string> = {
  yes: "VE meets it",
  no: "VE doesn't meet it",
  unsure: "Not sure",
};

export type EligibilityCheck = { key: EligibilityCheckKey; answer: CheckAnswer | null; note?: string };

/** One unanswered line per requirement, for a new call. */
export function blankChecklist(): EligibilityCheck[] {
  return ELIGIBILITY_CHECKS.map((key) => ({ key, answer: null }));
}

/** The checklist in the standard order, with any missing lines added as unanswered. */
export function normaliseChecklist(checks: readonly EligibilityCheck[] | null | undefined): EligibilityCheck[] {
  return ELIGIBILITY_CHECKS.map((key) => checks?.find((c) => c.key === key) ?? { key, answer: null });
}

const listOf = (keys: EligibilityCheckKey[]) => keys.map((k) => ELIGIBILITY_CHECK_LABELS[k].label.toLowerCase()).join(", ");

/**
 * The verdict a person's checklist adds up to. Any requirement VE doesn't meet rules the call out;
 * otherwise anything unsure or not yet checked leaves it as needs check.
 */
export function callEligibility(checks: readonly EligibilityCheck[] | null | undefined): { verdict: Eligibility; reasons: string[] } {
  const list = normaliseChecklist(checks);
  const failed = list.filter((c) => c.answer === "no").map((c) => c.key);
  const unsure = list.filter((c) => c.answer === "unsure").map((c) => c.key);
  const unchecked = list.filter((c) => c.answer === null).map((c) => c.key);

  if (failed.length) {
    const reasons = [`VE doesn't meet: ${listOf(failed)}.`];
    if (failed.includes("fcra")) reasons.push("VE has no FCRA registration, so it can't take foreign funds.");
    return { verdict: "not_eligible", reasons };
  }
  if (unsure.length || unchecked.length) {
    const reasons: string[] = [];
    if (unsure.length) reasons.push(`Not sure about: ${listOf(unsure)}.`);
    if (unchecked.length === list.length) reasons.push("Nobody has checked this call yet.");
    else if (unchecked.length) reasons.push(`Not checked yet: ${listOf(unchecked)}.`);
    return { verdict: "needs_check", reasons };
  }
  return { verdict: "eligible", reasons: ["VE meets every requirement on the checklist."] };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const CALL_STATUSES = ["not_announced", "upcoming", "open", "closed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  not_announced: "Dates not announced",
  upcoming: "Opens later",
  open: "Open",
  closed: "Closed",
};

/**
 * Where a call stands today. A recurring award whose next dates aren't out yet is "not announced";
 * once a deadline passes the call is closed.
 */
export function callStatus(call: { opensOn: string | null; deadline: string | null }, today: string): CallStatus {
  if (call.deadline && daysUntil(call.deadline, today) < 0) return "closed";
  if (call.opensOn && daysUntil(call.opensOn, today) > 0) return "upcoming";
  if (call.deadline) return "open";
  return call.opensOn ? "open" : "not_announced";
}

/** YYYY-MM-DD plus a number of days. */
export function addDays(day: string, days: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/** Reminders go out this many days before a deadline, per the PRD. */
export const REMINDER_DAYS = [30, 14, 7, 2] as const;
export type ReminderDays = (typeof REMINDER_DAYS)[number];

/**
 * The reminder that applies today: the nearest one whose day has arrived. A call added with 10
 * days left gets its 14-day reminder at once, and a missed day is caught up the next morning
 * rather than lost. Each reminder is sent once, so callers record what went out.
 */
export function dueReminder(deadline: string, today: string): ReminderDays | null {
  const left = daysUntil(deadline, today);
  if (left < 0) return null;
  const passed = REMINDER_DAYS.filter((n) => n >= left);
  return passed.length ? passed[passed.length - 1]! : null;
}

/** The four reminder dates for a deadline, earliest first. */
export function reminderSchedule(deadline: string): { days: ReminderDays; on: string }[] {
  return REMINDER_DAYS.map((days) => ({ days, on: addDays(deadline, -days) }));
}

const SUBMITTED_STAGES = new Set<Stage>(STAGES_BY_TRACK.application.slice(STAGES_BY_TRACK.application.indexOf("submitted")));

/** Reminders stop once the application has gone in (or the pursuit closed). */
export function stillNeedsReminders(stage: Stage): boolean {
  return !SUBMITTED_STAGES.has(stage);
}
