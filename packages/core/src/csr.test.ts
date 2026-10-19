import { describe, expect, it } from "vitest";
import {
  assessCompany,
  companyEligibility,
  DEFAULT_FIT_SETTINGS,
  estimateTicket,
  type FitInput,
  fitScore,
  fitSettingsProblems,
  groupCsrRecords,
  matchPeers,
  normaliseFy,
  readCsrCsv,
} from "./csr";
import { parseCsv } from "./csv";
import { cinState, isValidCin, normaliseState } from "./india";

const CIN_KA = "U32109KA2010PTC012345";
const CIN_TN = "L34300TN1985PLC011111";

describe("CSV", () => {
  it("handles quotes, doubled quotes, commas and line breaks in fields, CRLF and a BOM", () => {
    const text = '﻿Name,Note\r\n"Acme, Ltd","said ""hi""\nthen left"\r\nPlain,x\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Note"],
      ["Acme, Ltd", 'said "hi"\nthen left'],
      ["Plain", "x"],
    ]);
  });
});

describe("India", () => {
  it("checks CINs and reads the state from them", () => {
    expect(isValidCin(CIN_KA)).toBe(true);
    expect(isValidCin("U32109KA2010PTC01234")).toBe(false);
    expect(isValidCin("F12345")).toBe(false);
    expect(cinState(CIN_KA)).toBe("Karnataka");
    expect(cinState("U74999OR2001PTC006543")).toBe("Odisha");
  });
  it("normalises state names", () => {
    expect(normaliseState("ORISSA")).toBe("Odisha");
    expect(normaliseState("tamil nadu")).toBe("Tamil Nadu");
    expect(normaliseState("PAN INDIA")).toBe("Pan India");
    expect(normaliseState("Jammu & Kashmir")).toBe("Jammu and Kashmir");
    expect(normaliseState("Atlantis")).toBe("Atlantis");
  });
});

describe("financial years", () => {
  it("reads the common ways of writing a year", () => {
    expect(normaliseFy("2023-24")).toBe("2023-24");
    expect(normaliseFy("FY 2023-2024")).toBe("2023-24");
    expect(normaliseFy("2023/24")).toBe("2023-24");
    expect(normaliseFy("1999-00")).toBe("1999-00");
    expect(normaliseFy("2023-25")).toBeNull();
    expect(normaliseFy("last year")).toBeNull();
  });
});

describe("reading a CSR Portal export", () => {
  const csv = [
    "National CSR Portal - Company wise CSR spent",
    "CIN,Company Name,Financial Year,Prescribed CSR Expenditure (INR Cr.),Amount Spent (INR Cr.),Development Sector,State,Project Name",
    `${CIN_KA},Deccan Semi,2023-24,2.0,1.5,Education,Karnataka,STEM labs`,
    `${CIN_KA},Deccan Semi,2023-24,2.0,0.25,Differently Abled,PAN INDIA,Assistive devices`,
    `${CIN_KA},Deccan Semi,2022-23,1.5,1.2,Health Care,Maharashtra,Clinic`,
    `,No CIN Co,2023-24,,0.10,Education,Kerala,`,
    `${CIN_TN},Bad Year Co,next year,,1,Education,Kerala,`,
    `${CIN_TN},Bad Amount Co,2023-24,,lots,Education,Kerala,`,
  ].join("\n");

  it("finds the header below a title row, detects crore and reads each line", () => {
    const r = readCsrCsv(csv);
    expect(r.unit).toBe("crore");
    expect(r.columns.spent).toBe("Amount Spent (INR Cr.)");
    expect(r.rowsRead).toBe(6);
    expect(r.records).toHaveLength(4);
    expect(r.records[0]).toEqual({
      cin: CIN_KA,
      name: "Deccan Semi",
      fy: "2023-24",
      spent: 15_000_000,
      prescribed: 20_000_000,
      sector: "Education",
      state: "Karnataka",
      project: "STEM labs",
    });
    expect(r.records[1]!.state).toBe("Pan India");
    expect(r.errors.map((e) => e.row)).toEqual([7, 8]);
  });

  it("lets the person say which unit amounts are in", () => {
    expect(readCsrCsv(csv, "lakh").records[0]!.spent).toBe(150_000);
  });

  it("reports a file without the columns it needs", () => {
    expect(readCsrCsv("a,b\n1,2").errors[0]!.message).toMatch(/header row/);
  });

  it("groups lines into companies and years without adding up the repeated obligation", () => {
    const companies = groupCsrRecords(readCsrCsv(csv).records);
    expect(companies.map((c) => c.name)).toEqual(["Deccan Semi", "No CIN Co"]);
    const y = companies[0]!.years.get("2023-24")!;
    expect(y.spent).toBe(17_500_000);
    expect(y.prescribed).toBe(20_000_000);
    expect(y.projectCount).toBe(2);
    expect(y.sectors.get("Differently Abled")).toBe(2_500_000);
    expect(companies[1]!.key).toBe("name:no cin co");
  });
});

describe("eligibility", () => {
  const recent = ["2023-24", "2022-23"];
  const years = [
    { fy: "2023-24", spent: 15_000_000, prescribed: 20_000_000 },
    { fy: "2022-23", spent: 12_000_000, prescribed: null },
  ];
  it("is eligible with a CIN and CSR reported in both recent years", () => {
    const r = companyEligibility({ cin: CIN_KA, isForeign: false, years }, recent, 500_000);
    expect(r.verdict).toBe("eligible");
    expect(r.reasons[0]).toBe("Reported CSR on the National CSR Portal for FY 2022-23 and FY 2023-24, so s.135 applies.");
  });
  it("needs a check with one recent year, no CIN, or nothing recent", () => {
    expect(companyEligibility({ cin: CIN_KA, isForeign: false, years: years.slice(0, 1) }, recent, 500_000).verdict).toBe("needs_check");
    expect(companyEligibility({ cin: null, isForeign: false, years }, recent, 500_000).verdict).toBe("needs_check");
    const old = companyEligibility({ cin: CIN_KA, isForeign: false, years: [{ fy: "2019-20", spent: 9_000_000, prescribed: null }] }, recent, 500_000);
    expect(old.reasons[0]).toMatch(/No CSR reported since FY 2019-20/);
  });
  it("is not eligible when foreign or when total spend is below the floor", () => {
    expect(companyEligibility({ cin: CIN_KA, isForeign: true, years }, recent, 500_000).verdict).toBe("not_eligible");
    const small = companyEligibility({ cin: CIN_KA, isForeign: false, years: [{ fy: "2023-24", spent: 300_000, prescribed: null }] }, recent, 500_000);
    expect(small.verdict).toBe("not_eligible");
    expect(small.reasons[0]).toBe("Spent ₹3 L on CSR in FY 2023-24, below VE's ₹5 L floor.");
  });
});

describe("grant size", () => {
  it("prefers disclosed grants, then spend per project", () => {
    expect(estimateTicket({ fy: "2023-24", spent: 10_000_000, projectCount: 4 }, [3_000_000, 1_000_000, 2_000_000])).toEqual({
      amount: 2_000_000,
      basis: "Middle of 3 disclosed grants",
    });
    expect(estimateTicket({ fy: "2023-24", spent: 10_000_000, projectCount: 4 }, [])).toEqual({
      amount: 2_500_000,
      basis: "₹1 Cr spread over 4 projects in FY 2023-24",
    });
    expect(estimateTicket(null, []).amount).toBeNull();
  });
});

describe("fit score", () => {
  const base: FitInput = {
    sectorSpend: new Map([
      ["Education", 6_000_000],
      ["Differently Abled", 1_000_000],
      ["Health Care", 3_000_000],
    ]),
    stateSpend: new Map([
      ["Karnataka", 5_000_000],
      ["Pan India", 2_000_000],
      ["Maharashtra", 3_000_000],
    ]),
    years: [
      { fy: "2023-24", spent: 10_000_000, prescribed: 12_000_000 },
      { fy: "2022-23", spent: 8_000_000, prescribed: null },
    ],
    hqState: "Karnataka",
    grantees: ["Saksham Trust", "NABARD Foundation"],
    ticket: 2_500_000,
    warmPath: false,
  };

  it("adds up six parts, each with its reason", () => {
    const r = fitScore(base, DEFAULT_FIT_SETTINGS);
    const byPart = Object.fromEntries(r.parts.map((p) => [p.part, p]));
    expect(byPart.cause!.points).toBe(30); // 70% on cause sectors and some disability spend
    expect(byPart.cause!.reason).toBe("70% of CSR spend on education and skills, ₹10 L on disability");
    expect(byPart.peer!.points).toBe(10); // Saksham matches; NAB isn't a peer and "NABARD" wouldn't match it anyway
    expect(byPart.ticket!.points).toBe(8); // ₹25 L of a ₹50 L full mark
    expect(byPart.geography!.points).toBe(15); // 50% in Karnataka plus Pan India
    expect(byPart.warmPath!.points).toBe(0);
    expect(byPart.timing!.points).toBe(10);
    expect(byPart.timing!.reason).toBe("Spend up 25% in FY 2023-24, ₹20 L left unspent in FY 2023-24");
    expect(r.score).toBe(r.parts.reduce((a, p) => a + p.points, 0));
    expect(r.score).toBe(73);
    expect(r.summary).toBe("70% of CSR spend on education and skills, ₹10 L on disability. 50% of spend in VE states (Karnataka).");
  });

  it("follows the weights in settings", () => {
    const weights = { cause: 100, peer: 0, ticket: 0, geography: 0, warmPath: 0, timing: 0 };
    expect(fitScore(base, { ...DEFAULT_FIT_SETTINGS, weights }).score).toBe(100);
  });

  it("gives nothing for parts with no data, and says so", () => {
    const r = fitScore(
      { sectorSpend: new Map(), stateSpend: new Map(), years: [], hqState: null, grantees: [], ticket: null, warmPath: false },
      DEFAULT_FIT_SETTINGS,
    );
    expect(r.score).toBe(0);
    expect(r.summary).toBe("Little evidence of fit yet.");
    expect(r.parts.find((p) => p.part === "cause")!.reason).toBe("No sector breakdown yet");
  });

  it("counts an annual report's disability work and newer budget", () => {
    const report = { fy: "2024-25", obligation: 13_000_000, disabilityWork: true };
    const noDisability = { ...base, sectorSpend: new Map([["Education", 6_000_000], ["Health Care", 4_000_000]]) };
    const parts = (input: FitInput) => Object.fromEntries(fitScore(input, DEFAULT_FIT_SETTINGS).parts.map((p) => [p.part, p]));
    expect(parts(noDisability).cause!.points).toBe(18);
    const withReport = parts({ ...noDisability, report });
    expect(withReport.cause!.points).toBe(30);
    expect(withReport.cause!.reason).toBe("60% of CSR spend on education and skills, and its FY 2024-25 annual report describes work on disability");
    expect(parts({ ...base, sectorSpend: new Map(), report }).cause!.reason).toBe(
      "No sector breakdown yet, but its FY 2024-25 annual report describes work on disability",
    );
    expect(parts({ ...base, sectorSpend: new Map(), report }).cause!.points).toBe(12);
    // ₹1.3 Cr for 2024-25 against ₹1 Cr spent in 2023-24.
    expect(withReport.timing!.reason).toBe(
      "Spend up 25% in FY 2023-24, ₹20 L left unspent in FY 2023-24, FY 2024-25 CSR budget of ₹1.3 Cr is 30% above FY 2023-24 spend, per its annual report",
    );
    expect(withReport.timing!.points).toBe(10);
    // A report for a year the portal already has, or a smaller budget, isn't a timing signal.
    expect(parts({ ...base, report: { ...report, fy: "2023-24" } }).timing!.reason).not.toMatch(/annual report/);
    expect(parts({ ...base, report: { ...report, obligation: 10_500_000 } }).timing!.reason).not.toMatch(/annual report/);
  });

  it("matches peers on whole words", () => {
    expect(matchPeers(["NABARD"], ["NAB"])).toEqual([]);
    expect(matchPeers(["The NAB Karnataka branch"], ["NAB"])).toEqual(["NAB"]);
  });

  it("checks settings", () => {
    expect(fitSettingsProblems(DEFAULT_FIT_SETTINGS)).toEqual([]);
    const bad = { ...DEFAULT_FIT_SETTINGS, weights: { ...DEFAULT_FIT_SETTINGS.weights, cause: 40 }, veStates: ["Atlantis"] };
    expect(fitSettingsProblems(bad)).toEqual(["The weights must add up to 100. They add up to 110.", "Choose states from the list."]);
  });

  it("assesses a company end to end", () => {
    const [c] = groupCsrRecords(
      readCsrCsv(
        [
          "CIN,Company Name,Financial Year,Amount Spent (INR Cr.),Development Sector,State",
          `${CIN_KA},Deccan Semi,2023-24,1.0,Education,Karnataka`,
          `${CIN_KA},Deccan Semi,2022-23,0.8,Education,Karnataka`,
        ].join("\n"),
      ).records,
    );
    const r = assessCompany(
      { cin: c!.cin, isForeign: false, years: [...c!.years.values()], grantees: [], warmPath: true },
      ["2023-24", "2022-23"],
      DEFAULT_FIT_SETTINGS,
    );
    expect(r.eligibility.verdict).toBe("eligible");
    expect(r.ticket.amount).toBe(10_000_000);
    expect(r.latest!.fy).toBe("2023-24");
    expect(r.fit.parts.find((p) => p.part === "warmPath")!.points).toBe(10);
  });
});
