// Peer NGO donor lists: the companies a peer NGO names as its donors, usually copied from its
// annual report or website. A company that funds NGOs like VE is the strongest sign of fit.

import { isValidCin } from "./india";
import { parseInr } from "./pipeline";

export const MAX_DONOR_LINES = 500;

export type DonorEntry = {
  /** 1-based line number in what was pasted, so problems can point at it. */
  line: number;
  name: string;
  cin: string | null;
  /** Whole rupees, when the line gives an amount after a comma or tab. */
  amount: number | null;
};

export type DonorProblem = { line: number; text: string; reason: string };

const CIN_ANYWHERE = /\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/;
// "1.", "2)", "•", "-", "*" at the start of a line copied from a report.
const BULLET = /^\s*(?:\d{1,3}[.)]|[•·▪◦*\-–—])\s*/;
const LEGAL_SUFFIXES = new Set(["limited", "ltd", "private", "pvt", "llp", "plc", "inc", "incorporated", "co", "company"]);

/**
 * The form of a name used for matching: lower case, "&" as "and", no punctuation, and without
 * trailing legal words, so "Infosys Ltd." and "INFOSYS LIMITED" are the same company.
 */
export function companyNameKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(p\)|\(i\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words[0] === "the" && words.length > 1) words.shift();
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}

/**
 * Reads a pasted donor list: one donor per line, with an optional amount after the last comma or
 * tab ("Tata Steel Ltd, 25 lakh") and an optional CIN anywhere on the line. Bullets, numbering and
 * blank lines are ignored, and a donor listed twice is kept once.
 */
export function readDonorLines(text: string): { entries: DonorEntry[]; problems: DonorProblem[] } {
  const entries: DonorEntry[] = [];
  const problems: DonorProblem[] = [];
  const seen = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    const line = i + 1;
    if (entries.length >= MAX_DONOR_LINES) {
      problems.push({ line, text: raw, reason: `Only the first ${MAX_DONOR_LINES} donors are read. Add the rest as another list.` });
      break;
    }
    let rest = raw.replace(BULLET, "");
    const cin = CIN_ANYWHERE.exec(rest)?.[0] ?? null;
    if (cin) rest = rest.replace(cin, " ").replace(/\(\s*\)|\[\s*\]/g, " ");
    let amount: number | null = null;
    const cut = Math.max(rest.lastIndexOf(","), rest.lastIndexOf("\t"));
    if (cut >= 0) {
      const parsed = parseInr(rest.slice(cut + 1));
      if (parsed !== null) {
        amount = parsed;
        rest = rest.slice(0, cut);
      }
    }
    const name = rest
      .replace(/[\s,;:|\-–—]+$/g, "")
      .replace(/^[\s,;:|\-–—]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = companyNameKey(name);
    if (!key || !/[a-z]/.test(key)) {
      problems.push({ line, text: raw, reason: "No donor name on this line." });
      continue;
    }
    // Two lines with different CINs are different companies even if their names match.
    const first = cin ? seen.get(cin) : seen.get(key);
    if (first !== undefined) {
      problems.push({ line, text: raw, reason: `Same donor as line ${first}, so it's counted once.` });
      continue;
    }
    if (cin) seen.set(cin, line);
    if (!seen.has(key)) seen.set(key, line);
    entries.push({ line, name, cin: isValidCin(cin) ? cin : null, amount });
  }
  return { entries, problems };
}

export type KnownFunder = { id: string; name: string; cin: string | null; type: string };

export type DonorMatch<E extends DonorEntry = DonorEntry> = E &
  ({ match: "cin" | "name"; funder: Pick<KnownFunder, "id" | "name" | "type"> } | { match: "new"; funder: null });

/**
 * Finds each donor among the funders already in the portal: on CIN first, then on the matching
 * form of the name. Companies win over other funder types with the same name. Anyone not found
 * will be added as a new funder.
 */
export function matchDonors<E extends DonorEntry>(entries: E[], known: KnownFunder[]): DonorMatch<E>[] {
  const byCin = new Map(known.filter((f) => f.cin).map((f) => [f.cin!, f]));
  const byKey = new Map<string, KnownFunder>();
  for (const f of known) {
    const key = companyNameKey(f.name);
    const current = byKey.get(key);
    if (!current || (current.type !== "company" && f.type === "company")) byKey.set(key, f);
  }
  return entries.map((e) => {
    const viaCin = e.cin ? byCin.get(e.cin) : undefined;
    if (viaCin) return { ...e, match: "cin" as const, funder: { id: viaCin.id, name: viaCin.name, type: viaCin.type } };
    const viaName = byKey.get(companyNameKey(e.name));
    // A different CIN on a same-named funder means a different company.
    if (viaName && !(e.cin && viaName.cin && viaName.cin !== e.cin)) {
      return { ...e, match: "name" as const, funder: { id: viaName.id, name: viaName.name, type: viaName.type } };
    }
    return { ...e, match: "new" as const, funder: null };
  });
}
