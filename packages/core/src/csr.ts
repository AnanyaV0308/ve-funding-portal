/**
 * The CSR engine's rules: reading National CSR Portal data, the eligibility verdict and the fit
 * score. Everything here is plain, tested code so the team can see exactly why a company ranks
 * where it does. Nothing here calls AI.
 */
import { parseCsv } from "./csv";
import { cinState, INDIAN_STATES, isValidCin, normaliseState, PAN_INDIA } from "./india";
import { formatInrShort } from "./pipeline";

// ---------------------------------------------------------------------------
// Financial years
// ---------------------------------------------------------------------------

/** "2023-24", "2023-2024", "FY 2023-24" or "FY2023-24" → "2023-24". Returns null if it can't be read. */
export function normaliseFy(input: string): string | null {
  const m = /(\d{4})\s*[-–/]\s*(\d{4}|\d{2})(?!\d)/.exec(input);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]!.slice(-2));
  if (end !== (start + 1) % 100) return null;
  return `${start}-${String(end).padStart(2, "0")}`;
}

export function fyLabel(fy: string): string {
  return `FY ${fy}`;
}

/** Newest first. */
export function sortFysDesc(fys: Iterable<string>): string[] {
  return [...new Set(fys)].sort((a, b) => b.localeCompare(a));
}

// ---------------------------------------------------------------------------
// Development sectors
// ---------------------------------------------------------------------------

/**
 * Sectors that match VE's work. VE's work is Schedule VII item (ii): education, including special
 * education, and livelihoods for the differently abled. The portal's sector names vary a little
 * between years, so these match on words rather than exact names.
 */
export const CAUSE_WORDS = ["education", "vocational", "skill", "livelihood", "incubator", "differently abled", "disab", "digital"];
export const DISABILITY_WORDS = ["differently abled", "disab", "special education", "divyang"];

const has = (name: string, words: string[]) => {
  const n = name.toLowerCase();
  return words.some((w) => n.includes(w));
};

export const isCauseSector = (name: string) => has(name, CAUSE_WORDS);
export const isDisabilitySector = (name: string) => has(name, DISABILITY_WORDS);

// ---------------------------------------------------------------------------
// Reading a CSR Portal export
// ---------------------------------------------------------------------------

export const AMOUNT_UNITS = ["auto", "crore", "lakh", "rupees"] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];
const UNIT_RUPEES: Record<Exclude<AmountUnit, "auto">, number> = { crore: 10_000_000, lakh: 100_000, rupees: 1 };

/** One line of CSR spend: a company, a year, an amount, and where and on what it was spent when known. */
export type CsrRecord = {
  cin: string | null;
  name: string;
  fy: string;
  spent: number;
  prescribed: number | null;
  sector: string | null;
  state: string | null;
  project: string | null;
};

export type CsrReadResult = {
  records: CsrRecord[];
  unit: Exclude<AmountUnit, "auto">;
  columns: Partial<Record<Column, string>>;
  errors: { row: number; message: string }[];
  rowsRead: number;
};

type Column = "cin" | "name" | "fy" | "spent" | "prescribed" | "sector" | "state" | "project";

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Which column holds what, worked out from the header names so small changes in the export don't break it. */
function findColumns(header: string[]): Partial<Record<Column, number>> {
  const cols: Partial<Record<Column, number>> = {};
  header.forEach((raw, i) => {
    const h = flat(raw);
    const set = (c: Column) => {
      if (cols[c] === undefined) cols[c] = i;
    };
    if (!h) return;
    if (h === "cin" || h.includes("corporateidentification") || h === "companycin") set("cin");
    else if (h.includes("prescribed") || h.includes("obligation")) set("prescribed");
    else if ((h.includes("spent") || h.includes("expenditure")) && !h.includes("unspent")) set("spent");
    else if (h.includes("financialyear") || h === "fy" || h === "year") set("fy");
    else if (h.includes("sector") || h.includes("thematic")) set("sector");
    else if (h.includes("state")) set("state");
    else if (h.includes("project")) set("project");
    else if (h === "company" || h.includes("companyname") || h.includes("nameofthecompany") || h === "name") set("name");
  });
  return cols;
}

function detectUnit(spentHeader: string): Exclude<AmountUnit, "auto"> {
  const h = spentHeader.toLowerCase();
  if (/\bcr\b|crore|\bcr\.|inr cr/.test(h)) return "crore";
  if (/lakh|\blac\b|lacs/.test(h)) return "lakh";
  return "rupees";
}

function parseAmount(raw: string, unit: Exclude<AmountUnit, "auto">): number | null {
  const s = raw.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * UNIT_RUPEES[unit]);
}

/**
 * Reads a CSV saved from the National CSR Portal (or any sheet with the same columns). Each row is
 * one line of spend: a project, or a company's spend in one sector or state. Rows that can't be read
 * are reported with their row number rather than stopping the whole import.
 */
export function readCsrCsv(text: string, unitChoice: AmountUnit = "auto"): CsrReadResult {
  const rows = parseCsv(text);
  // Exports sometimes start with a title row or two; the header is the first row naming the company.
  const headerAt = rows.slice(0, 10).findIndex((r) => {
    const c = findColumns(r);
    return c.name !== undefined && c.spent !== undefined;
  });
  if (headerAt === -1) {
    return {
      records: [],
      unit: "rupees",
      columns: {},
      errors: [{ row: 1, message: "Couldn't find the header row. It needs at least a company name column and an amount spent column." }],
      rowsRead: 0,
    };
  }
  const header = rows[headerAt]!;
  const idx = findColumns(header);
  const columns = Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, header[i!]!.trim()])) as CsrReadResult["columns"];
  const unit = unitChoice === "auto" ? detectUnit(columns.spent ?? "") : unitChoice;
  const prescribedUnit = unitChoice === "auto" && columns.prescribed ? detectUnit(columns.prescribed) : unit;

  const records: CsrRecord[] = [];
  const errors: CsrReadResult["errors"] = [];
  const cell = (r: string[], c: Column) => (idx[c] === undefined ? "" : (r[idx[c]!] ?? "").trim());
  const body = rows.slice(headerAt + 1);

  body.forEach((r, i) => {
    const rowNumber = headerAt + i + 2; // as a spreadsheet would number it
    const name = cell(r, "name").replace(/\s+/g, " ");
    if (!name) return errors.push({ row: rowNumber, message: "No company name" });
    const fy = idx.fy === undefined ? null : normaliseFy(cell(r, "fy"));
    if (!fy) return errors.push({ row: rowNumber, message: `Couldn't read the financial year "${cell(r, "fy")}"` });
    const spent = parseAmount(cell(r, "spent"), unit);
    if (spent === null) return errors.push({ row: rowNumber, message: `Couldn't read the amount spent "${cell(r, "spent")}"` });
    const cin = cell(r, "cin").toUpperCase();
    const sector = cell(r, "sector");
    const state = cell(r, "state");
    records.push({
      cin: cin || null,
      name,
      fy,
      spent,
      prescribed: parseAmount(cell(r, "prescribed"), prescribedUnit),
      sector: sector || null,
      state: state ? normaliseState(state) : null,
      project: cell(r, "project") || null,
    });
  });

  return { records, unit, columns, errors, rowsRead: body.length };
}

// ---------------------------------------------------------------------------
// Grouping lines into companies and years
// ---------------------------------------------------------------------------

export type CsrYear = {
  fy: string;
  spent: number;
  prescribed: number | null;
  /** Distinct projects when the export names them, otherwise lines of spend. */
  projectCount: number;
  sectors: Map<string, number>;
  states: Map<string, number>;
};

export type CsrCompany = { key: string; cin: string | null; name: string; years: Map<string, CsrYear> };

/** Companies are matched on CIN when the export has one, otherwise on their name. */
export function companyKey(cin: string | null, name: string): string {
  return isValidCin(cin) ? cin : `name:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export function groupCsrRecords(records: CsrRecord[]): CsrCompany[] {
  const companies = new Map<string, CsrCompany & { projects: Map<string, Set<string>> }>();
  for (const r of records) {
    const key = companyKey(r.cin, r.name);
    let c = companies.get(key);
    if (!c) {
      c = { key, cin: isValidCin(r.cin) ? r.cin : null, name: r.name, years: new Map(), projects: new Map() };
      companies.set(key, c);
    }
    let y = c.years.get(r.fy);
    if (!y) {
      y = { fy: r.fy, spent: 0, prescribed: null, projectCount: 0, sectors: new Map(), states: new Map() };
      c.years.set(r.fy, y);
      c.projects.set(r.fy, new Set());
    }
    y.spent += r.spent;
    // The obligation is repeated on every line for the year, so it's the same figure, not a sum.
    if (r.prescribed !== null) y.prescribed = Math.max(y.prescribed ?? 0, r.prescribed);
    if (r.sector) y.sectors.set(r.sector, (y.sectors.get(r.sector) ?? 0) + r.spent);
    if (r.state) y.states.set(r.state, (y.states.get(r.state) ?? 0) + r.spent);
    if (r.spent > 0) {
      const projects = c.projects.get(r.fy)!;
      projects.add(r.project ?? `line-${projects.size}`);
      y.projectCount = projects.size;
    }
  }
  return [...companies.values()].map(({ projects: _p, ...c }) => c);
}

// ---------------------------------------------------------------------------
// Settings the team can change
// ---------------------------------------------------------------------------

export const FIT_PARTS = ["cause", "peer", "ticket", "geography", "warmPath", "timing"] as const;
export type FitPart = (typeof FIT_PARTS)[number];

export const FIT_PART_LABELS: Record<FitPart, { name: string; description: string }> = {
  cause: { name: "Cause", description: "Share of CSR spend on education, skills and disability" },
  peer: { name: "Peer NGOs", description: "Funds NGOs like VE" },
  ticket: { name: "Grant size", description: "Likely grant to one NGO" },
  geography: { name: "Geography", description: "Spend in the states where VE works" },
  warmPath: { name: "Warm path", description: "Someone at VE has a way in" },
  timing: { name: "Timing", description: "Spend growing, or money left unspent" },
};

export type FitWeights = Record<FitPart, number>;

export type FitSettings = {
  weights: FitWeights;
  /** VE ignores funders whose likely grant is below this, in rupees. */
  floorRupees: number;
  veStates: string[];
  peerNgos: string[];
};

/** The PRD's starting weights. They add up to 100. */
export const DEFAULT_FIT_WEIGHTS: FitWeights = { cause: 30, peer: 20, ticket: 15, geography: 15, warmPath: 10, timing: 10 };

export const DEFAULT_FIT_SETTINGS: FitSettings = {
  weights: DEFAULT_FIT_WEIGHTS,
  floorRupees: 500_000,
  // VE's regional teams, from the knowledge base. VE works in 17 states; admins tick the rest in Settings.
  veStates: ["Karnataka", "Kerala", "Odisha", "Tamil Nadu", "West Bengal"],
  // Disability and inclusive-education NGOs whose CSR funders are likely to fund VE too. Editable in Settings.
  peerNgos: [
    "National Association for the Blind",
    "Saksham",
    "Enable India",
    "Mitra Jyothi",
    "Samarthanam",
    "Blind People's Association",
    "Xavier's Resource Centre for the Visually Challenged",
    "Score Foundation",
    "Sightsavers",
    "Vision Aid",
    "Amar Jyoti",
    "Youth4Jobs",
    "Sense International India",
  ],
};

/** Problems with settings someone entered, or an empty list. */
export function fitSettingsProblems(s: FitSettings): string[] {
  const problems: string[] = [];
  const parts = FIT_PARTS.map((p) => s.weights[p]);
  if (parts.some((w) => !Number.isInteger(w) || w < 0)) problems.push("Each weight must be a whole number, 0 or more.");
  const total = parts.reduce((a, b) => a + b, 0);
  if (total !== 100) problems.push(`The weights must add up to 100. They add up to ${total}.`);
  if (!Number.isInteger(s.floorRupees) || s.floorRupees < 0) problems.push("The floor must be an amount in rupees.");
  if (s.veStates.some((st) => !(INDIAN_STATES as readonly string[]).includes(st))) problems.push("Choose states from the list.");
  return problems;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export const ELIGIBILITY = ["eligible", "needs_check", "not_eligible"] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];
/** A fit score at or above this counts as a high-fit lead (highlighted, and listed in the weekly digest). */
export const HIGH_FIT_SCORE = 70;

export const ELIGIBILITY_LABELS: Record<Eligibility, string> = {
  eligible: "Eligible",
  needs_check: "Needs check",
  not_eligible: "Not eligible",
};

export type CompanyFacts = {
  cin: string | null;
  isForeign: boolean;
  /** One entry per financial year the portal has for this company. */
  years: { fy: string; spent: number; prescribed: number | null }[];
};

/**
 * VE can take money only from Indian entities, and a company only gives CSR if s.135 applies to it.
 * Reporting CSR on the portal in both of the two most recent years counts as proof that it does.
 * `recentFys` are the two latest years in the data overall, newest first.
 */
export function companyEligibility(
  c: CompanyFacts,
  recentFys: string[],
  floorRupees: number,
): { verdict: Eligibility; reasons: string[] } {
  if (c.isForeign) {
    return { verdict: "not_eligible", reasons: ["Foreign entity. Without FCRA, VE can only accept money from an Indian company."] };
  }
  const byFy = new Map(c.years.map((y) => [y.fy, y]));
  const latest = sortFysDesc(byFy.keys())[0];
  const latestYear = latest ? byFy.get(latest)! : null;
  if (latestYear && latestYear.spent < floorRupees) {
    return {
      verdict: "not_eligible",
      reasons: [`Spent ${formatInrShort(latestYear.spent) || "₹0"} on CSR in ${fyLabel(latestYear.fy)}, below VE's ${formatInrShort(floorRupees)} floor.`],
    };
  }
  if (!isValidCin(c.cin)) {
    return { verdict: "needs_check", reasons: ["No valid CIN, so the Indian entity and whether s.135 applies need checking."] };
  }
  const reported = recentFys.filter((fy) => {
    const y = byFy.get(fy);
    return y && (y.spent > 0 || (y.prescribed ?? 0) > 0);
  });
  if (recentFys.length >= 2 && reported.length >= 2) {
    return {
      verdict: "eligible",
      reasons: [`Reported CSR on the National CSR Portal for ${reported.map(fyLabel).reverse().join(" and ")}, so s.135 applies.`],
    };
  }
  if (reported.length === 1) {
    return { verdict: "needs_check", reasons: [`Reported CSR for ${fyLabel(reported[0]!)} only. Check s.135 thresholds from its accounts.`] };
  }
  return {
    verdict: "needs_check",
    reasons: [latest ? `No CSR reported since ${fyLabel(latest)}. Check whether s.135 still applies.` : "No CSR data yet."],
  };
}

// ---------------------------------------------------------------------------
// Grant size
// ---------------------------------------------------------------------------

export type TicketEstimate = { amount: number | null; basis: string };

/**
 * The likely grant to one NGO. Disclosed grant amounts win when there are any; otherwise the latest
 * year's spend divided by the number of projects it was spread over.
 */
export function estimateTicket(
  latest: { fy: string; spent: number; projectCount: number } | null,
  grantAmounts: number[],
): TicketEstimate {
  const known = grantAmounts.filter((a) => a > 0).sort((a, b) => a - b);
  if (known.length) {
    const mid = Math.floor(known.length / 2);
    const median = known.length % 2 ? known[mid]! : Math.round((known[mid - 1]! + known[mid]!) / 2);
    return { amount: median, basis: `Middle of ${known.length} disclosed ${known.length === 1 ? "grant" : "grants"}` };
  }
  if (latest && latest.spent > 0 && latest.projectCount > 0) {
    const each = Math.round(latest.spent / latest.projectCount);
    return {
      amount: each,
      basis:
        latest.projectCount === 1
          ? `All ${formatInrShort(latest.spent)} of ${fyLabel(latest.fy)} spend went to one project`
          : `${formatInrShort(latest.spent)} spread over ${latest.projectCount} projects in ${fyLabel(latest.fy)}`,
    };
  }
  return { amount: null, basis: "Not enough data to estimate" };
}

// ---------------------------------------------------------------------------
// Fit score
// ---------------------------------------------------------------------------

export type FitInput = {
  /** Spend by sector and by state, summed over the company's last three reported years. */
  sectorSpend: Map<string, number>;
  stateSpend: Map<string, number>;
  /** Newest first, at least the last two years when known. */
  years: { fy: string; spent: number; prescribed: number | null }[];
  hqState: string | null;
  grantees: string[];
  ticket: number | null;
  warmPath: boolean;
  /** What the company's newest annual report says, when the portal has read one. */
  report?: AnnualReportFacts | null;
};

/** From a company's own annual report: the year's CSR obligation and whether it describes work on disability. */
export type AnnualReportFacts = { fy: string; obligation: number | null; disabilityWork: boolean };

export type FitPartResult = { part: FitPart; weight: number; points: number; reason: string };
export type FitResult = { score: number; parts: FitPartResult[]; summary: string };

const sum = (m: Map<string, number>, keep: (k: string) => boolean = () => true) =>
  [...m].filter(([k]) => keep(k)).reduce((a, [, v]) => a + v, 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const listNames = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`);

/** Peer NGOs a funder's grantee list names, matched on whole words so "NAB" doesn't match "NABARD". */
export function matchPeers(grantees: string[], peers: string[]): string[] {
  return peers.filter((p) => {
    const pw = words(p);
    return pw.trim() !== "" && grantees.some((g) => words(g).includes(pw));
  });
}

function scorePart(part: FitPart, input: FitInput, s: FitSettings): { fraction: number; reason: string } {
  switch (part) {
    case "cause": {
      const total = sum(input.sectorSpend);
      // An annual report that describes work on disability counts as disability spend, since the portal's data is a year or more behind.
      const reported = input.report?.disabilityWork ? `its ${fyLabel(input.report.fy)} annual report describes work on disability` : null;
      if (total === 0) return reported ? { fraction: 0.4, reason: `No sector breakdown yet, but ${reported}` } : { fraction: 0, reason: "No sector breakdown yet" };
      const cause = sum(input.sectorSpend, isCauseSector);
      const disability = sum(input.sectorSpend, isDisabilitySector);
      const fraction = 0.6 * clamp01(cause / total / 0.5) + 0.4 * (disability > 0 || reported ? 1 : 0);
      if (cause === 0) {
        return reported ? { fraction, reason: `No spend on education or skills, but ${reported}` } : { fraction: 0, reason: "No spend on education, skills or disability" };
      }
      return {
        fraction,
        reason:
          `${pct(cause / total)} of CSR spend on education and skills` +
          (disability > 0 ? `, ${formatInrShort(disability)} on disability` : reported ? `, and ${reported}` : ", none on disability"),
      };
    }
    case "peer": {
      if (!input.grantees.length) return { fraction: 0, reason: "No list of NGOs it funds yet" };
      const peers = matchPeers(input.grantees, s.peerNgos);
      return peers.length
        ? { fraction: clamp01(peers.length / 2), reason: `Funds ${listNames(peers)}` }
        : { fraction: 0, reason: "None of the NGOs it funds are on VE's peer list" };
    }
    case "ticket": {
      if (input.ticket === null) return { fraction: 0, reason: "Grant size unknown" };
      return { fraction: clamp01(input.ticket / (s.floorRupees * 10)), reason: `Likely grant about ${formatInrShort(input.ticket)}` };
    }
    case "geography": {
      const total = sum(input.stateSpend);
      const ve = new Set(s.veStates);
      if (total > 0) {
        const inVe = sum(input.stateSpend, (k) => ve.has(k));
        const pan = input.stateSpend.get(PAN_INDIA) ?? 0;
        const fraction = clamp01((inVe + 0.5 * pan) / total / 0.5);
        if (inVe === 0) return { fraction, reason: pan > 0 ? `${pct(pan / total)} spent Pan India, none in VE states` : "No spend in VE states" };
        const top = [...input.stateSpend].filter(([k]) => ve.has(k)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
        return { fraction, reason: `${pct(inVe / total)} of spend in VE states (${listNames(top)})` };
      }
      if (input.hqState && ve.has(input.hqState)) return { fraction: 0.5, reason: `Registered in ${input.hqState}, a VE state` };
      return { fraction: 0, reason: "No spend in VE states recorded" };
    }
    case "warmPath":
      return input.warmPath ? { fraction: 1, reason: "Someone at VE has a way in" } : { fraction: 0, reason: "No warm path recorded yet" };
    case "timing": {
      const [latest, previous] = input.years;
      const signals: string[] = [];
      if (latest && previous && previous.spent > 0 && latest.spent >= previous.spent * 1.1) {
        signals.push(`spend up ${pct(latest.spent / previous.spent - 1)} in ${fyLabel(latest.fy)}`);
      }
      if (latest && latest.prescribed !== null && latest.prescribed > latest.spent) {
        signals.push(`${formatInrShort(latest.prescribed - latest.spent)} left unspent in ${fyLabel(latest.fy)}`);
      }
      // A newer year's obligation from the annual report says whether there's more to give this year.
      const r = input.report;
      if (r && r.obligation !== null && latest && r.fy > latest.fy && latest.spent > 0 && r.obligation >= latest.spent * 1.1) {
        signals.push(`${fyLabel(r.fy)} CSR budget of ${formatInrShort(r.obligation)} is ${pct(r.obligation / latest.spent - 1)} above ${fyLabel(latest.fy)} spend, per its annual report`);
      }
      if (!signals.length) return { fraction: 0, reason: "No timing signals" };
      const text = signals.join(", ");
      return { fraction: clamp01(signals.length * 0.5), reason: text[0]!.toUpperCase() + text.slice(1) };
    }
  }
}

/** A 0 to 100 score in six parts. Each part's points are whole numbers and add up to the score. */
export function fitScore(input: FitInput, s: FitSettings): FitResult {
  const parts = FIT_PARTS.map((part) => {
    const { fraction, reason } = scorePart(part, input, s);
    return { part, weight: s.weights[part], points: Math.round(s.weights[part] * fraction), reason };
  });
  const score = parts.reduce((a, p) => a + p.points, 0);
  const strongest = parts.filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 2);
  const summary = strongest.length ? `${strongest.map((p) => p.reason).join(". ")}.` : "Little evidence of fit yet.";
  return { score, parts, summary };
}

/** Everything the CSR engine works out for one company, from its portal data and what VE has added. */
export function assessCompany(
  facts: CompanyFacts & {
    years: { fy: string; spent: number; prescribed: number | null; projectCount: number; sectors: Map<string, number>; states: Map<string, number> }[];
    grantees: { name: string; amount: number | null }[];
    warmPath: boolean;
    report?: AnnualReportFacts | null;
  },
  recentFys: string[],
  settings: FitSettings,
) {
  const years = [...facts.years].sort((a, b) => b.fy.localeCompare(a.fy));
  const lastThree = years.slice(0, 3);
  const merge = (pick: (y: (typeof years)[number]) => Map<string, number>) => {
    const m = new Map<string, number>();
    for (const y of lastThree) for (const [k, v] of pick(y)) m.set(k, (m.get(k) ?? 0) + v);
    return m;
  };
  const latest = years[0] ?? null;
  const eligibility = companyEligibility(facts, recentFys, settings.floorRupees);
  const ticket = estimateTicket(latest, facts.grantees.map((g) => g.amount ?? 0));
  const fit = fitScore(
    {
      sectorSpend: merge((y) => y.sectors),
      stateSpend: merge((y) => y.states),
      years,
      hqState: cinState(facts.cin),
      grantees: facts.grantees.map((g) => g.name),
      ticket: ticket.amount,
      warmPath: facts.warmPath,
      report: facts.report ?? null,
    },
    settings,
  );
  return { eligibility, ticket, fit, latest };
}
