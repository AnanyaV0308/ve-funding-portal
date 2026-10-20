// Companies' CSR annual action plans. Under rule 5(2) of the Companies (CSR Policy) Rules, every
// company's board approves an annual action plan: the year's CSR projects, where they run, what
// each is allocated and who carries them out. Rule 9 has the company put the plan and its CSR
// policy on its website. A plan says what a company is funding this year, which no other public
// source does. These are the rules for when to look, whether a document is a plan and what to
// keep from a reading; finding, fetching and reading with Claude happen in @ve/ingest.

import type { CsrPartner, CsrPartnerKind } from "./company-reports";
import { type ActionPlanFacts, DISABILITY_WORDS } from "./csr";
import { companyNameKey } from "./donors";
import { INDIAN_STATES, normaliseState, PAN_INDIA } from "./india";
import { reportFy } from "./peer-reports";

/** How often the portal looks for a company's plan, and checks the one it has for changes. */
export const PLAN_CHECK_DAYS = 30;
/** Boards approve the year's plan in its first months; after September, a plan not yet found is looked for less often. */
export const PLAN_LATE_CHECK_DAYS = 90;
/** A plan is a few pages; a longer PDF is an annual report or a bundle of policies. */
export const MAX_PLAN_PAGES = 40;

// ---------------------------------------------------------------------------
// When to look
// ---------------------------------------------------------------------------

/** The financial year now running, whose action plan boards approve in its first months. */
export function currentFy(today: Date): string {
  const year = today.getUTCFullYear();
  const start = today.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * What to do about a company's action plan now. "find" looks on the web: when someone asked, and
 * while this year's plan isn't in, once a month from April to September, when boards approve
 * plans, then every three months, since some companies never put theirs online. "recheck"
 * downloads the plan the portal already has once a month, because boards revise plans during the
 * year; an uploaded plan can't be rechecked. Null means nothing is due.
 */
export function planCheckDue(
  c: { planFys: string[]; canRecheck: boolean; checkedAt: Date | null; checkRequestedAt: Date | null },
  today: Date,
): "find" | "recheck" | null {
  if (c.checkRequestedAt) return "find";
  const days = c.checkedAt ? (today.getTime() - c.checkedAt.getTime()) / 86_400_000 : Infinity;
  if (days < PLAN_CHECK_DAYS) return null;
  if (c.planFys.some((fy) => fy >= currentFy(today))) return c.canRecheck ? "recheck" : null;
  const firstHalf = (today.getUTCMonth() + 9) % 12 < 6;
  return firstHalf || days >= PLAN_LATE_CHECK_DAYS ? "find" : null;
}

// ---------------------------------------------------------------------------
// Whether a document is the company's plan
// ---------------------------------------------------------------------------

const PLAN_WORDS = /action\s+plan/i;
const CSR_WORDS = /\bcsr\b|corporate\s+social\s+responsibility/i;
const squash = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** Whether a web address's site carries the company's name, as tatasteel.com does for Tata Steel. */
function siteNamesCompany(href: string, key: string): boolean {
  try {
    const host = new URL(href).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9]/g, "");
    const name = key.replace(/ /g, "");
    return name.length >= 3 && host.includes(name);
  } catch {
    return false;
  }
}

/**
 * Checks that a document the portal found is this company's CSR action plan, from its text: the
 * words "action plan" and CSR, and the company's name, or a site that carries the name, since
 * plans often show the company only as a logo. Gives the financial year it's for, when the text
 * says, and a reason when it isn't the plan. A scanned PDF can't be checked, so it's let through,
 * and so is one a person gave, since they chose it: the reading then says whether it's a plan.
 */
export function checkActionPlan(
  texts: string[],
  companyName: string,
  opts: { foundAt?: string | null; givenByPerson?: boolean } = {},
): { ok: true; fy: string | null } | { ok: false; reason: string } {
  const text = texts.join("\n");
  const at = text.search(PLAN_WORDS);
  // The year is usually in the plan's heading, next to the words "action plan".
  const fy = (at >= 0 ? reportFy(text.slice(Math.max(0, at - 200), at + 300)) : null) ?? reportFy(texts[0] ?? "");
  if (opts.givenByPerson || text.replace(/\s+/g, "").length < 20) return { ok: true, fy };
  if (at < 0 || !CSR_WORDS.test(text)) return { ok: false, reason: "It doesn't say it's a CSR action plan." };
  const key = companyNameKey(companyName);
  if (key && !squash(text).includes(` ${key} `) && !(opts.foundAt && siteNamesCompany(opts.foundAt, key))) {
    return { ok: false, reason: `It doesn't name ${companyName}.` };
  }
  return { ok: true, fy };
}

// ---------------------------------------------------------------------------
// What a reading gives
// ---------------------------------------------------------------------------

/** One project a plan approves for the year. */
export type PlanProject = {
  name: string;
  /** The Schedule VII area it comes under, as the plan writes it. */
  area: string | null;
  /** States it runs in, as the portal writes them, or "Pan India". */
  states: string[];
  /** Whole rupees allocated for the year. */
  amountInr: number | null;
  /** Who carries it out, when the company doesn't run it itself. */
  agency: string | null;
  agencyKind: CsrPartnerKind | null;
  /** The agency's CSR Registration Number, as in CSR00001234. */
  registration: string | null;
  /** True for a multi-year project, false for one that ends with the year. */
  ongoing: boolean | null;
  /** Whether it's for people with disabilities. */
  disability: boolean;
  /** The document's own page, where 1 is its first page; null for a web page. */
  page: number | null;
};

// Not "PwD", which in Indian plans as often means a Public Works Department, nor "inclusion", which is usually financial.
const DISABILITY_TEXT = [...DISABILITY_WORDS, "blind", "visually", "hearing impaired", "deaf", "special needs"];

/** Whether a project's name or area is about disability, whatever the reading said. */
export const aboutDisability = (p: Pick<PlanProject, "name" | "area">) => {
  const text = squash(`${p.name} ${p.area ?? ""}`);
  return DISABILITY_TEXT.some((w) => text.includes(` ${w}`));
};

/** A state as the portal writes it, or null when it isn't an Indian state or "Pan India". */
export function planState(input: string): string | null {
  if (/pan[\s-]*india|all\s+india|across\s+india|national/i.test(input)) return PAN_INDIA;
  const state = normaliseState(input);
  return (INDIAN_STATES as readonly string[]).includes(state) ? state : null;
}

/**
 * The agencies a plan names, once each, with what they're allocated across their projects. These
 * go through the same rules as an annual report's partners before any becomes an NGO it funds.
 */
export function planPartners(projects: PlanProject[]): CsrPartner[] {
  const byKey = new Map<string, CsrPartner>();
  for (const p of projects) {
    if (!p.agency?.trim()) continue;
    const key = companyNameKey(p.agency);
    const had = byKey.get(key);
    if (had) {
      had.amountInr = had.amountInr !== null && p.amountInr !== null ? had.amountInr + p.amountInr : (had.amountInr ?? p.amountInr);
      had.registration ??= p.registration;
    } else {
      byKey.set(key, { name: p.agency.trim(), kind: p.agencyKind ?? "ngo", amountInr: p.amountInr, registration: p.registration, page: p.page });
    }
  }
  return [...byKey.values()];
}

/** What a read plan says for the fit score: its budget, whether it funds disability work, and where. */
export function planFacts(plan: { fy: string; budget: number | null; projects: PlanProject[] }): ActionPlanFacts {
  const amounts = plan.projects.map((p) => p.amountInr).filter((a): a is number => a !== null);
  return {
    fy: plan.fy,
    budget: plan.budget ?? (amounts.length ? amounts.reduce((a, b) => a + b, 0) : null),
    disabilityWork: plan.projects.some((p) => p.disability),
    states: [...new Set(plan.projects.flatMap((p) => p.states))].sort(),
  };
}

/** How a plan is named on screen, and as the source of the NGOs it adds: "Titan Company Limited CSR action plan 2026-27". */
export function planLabel(companyName: string, fy: string | null): string {
  return `${companyName} CSR action plan${fy ? ` ${fy}` : ""}`;
}
