import { describe, expect, it } from "vitest";
import { aboutDisability, checkActionPlan, currentFy, type PlanProject, planCheckDue, planFacts, planLabel, planPartners, planState } from "./csr-plans";
import { htmlText } from "./html";

const project = (more: Partial<PlanProject>): PlanProject => ({
  name: "Project",
  area: null,
  states: [],
  amountInr: null,
  agency: null,
  agencyKind: null,
  registration: null,
  ongoing: null,
  disability: false,
  page: null,
  ...more,
});

describe("when to look for a plan", () => {
  it("knows which year is running", () => {
    expect(currentFy(new Date("2026-10-20"))).toBe("2026-27");
    expect(currentFy(new Date("2026-04-01"))).toBe("2026-27");
    expect(currentFy(new Date("2026-03-31"))).toBe("2025-26");
  });

  it("looks monthly until this year's plan is in, then checks it for changes", () => {
    const today = new Date("2026-06-15");
    const days = (n: number) => new Date(today.getTime() - n * 86_400_000);
    const due = (planFys: string[], checked: number | null, more = {}) =>
      planCheckDue({ planFys, canRecheck: true, checkedAt: checked === null ? null : days(checked), checkRequestedAt: null, ...more }, today);
    expect(due([], null)).toBe("find");
    expect(due(["2025-26"], 10)).toBeNull();
    expect(due(["2025-26"], 31)).toBe("find");
    expect(due(["2026-27"], 10)).toBeNull();
    expect(due(["2026-27"], 31)).toBe("recheck");
    expect(due(["2026-27"], 31, { canRecheck: false })).toBeNull();
    expect(due(["2026-27"], 1, { checkRequestedAt: days(0) })).toBe("find");
  });

  it("looks every three months from October for a plan not yet found", () => {
    const today = new Date("2026-10-20");
    const days = (n: number) => new Date(today.getTime() - n * 86_400_000);
    const due = (planFys: string[], checked: number | null) =>
      planCheckDue({ planFys, canRecheck: true, checkedAt: checked === null ? null : days(checked), checkRequestedAt: null }, today);
    expect(due([], null)).toBe("find");
    expect(due(["2025-26"], 31)).toBeNull();
    expect(due(["2025-26"], 91)).toBe("find");
    // A plan the portal has is still checked for changes monthly.
    expect(due(["2026-27"], 31)).toBe("recheck");
    expect(planCheckDue({ planFys: [], canRecheck: false, checkedAt: new Date("2026-02-01"), checkRequestedAt: null }, new Date("2026-03-15"))).toBeNull();
    expect(planCheckDue({ planFys: [], canRecheck: false, checkedAt: new Date("2026-03-01"), checkRequestedAt: null }, new Date("2026-04-02"))).toBe("find");
  });
});

describe("whether a document is the company's plan", () => {
  it("needs the words action plan and CSR, and the company's name or site", () => {
    const plan = ["Titan Company Limited", "Annual Action Plan for CSR for FY 2026-27, approved by the Board", "1. Girl child education, Karnataka"];
    expect(checkActionPlan(plan, "Titan Company Limited")).toEqual({ ok: true, fy: "2026-27" });
    // A plan that shows the company only as a logo counts when it's on the company's own site.
    const logoOnly = ["Annual Action Plan (CSR) 2026-27", "Projects approved by the Board"];
    expect(checkActionPlan(logoOnly, "Titan Company Limited", { foundAt: "https://www.titancompany.in/sites/default/files/AAP-2026-27.pdf" })).toEqual({
      ok: true,
      fy: "2026-27",
    });
    expect(checkActionPlan(logoOnly, "Titan Company Limited", { foundAt: "https://example.com/aap.pdf" })).toEqual({
      ok: false,
      reason: "It doesn't name Titan Company Limited.",
    });
    expect(checkActionPlan(["Titan Company Limited CSR Policy", "Our CSR committee"], "Titan Company Limited")).toEqual({
      ok: false,
      reason: "It doesn't say it's a CSR action plan.",
    });
    expect(checkActionPlan(["", " "], "Titan Company Limited")).toEqual({ ok: true, fy: null });
    // A person who gives a plan chose it, so only the year is read from it.
    expect(checkActionPlan(["CSR projects for 2026-27"], "Titan Company Limited", { givenByPerson: true })).toEqual({ ok: true, fy: "2026-27" });
  });
});

describe("what a reading gives", () => {
  it("names states as the portal does", () => {
    expect(planState("karnataka")).toBe("Karnataka");
    expect(planState("Pan-India")).toBe("Pan India");
    expect(planState("Bengaluru")).toBeNull();
  });

  it("spots projects on disability, but not a Public Works Department", () => {
    expect(aboutDisability({ name: "Braille books for blind students", area: "Education" })).toBe(true);
    expect(aboutDisability({ name: "Assistive devices", area: "Promoting education among the differently abled" })).toBe(true);
    expect(aboutDisability({ name: "Roads with the PWD", area: "Rural development" })).toBe(false);
    expect(aboutDisability({ name: "Financial inclusion for women", area: null })).toBe(false);
  });

  it("lists each agency once, with what its projects are allocated", () => {
    const projects = [
      project({ name: "Coding for blind students", agency: "Vision Empower Trust", amountInr: 2_000_000, page: 2 }),
      project({ name: "Teacher training", agency: "Vision Empower Trust", amountInr: 1_000_000, registration: "CSR00012345", page: 3 }),
      project({ name: "Health camps", agency: "Titan Foundation", agencyKind: "own_foundation", amountInr: 5_000_000 }),
      project({ name: "Run by the company", amountInr: 500_000 }),
    ];
    expect(planPartners(projects)).toEqual([
      { name: "Vision Empower Trust", kind: "ngo", amountInr: 3_000_000, registration: "CSR00012345", page: 2 },
      { name: "Titan Foundation", kind: "own_foundation", amountInr: 5_000_000, registration: null, page: null },
    ]);
  });

  it("sums the projects when the plan gives no total", () => {
    const projects = [
      project({ amountInr: 2_000_000, states: ["Karnataka"], disability: true }),
      project({ amountInr: 3_000_000, states: ["Bihar", "Karnataka"] }),
    ];
    expect(planFacts({ fy: "2026-27", budget: null, projects })).toEqual({
      fy: "2026-27",
      budget: 5_000_000,
      disabilityWork: true,
      states: ["Bihar", "Karnataka"],
    });
    expect(planFacts({ fy: "2026-27", budget: 9_000_000, projects: [] })).toEqual({ fy: "2026-27", budget: 9_000_000, disabilityWork: false, states: [] });
    expect(planLabel("Titan Company Limited", "2026-27")).toBe("Titan Company Limited CSR action plan 2026-27");
  });
});

describe("web pages as text", () => {
  it("keeps the title and the words, and drops scripts, styles and tags", () => {
    const html = `<html><head><title>CSR | Titan</title><style>p{color:red}</style><script>var x = "<p>";</script></head>
      <body><nav><a href="/">Home</a></nav><h1>Annual Action Plan FY&nbsp;2026&ndash;27</h1>
      <table><tr><th>Project</th><th>Amount</th></tr><tr><td>Girl child &amp; education</td><td>&#8377;2 crore</td></tr></table>
      <!-- hidden --></body></html>`;
    expect(htmlText(html)).toBe("CSR | Titan\nHome\nAnnual Action Plan FY 2026–27\nProject | Amount |\nGirl child & education | ₹2 crore |");
  });
});
