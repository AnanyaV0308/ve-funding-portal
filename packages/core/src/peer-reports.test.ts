import { describe, expect, it } from "vitest";
import {
  donorsToAdd,
  driveDownloadUrl,
  findReportLinks,
  MAX_PAGES_READ,
  pagesToRead,
  type ReportDonor,
  reportFy,
  reportLabel,
  reportsToRead,
  uniqueReports,
} from "./peer-reports";

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
    expect(reportFy("annual-report-2021-to-2022.pdf")).toBe("2021-22");
    expect(reportFy("Annual Report June 2024-May 2025")).toBe("2024-25");
    expect(reportFy("EI_Finance_Report_2024-2025.pdf")).toBe("2024-25");
  });

  it("doesn't guess from a year on its own, or from numbers that aren't a year pair", () => {
    expect(reportFy("Annual-Report-2025-India-Final.pdf")).toBeNull();
    expect(reportFy("Report 12-30")).toBeNull();
    expect(reportFy("version 1.24-25.3")).toBeNull();
    expect(reportFy("EnAble_India_2023.pdf")).toBeNull();
    expect(reportFy("Reports 2019 to 2024")).toBeNull();
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
      { url: "https://www.example.org/wp-content/uploads/2026/09/BPA-Report-25-26.pdf", text: "BPA Report 25-26", fy: "2025-26" },
      { url: "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t", text: "Annual Report 2022-23", fy: "2022-23" },
    ]);
  });

  it("follows report pages on the same site only, and not the page itself", () => {
    expect(pages).toEqual(["https://www.example.org/reports/"]);
  });

  it("tells annual reports from other reports by the file name first", () => {
    // From Enable India's and NAB's report pages.
    const found = findReportLinks(
      `<a href="/wp-content/uploads/2025/09/EI_AR_24-25_ACCESSIBLE-1.pdf">Download</a>
      <a href="/wp-content/uploads/2025/09/EI_Finance_Report_2024-2025.pdf">Annual report 2024-25: finances</a>
      <a href="/wp-content/uploads/2016/03/PlacementCellReport2015.pdf">Report 2015</a>
      <a href="/wp-content/uploads/2024/08/DPDP-Report-2024.pdf">Report 2024</a>
      <a href="/wp-content/uploads/2023/10/EI_AR_2022-23.pdf">Annual report</a>
      <a href="/wp-content/uploads/2022/06/annual-report-2020-to-2021.pdf"><img alt="Front Page of Annual Report 2022-2023"></a>`,
      "https://www.enableindia.org/reports/",
    ).reports;
    expect(found.map((r) => [r.url.split("/").pop(), r.fy])).toEqual([
      ["EI_AR_24-25_ACCESSIBLE-1.pdf", "2024-25"],
      ["EI_AR_2022-23.pdf", "2022-23"],
      // The link's year was copied from another report; the file's is right.
      ["annual-report-2020-to-2021.pdf", "2020-21"],
    ]);
  });

  it("names a report by its file when its link says nothing about it", () => {
    const html = `<a href="/wp-content/uploads/2025/10/Annual-Report-2025-India-Final.pdf">READ MORE</a>
      <a href="/uploads/Saksham-Annual-Report-2023-2024-compressed.pdf"><img alt="Cover of the Saksham annual report 2023-2024 showing children reading braille books together in a classroom with their teacher"></a>
      <a href="/uploads/Impact-Measurement-Report-2020-CABI.pdf">Impact Measurement Report 2020 CABI</a>`;
    expect(findReportLinks(html, "https://visionaid.org/annual-reports/").reports.map((r) => [r.text, r.fy])).toEqual([
      ["Annual Report 2025 India Final", null],
      ["Saksham Annual Report 2023-2024 compressed", "2023-24"],
    ]);
  });

  it("lists each report once, however it's linked", () => {
    const html = `<a href="http://www.example.org/AR-2024-25.pdf">Annual report</a>
      <a href="https://example.org/AR-2024-25.pdf">Annual report 2024-25</a>`;
    expect(findReportLinks(html, "https://example.org/").reports).toEqual([
      { url: "http://www.example.org/AR-2024-25.pdf", text: "Annual report", fy: "2024-25" },
    ]);
    expect(
      uniqueReports([
        { url: "https://example.org/a.pdf", text: "Annual report", fy: null },
        { url: "https://www.example.org/a.pdf", text: "Annual report 2023-24", fy: "2023-24" },
      ]),
    ).toEqual([{ url: "https://example.org/a.pdf", text: "Annual report", fy: "2023-24" }]);
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

  it("goes by the year in a report's name, not the folder it was uploaded to", () => {
    const site = "https://mitrajyothi.org/wp-content/uploads";
    const picks = reportsToRead(
      [
        link(`${site}/2025/01/Annual_Report_2022.pdf`, null, "Annual Report 2022"),
        link(`${site}/2023/08/Annual_Report_2024.pdf`, null, "Annual Report 2024"),
        link(`${site}/2024/09/Annual-Report.pdf`, null, "Annual report"),
      ],
      [],
      3,
    );
    expect(picks.map((r) => r.url.slice(site.length))).toEqual([
      "/2023/08/Annual_Report_2024.pdf",
      "/2024/09/Annual-Report.pdf",
      "/2025/01/Annual_Report_2022.pdf",
    ]);
  });
});

describe("reportLabel", () => {
  it("names a report by its financial year, or by the one year its title gives", () => {
    expect(reportLabel("Saksham", { fy: "2023-24", title: "Annual Report" })).toBe("Saksham annual report 2023-24");
    expect(reportLabel("Vision Aid", { fy: null, title: "Annual Report 2025 India Final" })).toBe("Vision Aid annual report 2025");
    expect(reportLabel("NAB", { fy: null, title: "Reports 2019 to 2024" })).toBe("NAB annual report");
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
