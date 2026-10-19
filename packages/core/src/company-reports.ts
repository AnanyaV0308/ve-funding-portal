// Listed companies' own annual reports. Every listed company publishes its annual report on its
// website, and the report's CSR section says what the company had to spend, what it spent and
// often which NGOs ran its projects, a year or more before the National CSR Portal does. These are
// the rules for which companies to follow, which pages to read and what to keep from a reading;
// finding, fetching and reading with Claude happen in @ve/ingest.

import type { Eligibility } from "./csr";
import { companyNameKey } from "./donors";
import { cinIsListed } from "./india";
import { reportFy } from "./peer-reports";

/** How many of the best-fitting listed companies the portal follows until an admin changes it. */
export const DEFAULT_COMPANIES_FOLLOWED = 100;
export const MAX_COMPANIES_FOLLOWED = 1000;
/** How often the portal looks for a company's report while the year's report isn't in yet. */
export const COMPANY_CHECK_DAYS = 30;

// ---------------------------------------------------------------------------
// Which companies, and when
// ---------------------------------------------------------------------------

/**
 * The financial year whose annual reports are due: the one that ended on the last 31 March.
 * Companies publish them between May and September.
 */
export function dueReportFy(today: Date): string {
  const year = today.getUTCFullYear();
  const start = today.getUTCMonth() >= 3 ? year - 1 : year - 2;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export type FollowCandidate = { id: string; name: string; cin: string | null; isForeign: boolean; eligibility: Eligibility | null; fitScore: number | null };

/**
 * The companies whose reports the portal looks for: listed Indian companies that aren't ruled out,
 * best fit first. A CIN starting with L is what says a company is listed.
 */
export function companiesToFollow<T extends FollowCandidate>(funders: T[], limit: number): T[] {
  return funders
    .filter((f) => cinIsListed(f.cin) && !f.isForeign && f.eligibility !== "not_eligible")
    .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

/**
 * Whether to look for a company's report now: when someone asked, or monthly until the due year's
 * report is in. Once it is, nothing more is looked for until the next year's reports are due.
 */
export function companyCheckDue(c: { reportFys: string[]; checkedAt: Date | null; checkRequestedAt: Date | null }, today: Date): boolean {
  if (c.checkRequestedAt) return true;
  if (c.reportFys.some((fy) => fy >= dueReportFy(today))) return false;
  return !c.checkedAt || today.getTime() - c.checkedAt.getTime() >= COMPANY_CHECK_DAYS * 86_400_000;
}

// ---------------------------------------------------------------------------
// Finding a report, and whether a PDF is the company's annual report
// ---------------------------------------------------------------------------

/** NSE's terms of use forbid automated collection from its website, and BSE blocks it, so the portal never fetches from them. */
export const EXCHANGE_SITES = ["nseindia.com", "bseindia.com"];

export const onExchangeSite = (url: URL) => EXCHANGE_SITES.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));

/**
 * The link on the last "PDF: <link>" line of the finder's reply. Null for "PDF: none", for no such
 * line, and for anything that isn't a web link or is on a stock exchange's website.
 */
export function reportLinkFromReply(reply: string): string | null {
  const lines = [...reply.matchAll(/^[\s*]*PDF\**:\**\s*<?(\S+?)>?[.)]*\s*$/gim)];
  const link = lines.at(-1)?.[1];
  if (!link || /^none$/i.test(link)) return null;
  try {
    const url = new URL(link);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || onExchangeSite(url)) return null;
    return url.href;
  } catch {
    return null;
  }
}

const REPORT_WORDS = /annual\s+report|integrated\s+(?:annual\s+)?report|report\s+and\s+accounts/i;
const squash = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/**
 * Checks that a PDF found on the web is this company's annual report, from the text of its first
 * pages: the company's name and the words "annual report" (or "integrated report"). Gives the
 * financial year it covers when the pages say, and a reason when it isn't the report.
 */
export function checkAnnualReport(firstPages: string[], companyName: string): { ok: true; fy: string | null } | { ok: false; reason: string } {
  const text = firstPages.join("\n");
  if (text.replace(/\s+/g, "").length < 20) return { ok: true, fy: reportFy(text) };
  const key = companyNameKey(companyName);
  if (key && !squash(text).includes(` ${key} `)) return { ok: false, reason: `Its first pages don't name ${companyName}.` };
  if (!REPORT_WORDS.test(text)) return { ok: false, reason: "Its first pages don't say it's an annual report." };
  return { ok: true, fy: reportFy(text) };
}

// ---------------------------------------------------------------------------
// The pages of a report to read
// ---------------------------------------------------------------------------

/** The most pages of one report sent to be read. A CSR annexure is usually 4 to 12 pages. */
export const MAX_CSR_PAGES = 24;

// The heading of the CSR annexure, as the CSR Rules name it, and how reports put it.
const CSR_ANNEXURE =
  /annual\s+report\s+on\s+(?:the\s+)?(?:csr|corporate\s+social\s+responsibility)|report\s+on\s+(?:the\s+)?(?:csr|corporate\s+social\s+responsibility)\s+activities/i;
// Phrases of the annexure, the notes to the accounts and the BRSR that are about CSR money and projects.
const CSR_TERMS = [
  /two\s+per\s*cent|2\s*%\s+of\s+(?:the\s+)?average\s+net\s+profit/i,
  /average\s+net\s+profit/i,
  /unspent\s+csr/i,
  /schedule\s+vii/i,
  /implementing\s+agenc/i,
  /\bCSR\s?\d{8}\b/,
  /total\s+csr\s+obligation|csr\s+obligation/i,
  /csr\s+committee/i,
  /section\s+135/i,
  /gross\s+amount\s+required\s+to\s+be\s+spent/i,
  /amount\s+spent\s+(?:on|for|during)/i,
  /\bcsr\s+(?:projects?|activities|expenditure|spend|initiatives?|programmes?|partners?)\b/i,
  /corporate\s+social\s+responsibility/i,
];
const REGISTRATIONS = /\bCSR\s?\d{8}\b/g;
const DISABILITY = /disabilit|disabled|visual(?:ly)?\s+impair|\bblind|divyang|differently[\s-]+abled|special\s+needs|special\s+education|assistive/i;
const NGO_WORDS = /\b(?:ngos?|trust|foundation|society|sansthan|samiti|partner(?:ed|ing|ship)?)\b/i;

function csrPageScore(text: string): number {
  const terms = CSR_TERMS.filter((t) => t.test(text)).length;
  if (!terms) return 0;
  const registrations = Math.min((text.match(REGISTRATIONS) ?? []).length, 10);
  return (CSR_ANNEXURE.test(text) ? 20 : 0) + terms * 3 + registrations + (DISABILITY.test(text) ? 4 : 0) + (NGO_WORDS.test(text) ? 1 : 0);
}

/** A page needs this score to count on its own: the annexure's heading, or several CSR phrases. */
const STRONG_PAGE = 9;

/**
 * Which pages of an annual report to send to be read: the CSR annexure and other pages about CSR
 * money and projects, with the page after each, since the annexure's tables run on. Null when no
 * page is about CSR, such as a scanned report with no text; such a report is too long to read whole.
 */
export function csrPagesToRead(pageTexts: string[]): number[] | null {
  const scores = pageTexts.map(csrPageScore);
  const ranked = scores
    .map((s, i) => ({ s, i }))
    .filter((p) => p.s >= STRONG_PAGE)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  if (!ranked.length) return null;
  const picked = new Set<number>();
  for (const { i } of ranked) {
    for (const page of [i, i + 1]) {
      if (page < pageTexts.length && picked.size < MAX_CSR_PAGES) picked.add(page);
    }
  }
  return [...picked].sort((a, b) => a - b).map((i) => i + 1);
}

// ---------------------------------------------------------------------------
// What a reading gives
// ---------------------------------------------------------------------------

export const CSR_PARTNER_KINDS = ["ngo", "own_foundation", "government", "other"] as const;
export type CsrPartnerKind = (typeof CSR_PARTNER_KINDS)[number];

/** An organisation the report names as running or receiving the company's CSR money. */
export type CsrPartner = {
  name: string;
  kind: CsrPartnerKind;
  /** Whole rupees, when the report gives this partner's amount. */
  amountInr: number | null;
  /** The CSR Registration Number from Form CSR-1, as in CSR00001234. */
  registration: string | null;
  /** The report's own page number in the PDF, so people can check it. */
  page: number | null;
};

/** Work for people with disabilities the report describes, which counts towards the cause part of the fit score. */
export type DisabilityWork = { description: string; amountInr: number | null; page: number | null };

export type PartnerLeftOutReason = "own_foundation" | "government" | "other" | "unconfirmed";

export const PARTNER_LEFT_OUT_REASONS: Record<PartnerLeftOutReason, string> = {
  own_foundation: "The company's own foundation or trust, which passes its CSR money on",
  government: "Government funds and bodies, such as PM CARES",
  other: "Not an NGO",
  unconfirmed: "Not found in the report's text, so it may have been misread",
};

const OWN_FOUNDATION = /\b(?:foundation|trust|charitable|welfare)\b/i;

/**
 * Which partners from a reading become "NGOs it funds": NGOs the report's text names, each once.
 * The company's own foundation, government funds and anything the text doesn't contain are left
 * out with a reason. When the pages read have no text (a scan), there's nothing to check names
 * against, so the reading is trusted.
 */
export function partnersToAdd(
  partners: CsrPartner[],
  ctx: { companyName: string; pageTexts: string[] },
): { add: CsrPartner[]; leftOut: { name: string; reason: PartnerLeftOutReason }[] } {
  const add: CsrPartner[] = [];
  const leftOut: { name: string; reason: PartnerLeftOutReason }[] = [];
  const text = squash(ctx.pageTexts.join(" "));
  const hasText = text.trim().split(" ").length >= 100;
  const own = companyNameKey(ctx.companyName);
  const seen = new Set<string>();
  for (const p of partners) {
    const name = p.name.replace(/\s+/g, " ").trim();
    const key = companyNameKey(name);
    // The company itself, where it ran a project directly, isn't a partner.
    if (!key || !/[a-z]/.test(key) || seen.has(key) || key === own) continue;
    seen.add(key);
    // "Infosys Foundation" for Infosys Limited, whatever the reading called it.
    const ownFoundation = p.kind === "own_foundation" || (own !== "" && key.startsWith(`${own} `) && OWN_FOUNDATION.test(name));
    const reason: PartnerLeftOutReason | null = ownFoundation
      ? "own_foundation"
      : p.kind === "government"
        ? "government"
        : p.kind === "other"
          ? "other"
          : hasText && !text.includes(` ${key} `)
            ? "unconfirmed"
            : null;
    if (reason) leftOut.push({ name, reason });
    else {
      const amountInr = Number.isSafeInteger(p.amountInr) && p.amountInr! > 0 ? p.amountInr : null;
      const page = Number.isSafeInteger(p.page) && p.page! > 0 ? p.page : null;
      const registration = p.registration && /^CSR\s?\d{8}$/i.test(p.registration.trim()) ? p.registration.replace(/\s/g, "").toUpperCase() : null;
      add.push({ name, kind: "ngo", amountInr, registration, page });
    }
  }
  return { add, leftOut };
}

/**
 * How a company report is named on screen: "Infosys Limited annual report 2025-26". Grantees it
 * adds carry this as their source.
 */
export function companyReportLabel(companyName: string, fy: string | null): string {
  return `${companyName} annual report${fy ? ` ${fy}` : ""}`;
}

/** Page numbers as ranges, for saying which pages were read: [3, 4, 5, 9] → "3–5 and 9". */
export function pageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    ranges.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return ranges.length > 1 ? `${ranges.slice(0, -1).join(", ")} and ${ranges.at(-1)}` : (ranges[0] ?? "");
}
