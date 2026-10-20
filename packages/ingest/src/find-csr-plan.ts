import { linkFromReply } from "@ve/core";
import { searchTheWeb } from "./find-company-report";

/**
 * Finding a company's CSR annual action plan and CSR policy on its own website, with Claude's web
 * search. Only the company's name, CIN, the year and a link its own annual report printed are
 * sent. The links that come back are only candidates: the portal downloads the plan and checks it
 * before using it.
 */

const SYSTEM = `You find Indian companies' CSR annual action plans and CSR policies on the companies' own websites, for an NGO's fundraising portal.
Rule 9 of the Companies (CSR Policy) Rules has every company put its CSR policy and the CSR projects its board approved for the year on its website, usually on a CSR, sustainability or investor relations page. Search the web, and open the company's pages where you need to. Use only links you have seen in search results or on pages you opened; never build or guess a link.
Give the company's own plan, not a subsidiary's, its foundation's annual report, or a report on past spending. Don't use stock exchange websites.
Finish with two lines: "PLAN: " followed by the link to the action plan (a PDF or a web page), or "PLAN: none", then "POLICY: " followed by the link to its CSR policy, or "POLICY: none".`;

export type FoundPlan = { plan: string | null; policy: string | null; searches: number; model: string; inputTokens: number; outputTokens: number };

/** Asks Claude to find the plan for `fy`, or the newest one published. Throws a ReadError when the API can't be used. */
export async function findCsrPlan(company: { name: string; cin: string | null; fy: string; hint: string | null }): Promise<FoundPlan> {
  const [start] = company.fy.split("-");
  const ask =
    `Find the CSR annual action plan of ${company.name}${company.cin ? ` (CIN ${company.cin})` : ""} for the financial year ${company.fy} (April ${start} to March ${Number(start) + 1}), and its CSR policy. If that year's plan isn't published yet, give the newest one that is.` +
    (company.hint ? ` Its annual report gives this link for its CSR policy and approved projects: ${company.hint}` : "");
  const { reply, ...spent } = await searchTheWeb(SYSTEM, ask);
  return { plan: linkFromReply(reply, "PLAN"), policy: linkFromReply(reply, "POLICY"), ...spent };
}
