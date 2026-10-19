import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CSR_PARTNER_KINDS, type CsrPartner, csrPagesToRead, type DisabilityWork, reportFy } from "@ve/core";
import { z } from "zod";
import { apiProblem, MAX_SEND_BYTES, pdfSubset, READER_MODEL, ReadError, tokensUsed } from "./pdf";

/**
 * Reading the CSR section of a listed company's annual report with Claude. Only the company's
 * public report is sent, never any of VE's own data. Which partners count as NGOs it funds is
 * decided by the rules in @ve/core, not by the prompt.
 */

const rupees = (what: string) =>
  z.number().nullable().describe(`${what}, in whole rupees. Convert crore and lakh to rupees. Null if these pages don't give it.`);

const Reading = z.object({
  financial_year: z.string().nullable().describe("The financial year the CSR figures are for, written like 2025-26."),
  has_csr_section: z.boolean().describe("False when these pages hold no CSR report, CSR figures or CSR projects at all."),
  obligation_inr: rupees("The total CSR obligation for the year: two per cent of average net profit, after any set-off"),
  spent_inr: rupees("The total amount spent on CSR for the year, including overheads and impact assessment, but not amounts moved to an Unspent CSR Account"),
  unspent_inr: rupees("The amount transferred to the Unspent CSR Account for ongoing projects for the year"),
  csr_policy_url: z
    .string()
    .nullable()
    .describe("The web link the report prints for its CSR policy or the CSR projects its board approved, exactly as printed."),
  partners: z.array(
    z.object({
      name: z.string().describe("As the report writes it."),
      kind: z
        .enum(CSR_PARTNER_KINDS)
        .describe(
          "ngo: an NGO, trust, society or section 8 company outside the company's group. own_foundation: the company's or its group's own foundation or trust. government: a government fund, ministry, state body or PSU. other: schools, universities, hospitals, companies and anything else.",
        ),
      amount_inr: rupees("What the company gave this partner for the year"),
      csr_registration: z.string().nullable().describe("The partner's CSR Registration Number, like CSR00001234, only if printed."),
      page: z.number().nullable().describe("The page of this document it appears on, where 1 is the document's first page."),
    }),
  ),
  disability_work: z.array(
    z.object({
      description: z.string().describe("One plain sentence: what the work is and who it's for."),
      amount_inr: rupees("What was spent on it"),
      page: z.number().nullable().describe("The page of this document it appears on, where 1 is the document's first page."),
    }),
  ),
});

const SYSTEM = `You read the CSR sections of Indian listed companies' annual reports for Vision Empower, an Indian NGO that works on education for blind and visually impaired children and raises CSR funding.
From the pages given, take the year's CSR figures, every organisation named as an implementing agency, partner or recipient of the company's CSR money, and any CSR work for people with disabilities, including blind and visually impaired people.
Use the figures as the report states them; don't add up or estimate. List each organisation once.`;

export type CompanyReportReading = {
  fy: string | null;
  hasCsr: boolean;
  obligation: number | null;
  spent: number | null;
  unspent: number | null;
  policyUrl: string | null;
  partners: CsrPartner[];
  disabilityWork: DisabilityWork[];
  pages: number;
  pagesRead: number[];
  /** The text of the pages read, for checking names against. */
  readText: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

const money = (n: number | null) => (n === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n));

/** A link the report prints, kept only when it's a web address whose site the pages name. */
function printedLink(href: string | null, text: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(href) ? href : `https://${href}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return text.trim() && !text.toLowerCase().includes(host) ? null : url.href;
  } catch {
    return null;
  }
}

/** Reads the CSR section of a report whose page texts are known. Throws a ReadError, whose message can be shown, when it can't. */
export async function readCompanyReportPdf(pdf: Uint8Array, texts: string[], about: { companyName: string; fy: string | null }): Promise<CompanyReportReading> {
  const read = csrPagesToRead(texts);
  if (!read) throw new ReadError("No page of the report reads like its CSR section, so it wasn't sent to be read.");
  const bytes = await pdfSubset(pdf, read);
  if (bytes.byteLength > MAX_SEND_BYTES) throw new ReadError(`The CSR pages are ${Math.round(bytes.byteLength / 1e6)} MB, too large to send to be read.`);

  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: READER_MODEL,
    max_tokens: 16_000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Reading) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
          {
            type: "text",
            text: `These are the ${read.length} pages (out of ${texts.length}) of ${about.companyName}'s annual report${about.fy ? ` for ${about.fy}` : ""} that are about CSR. Read its CSR figures, partners and disability work.`,
          },
        ],
      },
    ],
  });
  let message;
  try {
    message = await stream.finalMessage();
  } catch (e) {
    apiProblem(e, "this report");
  }
  if (message.stop_reason === "refusal") throw new ReadError("The report couldn't be read (the model declined).");
  if (message.stop_reason === "max_tokens") throw new ReadError("The CSR section was too long to read in one go.");
  const out = message.parsed_output;
  if (!out) throw new ReadError("The reading came back in a form the portal couldn't use.");

  // Page numbers come back for the smaller PDF; turn them into the report's own page numbers.
  const toReportPage = (p: number | null) => (p !== null && Number.isInteger(p) && p >= 1 ? (read[p - 1] ?? null) : null);
  const readText = read.map((n) => texts[n - 1] ?? "");
  return {
    fy: reportFy(texts[0] ?? "") ?? (out.financial_year ? reportFy(out.financial_year) : null),
    hasCsr: out.has_csr_section,
    obligation: money(out.obligation_inr),
    spent: money(out.spent_inr),
    unspent: money(out.unspent_inr),
    policyUrl: printedLink(out.csr_policy_url, readText.join(" ")),
    partners: out.partners.map((p) => ({
      name: p.name,
      kind: p.kind,
      amountInr: money(p.amount_inr),
      registration: p.csr_registration?.trim() || null,
      page: toReportPage(p.page),
    })),
    disabilityWork: out.disability_work.map((d) => ({ description: d.description, amountInr: money(d.amount_inr), page: toReportPage(d.page) })),
    pages: texts.length,
    pagesRead: read,
    readText,
    model: message.model,
    ...tokensUsed(message.usage),
  };
}
