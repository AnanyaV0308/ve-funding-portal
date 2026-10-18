/**
 * Knowledge base rules. Drafts are only as good as the facts behind them, so every fact carries
 * when someone last checked it, and how often it needs re-checking. Facts that haven't been
 * confirmed, or are past their review date, are kept out of new drafts.
 */
export const KNOWLEDGE_CATEGORIES = ["organisation", "impact", "programme", "story", "answer", "budget"] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, { name: string; description: string; refreshMonths: number }> = {
  organisation: { name: "Organisation", description: "Registrations, leadership, address and compliance", refreshMonths: 12 },
  impact: { name: "Impact numbers", description: "Students, teachers, schools, states and devices, by year", refreshMonths: 3 },
  programme: { name: "Programmes", description: "What each programme does, at different lengths", refreshMonths: 6 },
  story: { name: "Stories", description: "Student, teacher and parent stories, with consent", refreshMonths: 12 },
  answer: { name: "Answer library", description: "Approved answers to common application questions", refreshMonths: 12 },
  budget: { name: "Budget templates", description: "Standard unit costs per school, lab, device or teacher", refreshMonths: 12 },
};

export const DOCUMENT_KINDS = [
  "annual_report",
  "audited_accounts",
  "registration",
  "policy",
  "proposal",
  "mou",
  "award_citation",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  annual_report: "Annual report",
  audited_accounts: "Audited accounts",
  registration: "Registration certificate",
  policy: "Policy",
  proposal: "Past proposal",
  mou: "MoU",
  award_citation: "Award citation",
  other: "Other",
};

export const CONSENT_STATUSES = ["given", "pending", "not_given"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export type FactStatus = "unconfirmed" | "current" | "due_soon" | "stale";

export const FACT_STATUS_LABELS: Record<FactStatus, string> = {
  unconfirmed: "Needs confirming",
  current: "Current",
  due_soon: "Review soon",
  stale: "Out of date",
};

/** Days before the review date at which a fact is flagged "Review soon". */
export const DUE_SOON_DAYS = 30;

/** Adds calendar months, clamping to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()),
  );
}

export function reviewDueDate(confirmedAt: Date, refreshMonths: number): Date {
  return addMonths(confirmedAt, refreshMonths);
}

export function factStatus(
  fact: { confirmedAt: Date | null; refreshMonths: number },
  now: Date = new Date(),
): FactStatus {
  if (!fact.confirmedAt) return "unconfirmed";
  const due = reviewDueDate(fact.confirmedAt, fact.refreshMonths);
  if (now >= due) return "stale";
  const soon = new Date(due.getTime() - DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  return now >= soon ? "due_soon" : "current";
}

/** Whether a fact may be used in a new draft. Unconfirmed and out-of-date facts are held back. */
export function usableInDrafts(status: FactStatus): boolean {
  return status === "current" || status === "due_soon";
}
