import { describe, expect, it } from "vitest";
import {
  checkAnnualReport,
  companiesToFollow,
  companyCheckDue,
  companyReportLabel,
  type CsrPartner,
  csrPagesToRead,
  dueReportFy,
  MAX_CSR_PAGES,
  pageRanges,
  partnersToAdd,
  reportLinkFromReply,
} from "./company-reports";

const LISTED = "L85110KA1981PLC013115";
const UNLISTED = "U72200KA2001PTC029212";

describe("which companies, and when", () => {
  it("knows which year's reports are due", () => {
    expect(dueReportFy(new Date("2026-10-19"))).toBe("2025-26");
    expect(dueReportFy(new Date("2026-04-01"))).toBe("2025-26");
    expect(dueReportFy(new Date("2026-03-31"))).toBe("2024-25");
    expect(dueReportFy(new Date("2027-01-15"))).toBe("2025-26");
  });

  it("follows Indian companies with a CIN that aren't ruled out, best fit first", () => {
    const f = (id: string, cin: string | null, fitScore: number | null, more = {}) => ({
      id,
      name: id,
      cin,
      fitScore,
      isForeign: false,
      eligibility: "eligible" as const,
      ...more,
    });
    const picked = companiesToFollow(
      [
        f("Low", LISTED, 20),
        f("Unlisted", UNLISTED, 90),
        f("No CIN", null, 90),
        f("Foreign", LISTED, 90, { isForeign: true }),
        f("Ruled out", LISTED, 90, { eligibility: "not_eligible" }),
        f("Unscored", LISTED, null),
        f("High", LISTED, 80),
        f("Check", LISTED, 50, { eligibility: "needs_check" }),
      ],
      3,
    );
    expect(picked.map((p) => p.id)).toEqual(["Unlisted", "High", "Check"]);
  });

  it("looks monthly until the due year's report is in", () => {
    const today = new Date("2026-10-19");
    const days = (n: number) => new Date(today.getTime() - n * 86_400_000);
    expect(companyCheckDue({ reportFys: [], checkedAt: null, checkRequestedAt: null }, today)).toBe(true);
    expect(companyCheckDue({ reportFys: ["2024-25"], checkedAt: days(10), checkRequestedAt: null }, today)).toBe(false);
    expect(companyCheckDue({ reportFys: ["2024-25"], checkedAt: days(31), checkRequestedAt: null }, today)).toBe(true);
    expect(companyCheckDue({ reportFys: ["2025-26"], checkedAt: days(200), checkRequestedAt: null }, today)).toBe(false);
    expect(companyCheckDue({ reportFys: ["2025-26"], checkedAt: days(1), checkRequestedAt: days(0) }, today)).toBe(true);
  });
});

describe("the finder's reply", () => {
  it("takes the link on the last PDF line", () => {
    expect(
      reportLinkFromReply(
        "I found it on the investor page.\nPDF: https://www.infosys.com/investors/reports-filings/annual-report/annual/documents/infosys-ar-26.pdf",
      ),
    ).toBe("https://www.infosys.com/investors/reports-filings/annual-report/annual/documents/infosys-ar-26.pdf");
    expect(reportLinkFromReply("PDF: https://a.example/old.pdf\nActually the newer one:\n**PDF:** <https://a.example/new.pdf>.")).toBe(
      "https://a.example/new.pdf",
    );
  });

  it("gives nothing for none, odd links and the stock exchanges' sites", () => {
    expect(reportLinkFromReply("PDF: none")).toBeNull();
    expect(reportLinkFromReply("It's at https://a.example/r.pdf")).toBeNull();
    expect(reportLinkFromReply("PDF: ftp://a.example/r.pdf")).toBeNull();
    expect(reportLinkFromReply("PDF: https://nsearchives.nseindia.com/annual_reports/AR_1.pdf")).toBeNull();
    expect(reportLinkFromReply("PDF: https://www.bseindia.com/bseplus/AnnualReport/500209/1.pdf")).toBeNull();
  });
});

describe("checking a PDF is the company's annual report", () => {
  it("wants the company's name and the words annual report", () => {
    expect(checkAnnualReport(["Infosys Integrated Annual Report 2025-26", "Contents"], "INFOSYS LIMITED")).toEqual({ ok: true, fy: "2025-26" });
    expect(checkAnnualReport(["TATA STEEL", "Integrated Report & Annual Accounts 2025-26"], "Tata Steel Limited")).toEqual({ ok: true, fy: "2025-26" });
    expect(checkAnnualReport(["Wipro Limited Annual Report 2024-25"], "Infosys Limited")).toEqual({
      ok: false,
      reason: "Its first pages don't name Infosys Limited.",
    });
    expect(checkAnnualReport(["Infosys Limited", "Investor presentation, Q4 FY26, revenue grew"], "Infosys Limited")).toEqual({
      ok: false,
      reason: "Its first pages don't say it's an annual report.",
    });
  });

  it("finds the name past an image cover, and running headers that say annual report", () => {
    // As Mphasis's 2026 report is laid out: an image cover, a brand page, then the chairman's letter.
    const letter = (n: number) => `ANNUAL REPORT • 2026 ${n} The quarter's results and our clients.`;
    const pages = [
      "",
      "Mphasis. Powering the next-generation enterprise.",
      "Dear Shareholder, this year Mphasis grew.",
      "Contents",
      "Our year",
      letter(6),
      letter(7),
    ];
    expect(checkAnnualReport(pages, "Mphasis Limited")).toEqual({ ok: true, fy: null });
    // A notice that mentions the annual report once, deep inside, isn't one.
    const notice = [
      "Mphasis Limited. Notice of the 34th Annual General Meeting.",
      "Resolutions",
      "Explanatory statement",
      "",
      "",
      "",
      "",
      "The Annual Report is on the website.",
    ];
    expect(checkAnnualReport(notice, "Mphasis Limited")).toEqual({ ok: false, reason: "Its first pages don't say it's an annual report." });
  });

  it("can't check a scanned report, so lets it through", () => {
    expect(checkAnnualReport(["", " "], "Infosys Limited")).toEqual({ ok: true, fy: null });
  });
});

describe("picking the CSR pages", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `Page ${i + 1}. Revenue, margins, risks and the board's report on operations.`);
  const annexure = [
    "Annexure IV. Annual Report on CSR Activities for the financial year 2025-26. 1. Brief outline on CSR Policy of the Company. 2. Composition of CSR Committee.",
    "5. (a) Average net profit of the company as per section 135(5): ₹ 34,120 crore. (b) Two percent of average net profit: ₹ 682 crore. (e) Total CSR obligation for the financial year: ₹ 682 crore.",
    "6. (a) Amount spent on CSR Projects (both Ongoing Project and other than Ongoing Project). Implementing agency: Akshaya Patra Foundation, CSR00000286. Amount transferred to Unspent CSR Account.",
  ];

  it("reads the annexure and the page after each of its pages", () => {
    const pages = [...filler(60), ...annexure, ...filler(40)];
    expect(csrPagesToRead(pages)).toEqual([61, 62, 63, 64]);
  });

  it("adds pages about disability projects and the CSR note in the accounts", () => {
    const pages = filler(120);
    pages[30] = "Corporate social responsibility. Our CSR projects with Samarthanam Trust for the Disabled give visually impaired students digital skills.";
    pages[100] =
      "Note 32. Corporate social responsibility (CSR) expenditure. Gross amount required to be spent by the company during the year: 4.2. Amount spent during the year on purposes other than construction.";
    expect(csrPagesToRead(pages)).toEqual([31, 32, 101, 102]);
  });

  it("leaves out pages that only mention CSR in passing", () => {
    const pages = filler(50);
    pages[5] = "The board's report covers risk management, corporate social responsibility and dividends.";
    expect(csrPagesToRead(pages)).toBeNull();
    expect(csrPagesToRead(["", "", ""])).toBeNull();
  });

  it("sends at most a few dozen pages", () => {
    const pages = Array.from({ length: 80 }, () => annexure[1]!);
    expect(csrPagesToRead(pages)).toHaveLength(MAX_CSR_PAGES);
  });
});

describe("partners read from a report", () => {
  const p = (name: string, more: Partial<CsrPartner> = {}): CsrPartner => ({ name, kind: "ngo", amountInr: null, registration: null, page: 64, ...more });
  const pageTexts = [
    `Implementing agencies: The Akshaya Patra Foundation (CSR00000286) ₹ 12.50 crore; Samarthanam Trust for the Disabled; Infosys Foundation; PM CARES Fund; Swades Foundation. ${"word ".repeat(120)}`,
  ];

  it("keeps NGOs the text names, and says why it leaves others out", () => {
    const r = partnersToAdd(
      [
        p("The Akshaya Patra Foundation", { amountInr: 125_000_000, registration: "csr00000286" }),
        p("Samarthanam Trust for the Disabled"),
        p("Infosys Foundation"),
        p("PM CARES Fund", { kind: "government" }),
        p("Smile Foundation"),
        p("Samarthanam Trust for the Disabled"),
        p("Infosys Limited"),
        p("Rotary Club of Bangalore", { kind: "other" }),
      ],
      { companyName: "INFOSYS LIMITED", pageTexts },
    );
    expect(r.add).toEqual([
      { name: "The Akshaya Patra Foundation", kind: "ngo", amountInr: 125_000_000, registration: "CSR00000286", page: 64 },
      { name: "Samarthanam Trust for the Disabled", kind: "ngo", amountInr: null, registration: null, page: 64 },
    ]);
    expect(r.leftOut).toEqual([
      { name: "Infosys Foundation", reason: "own_foundation" },
      { name: "PM CARES Fund", reason: "government" },
      { name: "Smile Foundation", reason: "unconfirmed" },
      { name: "Rotary Club of Bangalore", reason: "other" },
    ]);
  });

  it("doesn't mistake another organisation that shares a first word for the company's own", () => {
    const r = partnersToAdd([p("Tata Trusts")], { companyName: "Tata Steel Limited", pageTexts: [`Tata Trusts ${"word ".repeat(120)}`] });
    expect(r.add.map((a) => a.name)).toEqual(["Tata Trusts"]);
    expect(partnersToAdd([p("Tata Steel Foundation")], { companyName: "Tata Steel Limited", pageTexts }).leftOut).toEqual([
      { name: "Tata Steel Foundation", reason: "own_foundation" },
    ]);
  });

  it("trusts the reading of a scanned report, which has no text to check against", () => {
    expect(partnersToAdd([p("Smile Foundation")], { companyName: "Infosys Limited", pageTexts: ["", ""] }).add).toHaveLength(1);
  });

  it("says which pages were read as ranges", () => {
    expect(pageRanges([212, 213, 214, 230, 231, 5])).toBe("5, 212–214 and 230–231");
    expect(pageRanges([7])).toBe("7");
    expect(pageRanges([])).toBe("");
  });

  it("names a report for its company and year", () => {
    expect(companyReportLabel("Infosys Limited", "2025-26")).toBe("Infosys Limited annual report 2025-26");
    expect(companyReportLabel("Infosys Limited", null)).toBe("Infosys Limited annual report");
  });
});
