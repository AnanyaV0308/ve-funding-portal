import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aboutDisability, CSR_PARTNER_KINDS, MAX_PLAN_PAGES, type PlanProject, planState, reportFy } from "@ve/core";
import { z } from "zod";
import { apiProblem, MAX_SEND_BYTES, READER_MODEL, ReadError, tokensUsed } from "./pdf";

/**
 * Reading a company's CSR annual action plan with Claude, from a PDF or a web page's text. Only the
 * company's public plan is sent, never any of VE's own data. Which agencies count as NGOs it funds
 * is decided by the rules in @ve/core, not by the prompt.
 */

/** A web page's text past this is cut, since a plan is a table, not a whole website. */
const MAX_PAGE_CHARS = 120_000;

const rupees = (what: string) =>
  z.number().nullable().describe(`${what}, in whole rupees. Convert crore and lakh to rupees. Null if the plan doesn't give it.`);

const Reading = z.object({
  is_action_plan: z
    .boolean()
    .describe("False when this isn't a list of CSR projects approved for a year, such as a CSR policy alone, a CSR committee charter or a report on past spending."),
  financial_year: z.string().nullable().describe("The financial year the plan is for, written like 2026-27."),
  total_inr: rupees("The total the plan allocates for the year, as it states it"),
  csr_policy_url: z.string().nullable().describe("The web link the plan prints for the company's CSR policy, exactly as printed."),
  projects: z.array(
    z.object({
      name: z.string().describe("The project or programme, as the plan names it."),
      schedule_vii_area: z.string().nullable().describe("The Schedule VII item or area it comes under, as written."),
      states: z.array(z.string()).describe('Indian states it runs in, written out in full, or "Pan India" if the plan says so.'),
      amount_inr: rupees("What the project is allocated for the year"),
      implementing_agency: z.string().nullable().describe("The organisation that carries it out, as written. Null when the company runs it directly."),
      agency_kind: z
        .enum(CSR_PARTNER_KINDS)
        .nullable()
        .describe(
          "ngo: an NGO, trust, society or section 8 company outside the company's group. own_foundation: the company's or its group's own foundation or trust. government: a government fund, ministry, state body or PSU. other: schools, universities, hospitals, companies and anything else.",
        ),
      csr_registration: z.string().nullable().describe("The agency's CSR Registration Number, like CSR00001234, only if printed."),
      ongoing: z.boolean().nullable().describe("True for a multi-year ongoing project, false for one that ends with the year, null if not said."),
      for_people_with_disabilities: z.boolean().describe("True when the project is for people with disabilities, including blind and visually impaired people."),
      page: z.number().nullable().describe("The page of the PDF it appears on, where 1 is the first page. Null for a web page."),
    }),
  ),
});

const SYSTEM = `You read Indian companies' CSR annual action plans for Vision Empower, an Indian NGO that works on education for blind and visually impaired children and raises CSR funding.
Take every project the plan approves for the year, with its area, states, allocation and the organisation that carries it out. Use the figures as the plan states them; don't add up or estimate.`;

export type CsrPlanReading = {
  isPlan: boolean;
  fy: string | null;
  budget: number | null;
  policyUrl: string | null;
  projects: PlanProject[];
  /** The text read, for checking names against. */
  readText: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

const money = (n: number | null) => (n === null || !Number.isFinite(n) || n <= 0 ? null : Math.round(n));

/** A link the plan prints, kept only when it's a web address. */
function printedLink(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(href) ? href : `https://${href}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Reads a plan: a PDF with its page texts, or a web page's text. Throws a ReadError, whose message
 * can be shown, when it can't.
 */
export async function readCsrPlan(
  doc: { pdf: Uint8Array; texts: string[] } | { pageText: string },
  about: { companyName: string; fy: string | null },
): Promise<CsrPlanReading> {
  let content: Anthropic.Beta.BetaContentBlockParam[];
  let readText: string[];
  if ("pdf" in doc) {
    if (doc.texts.length > MAX_PLAN_PAGES) {
      throw new ReadError(`It's ${doc.texts.length} pages, too long for an action plan. If the plan is inside its annual report, add that as its annual report.`);
    }
    if (doc.pdf.byteLength > MAX_SEND_BYTES) throw new ReadError(`It's ${Math.round(doc.pdf.byteLength / 1e6)} MB, too large to send to be read.`);
    content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(doc.pdf).toString("base64") } }];
    readText = doc.texts;
  } else {
    const text = doc.pageText.slice(0, MAX_PAGE_CHARS);
    content = [{ type: "text", text: `<web_page>\n${text}\n</web_page>` }];
    readText = [text];
  }
  content.push({
    type: "text",
    text: `This is ${about.companyName}'s CSR annual action plan${about.fy ? ` for ${about.fy}` : ""}, as published on its website. Read its projects.`,
  });

  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: READER_MODEL,
    max_tokens: 16_000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Reading) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  let message;
  try {
    message = await stream.finalMessage();
  } catch (e) {
    apiProblem(e, "this plan");
  }
  if (message.stop_reason === "refusal") throw new ReadError("The plan couldn't be read (the model declined).");
  if (message.stop_reason === "max_tokens") throw new ReadError("The plan was too long to read in one go.");
  const out = message.parsed_output;
  if (!out) throw new ReadError("The reading came back in a form the portal couldn't use.");

  const pages = "pdf" in doc ? doc.texts.length : 0;
  const page = (p: number | null) => (p !== null && Number.isInteger(p) && p >= 1 && p <= pages ? p : null);
  const projects = out.projects.map((p) => {
    const project = {
      name: p.name.trim(),
      area: p.schedule_vii_area?.trim() || null,
      states: [...new Set(p.states.map(planState).filter((s): s is string => s !== null))],
      amountInr: money(p.amount_inr),
      agency: p.implementing_agency?.trim() || null,
      agencyKind: p.agency_kind,
      registration: p.csr_registration?.trim() || null,
      ongoing: p.ongoing,
      disability: false,
      page: page(p.page),
    };
    return { ...project, disability: p.for_people_with_disabilities || aboutDisability(project) };
  });
  return {
    isPlan: out.is_action_plan,
    fy: out.financial_year ? reportFy(out.financial_year) : null,
    budget: money(out.total_inr),
    policyUrl: printedLink(out.csr_policy_url),
    projects,
    readText,
    model: message.model,
    ...tokensUsed(message.usage),
  };
}
