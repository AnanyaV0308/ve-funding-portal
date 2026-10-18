/**
 * Pipeline rules. Every pursuit is on one of two tracks: relationship pursuits (CSR, foundations,
 * HNIs, intermediaries) and application pursuits (awards and grants). Each stage carries a default
 * probability, so the weighted pipeline value means the same thing on every screen.
 */

export const TRACKS = ["relationship", "application"] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<Track, string> = {
  relationship: "Relationships",
  application: "Applications",
};

type StageDef = { label: string; probability: number; closed?: "won" | "lost" };

/** Relationship stages and probabilities from the PRD. */
const RELATIONSHIP_STAGES = {
  identified: { label: "Identified", probability: 2 },
  qualified: { label: "Qualified", probability: 5 },
  intro_requested: { label: "Intro requested", probability: 8 },
  contacted: { label: "Contacted", probability: 10 },
  in_conversation: { label: "In conversation", probability: 20 },
  meeting_held: { label: "Meeting or site visit held", probability: 30 },
  proposal_sent: { label: "Proposal sent", probability: 45 },
  due_diligence: { label: "Due diligence", probability: 65 },
  committed: { label: "Committed", probability: 90 },
  funds_received: { label: "Funds received", probability: 100, closed: "won" },
  not_now: { label: "Not now or lost", probability: 0, closed: "lost" },
} as const satisfies Record<string, StageDef>;

/** Application stages from the PRD. Probabilities are starting defaults for VE to tune. */
const APPLICATION_STAGES = {
  spotted: { label: "Spotted", probability: 5 },
  eligible: { label: "Eligible", probability: 10 },
  drafting: { label: "Drafting", probability: 15 },
  in_review: { label: "In review", probability: 20 },
  approved: { label: "Approved to submit", probability: 25 },
  submitted: { label: "Submitted", probability: 30 },
  shortlisted: { label: "Shortlisted", probability: 50 },
  won: { label: "Won", probability: 100, closed: "won" },
  not_selected: { label: "Not selected", probability: 0, closed: "lost" },
} as const satisfies Record<string, StageDef>;

export type RelationshipStage = keyof typeof RELATIONSHIP_STAGES;
export type ApplicationStage = keyof typeof APPLICATION_STAGES;
export type Stage = RelationshipStage | ApplicationStage;

const STAGE_DEFS: Record<Stage, StageDef> = { ...RELATIONSHIP_STAGES, ...APPLICATION_STAGES };

export const STAGES_BY_TRACK: Record<Track, readonly Stage[]> = {
  relationship: Object.keys(RELATIONSHIP_STAGES) as RelationshipStage[],
  application: Object.keys(APPLICATION_STAGES) as ApplicationStage[],
};

export const ALL_STAGES = [...STAGES_BY_TRACK.relationship, ...STAGES_BY_TRACK.application] as [Stage, ...Stage[]];

export function stageLabel(stage: Stage): string {
  return STAGE_DEFS[stage].label;
}

export function defaultProbability(stage: Stage): number {
  return STAGE_DEFS[stage].probability;
}

export function isStageInTrack(track: Track, stage: string): stage is Stage {
  return (STAGES_BY_TRACK[track] as readonly string[]).includes(stage);
}

export function isClosed(stage: Stage): boolean {
  return Boolean(STAGE_DEFS[stage].closed);
}

export function isLost(stage: Stage): boolean {
  return STAGE_DEFS[stage].closed === "lost";
}

export function firstStage(track: Track): Stage {
  return STAGES_BY_TRACK[track][0]!;
}

/** The probability used for a pursuit: a person's override if they set one, otherwise the stage default. */
export function effectiveProbability(stage: Stage, override: number | null | undefined): number {
  return override ?? defaultProbability(stage);
}

/** Ask amount (in rupees) times probability, rounded to whole rupees. */
export function weightedValue(askRupees: number | null | undefined, probability: number): number {
  if (!askRupees) return 0;
  return Math.round((askRupees * probability) / 100);
}

export const STUCK_AFTER_DAYS = 21;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/** An open pursuit that hasn't changed stage in 21 days is flagged as stuck. */
export function isStuck(stage: Stage, stageChangedAt: Date, now: Date = new Date()): boolean {
  return !isClosed(stage) && daysBetween(stageChangedAt, now) > STUCK_AFTER_DAYS;
}

/** Next actions due within this many days show on This week. */
export const DUE_SOON_WINDOW_DAYS = 14;

/** Whole days from `today` to `due`, both YYYY-MM-DD; negative when overdue. */
export function daysUntil(due: string, today: string): number {
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(due) - ms(today)) / (24 * 60 * 60 * 1000));
}

export type DueState = "overdue" | "today" | "soon" | "later";

/** Where a next action's due date stands, for an open pursuit. */
export function dueState(due: string, today: string): DueState {
  const d = daysUntil(due, today);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  return d <= DUE_SOON_WINDOW_DAYS ? "soon" : "later";
}

const LAKH = 100_000;
const CRORE = 10_000_000;

/** Short Indian-style amounts: ₹40 L, ₹1.25 Cr, ₹75,000. */
export function formatInrShort(rupees: number | null | undefined): string {
  if (rupees === null || rupees === undefined) return "";
  const sign = rupees < 0 ? "-" : "";
  const n = Math.abs(rupees);
  const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, "");
  if (n >= CRORE) return `${sign}₹${trim(n / CRORE)} Cr`;
  if (n >= LAKH) return `${sign}₹${trim(n / LAKH)} L`;
  return `${sign}₹${new Intl.NumberFormat("en-IN").format(n)}`;
}

/** Full Indian grouping: ₹40,00,000. */
export function formatInr(rupees: number | null | undefined): string {
  if (rupees === null || rupees === undefined) return "";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(rupees)}`;
}

/**
 * Parses what people type for an amount: "40 lakh", "40L", "1.5 cr", "₹40,00,000", "4000000".
 * Returns whole rupees, or null when it can't be read.
 */
export function parseInr(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/[₹,\s]/g, "").replace(/^rs\.?/, "");
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(l|lakh|lakhs|lac|lacs|cr|crore|crores|k)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "";
  const mult = unit.startsWith("c") ? CRORE : unit.startsWith("l") ? LAKH : unit === "k" ? 1000 : 1;
  const value = Math.round(n * mult);
  return Number.isSafeInteger(value) ? value : null;
}

export const FUNDER_TYPES = ["company", "foundation", "hni", "intermediary", "government", "award_body"] as const;
export type FunderType = (typeof FUNDER_TYPES)[number];

export const FUNDER_TYPE_LABELS: Record<FunderType, string> = {
  company: "Company (CSR)",
  foundation: "Foundation or trust",
  hni: "HNI",
  intermediary: "Intermediary",
  government: "Government",
  award_body: "Award or grant body",
};

export const ACTIVITY_KINDS = ["note", "call", "meeting", "email", "document"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  document: "Document sent",
};
