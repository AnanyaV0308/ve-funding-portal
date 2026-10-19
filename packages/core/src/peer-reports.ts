// Peer NGOs' annual reports: finding them on an NGO's website, and which of the donors read from
// one the portal adds. Fetching pages and reading PDFs happens in @ve/ingest; the rules are here.

import { normaliseFy } from "./csr";
import { companyNameKey, type DonorEntry, MAX_DONOR_LINES } from "./donors";
import { isValidCin } from "./india";

/** How often the portal looks at each peer NGO's website for a new report. */
export const PEER_CHECK_DAYS = 30;
/** The newest reports read from an NGO the first time; later checks read only reports newer than these. */
export const REPORTS_PER_NGO = 2;
/** Pages followed from the page someone gave, when that page doesn't link to a report itself. */
export const MAX_PAGES_FOLLOWED = 6;

export type ReportLink = { url: string; text: string; fy: string | null };

const REPORT_WORDS = /annual[\s_-]*(?:report|review)|yearly[\s_-]*report|(?:\bAR|report)[\s_-]*(?:20)?\d{2}(?!\d)/i;
// Reports that list no donors: audits, FCRA returns and other filings.
const NOT_REPORTS = /audit|financial[\s_-]*statement|balance[\s_-]*sheet|fcra|utili[sz]ation|\b80g\b|\b12a\b|form[\s_-]*(?:10|csr)/i;
const FOLLOW_WORDS = /annual[\s_-]*reports?|\breports\b|publications|financials?|transparency|accountability|downloads|resources/i;

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** A Google Drive file link as a direct download, or null for any other link. */
export function driveDownloadUrl(url: URL): string | null {
  if (url.hostname !== "drive.google.com") return null;
  const id = /\/file\/d\/([\w-]{10,})/.exec(url.pathname)?.[1] ?? (url.pathname === "/open" || url.pathname === "/uc" ? url.searchParams.get("id") : null);
  return id && /^[\w-]{10,}$/.test(id) ? `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t` : null;
}

const isPdf = (url: URL) => /\.pdf$/i.test(url.pathname) || driveDownloadUrl(url) !== null;

/**
 * The financial year a report covers, from its link text or file name: "Annual Report 2023-24",
 * "AR_2023_2024.pdf", "Report_23-24" and "FY24" are all 2023-24. A year on its own isn't enough to tell.
 */
export function reportFy(...texts: string[]): string | null {
  for (const t of texts) {
    const text = t.replace(/_+/g, "-");
    const fy = normaliseFy(text);
    if (fy) return fy;
    const pair = /(?<!\d|\d\.)(\d{2})\s*[-–]\s*(\d{2})(?!\d|\.\d)/.exec(text);
    const single = /\bFY\s*-?\s*(\d{2})(?!\d)/i.exec(text);
    const [start, end] = pair ? [Number(pair[1]), Number(pair[2])] : single ? [(Number(single[1]) + 99) % 100, Number(single[1])] : [-1, -2];
    if (start >= 0 && (start + 1) % 100 === end) return `20${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`;
  }
  return null;
}

/** For putting reports newest first: the year a report's financial year ends, or the latest year it mentions. */
function newness(link: ReportLink): number {
  if (link.fy) return Number(link.fy.slice(0, 4)) + 1;
  const years = [...`${link.text} ${link.url}`.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : 0;
}

/**
 * Reads a web page's links. `reports` are PDFs that look like annual reports (by their text or file
 * name); `pages` are other pages on the same site worth looking at for reports, such as "Annual
 * reports" or "Financials".
 */
export function findReportLinks(html: string, pageUrl: string): { reports: ReportLink[]; pages: string[] } {
  const base = new URL(pageUrl);
  const reports: ReportLink[] = [];
  const pages: string[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attr(m[1]!, "href");
    if (!href || href.startsWith("#")) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    url.hash = "";
    const inner = m[2]!.replace(/<img\b[^>]*>/gi, (img) => ` ${attr(img, "alt") ?? ""} `).replace(/<[^>]+>/g, " ");
    const text = decode([inner, attr(m[1]!, "title") ?? "", attr(m[1]!, "aria-label") ?? ""].join(" "))
      .replace(/\s+/g, " ")
      .trim();
    const file = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (isPdf(url)) {
      if ((REPORT_WORDS.test(text) || REPORT_WORDS.test(file)) && !NOT_REPORTS.test(text) && !NOT_REPORTS.test(file)) {
        const href = driveDownloadUrl(url) ?? url.href;
        if (!reports.some((r) => r.url === href)) reports.push({ url: href, text: text || file, fy: reportFy(text, file) });
      }
    } else if (url.host === base.host && url.href !== base.href && (FOLLOW_WORDS.test(text) || FOLLOW_WORDS.test(url.pathname))) {
      if (!pages.includes(url.href)) pages.push(url.href);
    }
  }
  return { reports, pages: pages.slice(0, MAX_PAGES_FOLLOWED) };
}

/**
 * The reports worth reading: the newest few, minus any already known. Once the newest are known,
 * nothing older is read, so a site full of old reports only costs one read per new report.
 */
export function reportsToRead(found: ReportLink[], knownUrls: Iterable<string>, limit = REPORTS_PER_NGO): ReportLink[] {
  const known = new Set(knownUrls);
  const unique = found.filter((r, i) => found.findIndex((o) => o.url === r.url) === i);
  const newest = unique
    .map((r, i) => ({ r, i }))
    .sort((a, b) => newness(b.r) - newness(a.r) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.r);
  return newest.filter((r) => !known.has(r.url));
}

// ---------------------------------------------------------------------------
// The pages of a report to read
// ---------------------------------------------------------------------------

/** The most pages sent to be read from one report. */
export const MAX_PAGES_READ = 16;

// Headings and phrases that start a list of donors, and words that appear around one.
const DONOR_SECTION =
  /\b(?:our|key|major|corporate|csr|funding|institutional)\s+(?:donors?|funders?|supporters?|partners?|sponsors?)\b|\bdonors?\s*(?:list|&|and)\b|\b(?:thank(?:s| you)|gratitude|grateful)\b[^.]{0,60}\b(?:donors?|supporters?|partners?|funders?)\b|\backnowledg(?:e?ments?|ing)\b|\b(?:schedule\s+of\s+|)(?:donations?|grants?)\s+received\b|\bwith\s+support\s+from\b/i;
const DONOR_WORDS = /\b(?:donors?|donations?|funders?|supporters?|sponsors?|csr|grants?|contributions?)\b/gi;

/**
 * Which pages of a report to send to be read: pages that start a list of donors, and the page after
 * each (lists of logos often run on with no text). When nothing reads like a donor list, for
 * example in a scanned report, the answer is null: read the whole report.
 */
export function pagesToRead(pageTexts: string[]): number[] | null {
  const picked = new Set<number>();
  const scores = pageTexts.map((t) => (DONOR_SECTION.test(t) ? 10 : 0) + Math.min((t.match(DONOR_WORDS) ?? []).length, 9));
  const strong = scores.map((s, i) => ({ s, i })).filter((p) => p.s >= 10);
  const chosen = strong.length ? strong : scores.map((s, i) => ({ s, i })).filter((p) => p.s >= 4);
  if (!chosen.length) return null;
  for (const { i } of chosen.sort((a, b) => b.s - a.s || a.i - b.i)) {
    for (const page of [i, i + 1]) if (page < pageTexts.length && picked.size < MAX_PAGES_READ) picked.add(page);
  }
  return [...picked].sort((a, b) => a - b).map((i) => i + 1);
}

// ---------------------------------------------------------------------------
// Donors read from a report
// ---------------------------------------------------------------------------

export const REPORT_DONOR_KINDS = ["company", "foundation", "individual", "government", "other"] as const;
export type ReportDonorKind = (typeof REPORT_DONOR_KINDS)[number];

/** One donor as the reader found it in a report. */
export type ReportDonor = {
  name: string;
  kind: ReportDonorKind;
  /** False for a donor registered outside India, such as a foreign foundation or embassy. */
  inIndia: boolean;
  cin: string | null;
  /** Whole rupees, only when the report gives an amount in rupees. */
  amountInr: number | null;
  /** The PDF page it appears on, so people can check it. */
  page: number | null;
};

export type LeftOutReason = "government" | "abroad" | "individual" | "other";

export const LEFT_OUT_REASONS: Record<LeftOutReason, string> = {
  government: "Government bodies",
  abroad: "Registered outside India, and VE can't take foreign money",
  individual: "People, whom the portal doesn't add on its own",
  other: "Not a company or a foundation",
};

export type ReportDonorEntry = DonorEntry & { type: "company" | "foundation"; page: number | null };

/**
 * Which donors from a report the portal adds: Indian companies and foundations, each once. Others
 * are left out with a reason, so the team can add any of them by hand.
 */
export function donorsToAdd(donors: ReportDonor[]): { entries: ReportDonorEntry[]; leftOut: { name: string; reason: LeftOutReason }[] } {
  const entries: ReportDonorEntry[] = [];
  const leftOut: { name: string; reason: LeftOutReason }[] = [];
  const seen = new Set<string>();
  donors.forEach((d, i) => {
    const name = d.name.replace(/\s+/g, " ").trim();
    const key = companyNameKey(name);
    if (!key || !/[a-z]/.test(key)) return;
    const reason: LeftOutReason | null =
      d.kind === "government" ? "government" : d.kind === "individual" ? "individual" : d.kind === "other" ? "other" : !d.inIndia ? "abroad" : null;
    if (reason) {
      leftOut.push({ name, reason });
      return;
    }
    const cin = isValidCin(d.cin) ? d.cin : null;
    if (seen.has(key) || (cin && seen.has(cin))) return;
    seen.add(key);
    if (cin) seen.add(cin);
    if (entries.length >= MAX_DONOR_LINES) return;
    const amount = Number.isSafeInteger(d.amountInr) && d.amountInr! > 0 ? d.amountInr : null;
    const page = Number.isSafeInteger(d.page) && d.page! > 0 ? d.page : null;
    entries.push({ line: i + 1, name, cin, amount, type: d.kind === "foundation" ? "foundation" : "company", page });
  });
  return { entries, leftOut };
}
