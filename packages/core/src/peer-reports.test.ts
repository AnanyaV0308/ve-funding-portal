import { describe, expect, it } from "vitest";
import { donorsToAdd, driveDownloadUrl, findReportLinks, MAX_PAGES_READ, pagesToRead, type ReportDonor, reportFy, reportsToRead } from "./peer-reports";

const CIN = "L22210MH1995PLC084781";

describe("reportFy", () => {
  it("reads the financial year from the ways NGOs name their reports", () => {
    expect(reportFy("Annual Report 2023-24")).toBe("2023-24");
    expect(reportFy("Saksham-Annual-Report-2023-2024-compressed.pdf")).toBe("2023-24");
    expect(reportFy("AR_2023_2024.pdf")).toBe("2023-24");
    expect(reportFy("EI_AR_24-25_ACCESSIBLE-1.pdf")).toBe("2024-25");
    expect(reportFy("MJ-Annual-Report_24-25.pdf")).toBe("2024-25");
    expect(reportFy("FY24 report")).toBe("2023-24");
    expect(reportFy("XRCVC_Annual_Report_AY_2025-2026.pdf")).toBe("2025-26");
  });

  it("doesn't guess from a year on its own, or from numbers that aren't a year pair", () => {
    expect(reportFy("Annual-Report-2025-India-Final.pdf")).toBeNull();
    expect(reportFy("Report 12-30")).toBeNull();
    expect(reportFy("version 1.24-25.3")).toBeNull();
    // The first text that gives a year wins.
    expect(reportFy("Annual report", "AR-2022-23.pdf")).toBe("2022-23");
  });
});

describe("findReportLinks", () => {
  const html = `
    <nav><a href="/about/">About</a> <a href="/reports/">Reports</a> <a href="https://other.org/annual-reports/">Partner reports</a></nav>
    <a href="/wp-content/uploads/2025/01/Saksham-Annual-Report-2023-2024-compressed.pdf"><img src="cover.jpg" alt="Annual Report 2023-24"></a>
    <a href='docs/XRCVC_Annual Report_2021-22.pdf' title="Older report">2021&ndash;22</a>
    <a href="/wp-content/uploads/2026/09/BPA-Report-25-26.pdf">Download</a>
    <a href="/documents/Audit_Report_2025-26.pdf">Audit report 2025-26</a>
    <a href="/brochure.pdf">Brochure</a>
    <a href="https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing">Annual Report 2022-23</a>
    <a href="mailto:info@example.org">Write to us</a>
    <a href="/annual-report/#top">Annual report</a>`;
  const { reports, pages } = findReportLinks(html, "https://www.example.org/annual-report/");

  it("finds PDFs that look like annual reports, with their year", () => {
    expect(reports).toEqual([
      {
        url: "https://www.example.org/wp-content/uploads/2025/01/Saksham-Annual-Report-2023-2024-compressed.pdf",
        text: "Annual Report 2023-24",
        fy: "2023-24",
      },
      { url: "https://www.example.org/annual-report/docs/XRCVC_Annual%20Report_2021-22.pdf", text: "2021–22 Older report", fy: "2021-22" },
      { url: "https://www.example.org/wp-content/uploads/2026/09/BPA-Report-25-26.pdf", text: "Download", fy: "2025-26" },
      { url: "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t", text: "Annual Report 2022-23", fy: "2022-23" },
    ]);
  });

  it("follows report pages on the same site only, and not the page itself", () => {
    expect(pages).toEqual(["https://www.example.org/reports/"]);
  });

  it("turns Google Drive file links into downloads", () => {
    expect(driveDownloadUrl(new URL("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp"))).toContain("id=1AbCdEfGhIjKlMnOp");
    expect(driveDownloadUrl(new URL("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"))).toBeNull();
    expect(driveDownloadUrl(new URL("https://example.org/file/d/1AbCdEfGhIjKlMnOp"))).toBeNull();
  });
});

describe("reportsToRead", () => {
  const link = (url: string, fy: string | null, text = "") => ({ url, text, fy });
  const found = [
    link("a-2021-22.pdf", "2021-22"),
    link("b-2023-24.pdf", "2023-24"),
    link("c-2022-23.pdf", "2022-23"),
    link("d.pdf", null, "Annual Report 2025"),
  ];

  it("reads the newest reports first", () => {
    expect(reportsToRead(found, []).map((r) => r.url)).toEqual(["d.pdf", "b-2023-24.pdf"]);
  });

  it("reads nothing older once the newest are known", () => {
    expect(reportsToRead(found, ["d.pdf", "b-2023-24.pdf"])).toEqual([]);
    expect(reportsToRead([...found, link("e-2025-26.pdf", "2025-26")], ["d.pdf", "b-2023-24.pdf"]).map((r) => r.url)).toEqual(["e-2025-26.pdf"]);
  });
});

describe("pagesToRead", () => {
  const filler = "Our students learned to code with screen readers this year.";

  it("picks the pages that start a donor list, and the page after each", () => {
    const pages = [
      filler,
      filler,
      "Our Supporters\nWe thank everyone who made this year possible.",
      "",
      filler,
      "Schedule of donations received\nInfosys Ltd 10,00,000",
      filler,
    ];
    expect(pagesToRead(pages)).toEqual([3, 4, 6, 7]);
  });

  it("falls back to pages full of donor words, and to the whole report when there are none", () => {
    expect(pagesToRead([filler, "CSR grants and donations from donors and funders", filler])).toEqual([2, 3]);
    expect(pagesToRead([filler, "", filler])).toBeNull();
  });

  it("reads at most a set number of pages", () => {
    expect(pagesToRead(Array.from({ length: 50 }, () => "Our donors"))!.length).toBe(MAX_PAGES_READ);
  });
});

describe("donorsToAdd", () => {
  const d = (name: string, kind: ReportDonor["kind"], extra: Partial<ReportDonor> = {}): ReportDonor => ({
    name,
    kind,
    inIndia: true,
    cin: null,
    amountInr: null,
    page: 12,
    ...extra,
  });

  it("adds Indian companies and foundations once each, with their CIN, amount and page", () => {
    const { entries, leftOut } = donorsToAdd([
      d("Infosys Ltd", "company", { cin: CIN, amountInr: 1_000_000 }),
      d("Azim Premji Foundation", "foundation"),
      d("INFOSYS LIMITED", "company"),
      d("  Wipro   Limited ", "company", { cin: "not a cin", amountInr: -5, page: 0 }),
    ]);
    expect(entries).toEqual([
      { line: 1, name: "Infosys Ltd", cin: CIN, amount: 1_000_000, type: "company", page: 12 },
      { line: 2, name: "Azim Premji Foundation", cin: null, amount: null, type: "foundation", page: 12 },
      { line: 4, name: "Wipro Limited", cin: null, amount: null, type: "company", page: null },
    ]);
    expect(leftOut).toEqual([]);
  });

  it("leaves out government bodies, foreign donors, people and others, saying why", () => {
    const { entries, leftOut } = donorsToAdd([
      d("Ministry of Social Justice", "government"),
      d("Perkins School for the Blind", "foundation", { inIndia: false }),
      d("Ravi Kumar", "individual"),
      d("Rotary Club of Bangalore", "other"),
      d("", "company"),
    ]);
    expect(entries).toEqual([]);
    expect(leftOut.map((l) => l.reason)).toEqual(["government", "abroad", "individual", "other"]);
  });
});
