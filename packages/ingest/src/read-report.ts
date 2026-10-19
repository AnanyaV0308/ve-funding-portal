import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { pagesToRead, REPORT_DONOR_KINDS, type ReportDonor } from "@ve/core";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

/**
 * Reading a peer NGO's annual report with Claude. Only the NGO's public report is sent, never
 * any of VE's own data. The portal's rules about which donors to add are in @ve/core, not in the
 * prompt: Claude lists everyone the report presents as a donor, and the rules decide.
 */

export const READER_MODEL = "claude-opus-5-5";
/** Reading needs an Anthropic API key in the environment. */
export const readerConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** The Claude API takes up to 32 MB per request, and base64 makes a file a third bigger. */
const MAX_SEND_BYTES = 22e6;
/** A report with no text to find the donor pages by is sent whole, up to this many pages. */
const MAX_WHOLE_PAGES = 150;

export class ReadError extends Error {}

const Reading = z.object({
  lists_donors: z.boolean().describe("False when these pages name no donors, funders, CSR partners or sponsors at all."),
  donors: z.array(
    z.object({
      name: z.string().describe("As the report writes it, using the full legal name where the report gives one."),
      kind: z
        .enum(REPORT_DONOR_KINDS)
        .describe(
          "company (including its CSR arm), foundation or trust, individual, government (any ministry, state body or PSU programme run by government), or other (clubs, schools, NGOs, groups).",
        ),
      registered_in_india: z
        .boolean()
        .describe(
          "False for a foreign company, foundation, embassy, UN body or other organisation registered outside India. True for an Indian company, including an Indian subsidiary of a foreign group.",
        ),
      cin: z.string().nullable().describe("The company's 21-character CIN, only if the report prints it."),
      amount_inr: z
        .number()
        .nullable()
        .describe("This donor's amount in whole rupees, only if the report gives it in rupees. Convert lakh and crore to rupees."),
      page: z.number().nullable().describe("The page of this document it appears on, where 1 is the document's first page."),
    }),
  ),
});

const SYSTEM = `You read Indian NGOs' annual reports for Vision Empower, an Indian NGO that raises CSR funding. From the report, you list everyone the NGO presents as giving it money or support in kind: donors, funders, CSR partners, grant makers and sponsors, including names shown only as logos.
Leave out the NGO itself and its own units, its auditors and bankers, award juries, media and knowledge partners, the schools, hospitals and NGOs it works with, and anyone the report doesn't present as a donor or supporter.
List each donor once. If you can't read a logo's name with confidence, leave it out rather than guess.`;

export type ReportReading = {
  donors: ReportDonor[];
  pages: number;
  pagesRead: number[] | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** The report's pages that list donors, as a smaller PDF, or the whole report when no page says so. */
export async function donorPages(pdf: Uint8Array): Promise<{ pages: number; read: number[] | null; bytes: Uint8Array }> {
  let pages: number;
  let texts: string[];
  try {
    ({ totalPages: pages, text: texts } = await extractText(await getDocumentProxy(pdf.slice()), { mergePages: false }));
  } catch {
    throw new ReadError("The PDF couldn't be opened. It may be damaged or password-protected.");
  }
  const read = pagesToRead(texts);
  if (!read) {
    if (pages > MAX_WHOLE_PAGES) throw new ReadError(`No page reads like a donor list, and the report has too many pages (${pages}) to read whole.`);
    return { pages, read: null, bytes: pdf };
  }
  const source = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    source,
    read.map((n) => n - 1),
  );
  for (const page of copied) out.addPage(page);
  return { pages, read, bytes: await out.save() };
}

/** Reads the donors from a report. Throws a ReadError, whose message can be shown, when it can't. */
export async function readReportPdf(pdf: Uint8Array, about: { ngoName: string; fy: string | null }): Promise<ReportReading> {
  const { pages, read, bytes } = await donorPages(pdf);
  if (bytes.byteLength > MAX_SEND_BYTES) {
    throw new ReadError(`The ${read ? "pages with donors are" : "report is"} ${Math.round(bytes.byteLength / 1e6)} MB, too large to send to be read.`);
  }
  const which = read
    ? `These are the ${read.length} pages (out of ${pages}) of ${about.ngoName}'s annual report${about.fy ? ` for ${about.fy}` : ""} that look like they name donors.`
    : `This is ${about.ngoName}'s annual report${about.fy ? ` for ${about.fy}` : ""}.`;

  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: READER_MODEL,
    max_tokens: 32_000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Reading) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
          { type: "text", text: `${which} List its donors.` },
        ],
      },
    ],
  });
  let message;
  try {
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ReadError("The Anthropic API key was turned down. Check ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) throw new ReadError("The Anthropic API is busy or the account is out of credit. Try again later.");
    if (e instanceof Anthropic.BadRequestError) throw new ReadError(`The Anthropic API couldn't read this report: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new ReadError("The Anthropic API had a problem. Try again later.");
    throw e;
  }
  if (message.stop_reason === "refusal") throw new ReadError("The report couldn't be read (the model declined).");
  if (message.stop_reason === "max_tokens") throw new ReadError("The donor list was too long to read in one go.");
  const out = message.parsed_output;
  if (!out) throw new ReadError("The reading came back in a form the portal couldn't use.");

  // Page numbers come back for the smaller PDF; turn them into the report's own page numbers.
  const toReportPage = (p: number | null) => {
    if (p === null || !Number.isInteger(p) || p < 1) return null;
    return read ? (read[p - 1] ?? null) : p <= pages ? p : null;
  };
  const donors: ReportDonor[] = out.lists_donors
    ? out.donors.map((d) => ({
        name: d.name,
        kind: d.kind,
        inIndia: d.registered_in_india,
        cin: d.cin?.trim().toUpperCase() || null,
        amountInr: d.amount_inr === null ? null : Math.round(d.amount_inr),
        page: toReportPage(d.page),
      }))
    : [];
  return {
    donors,
    pages,
    pagesRead: read,
    model: message.model,
    inputTokens: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0),
    outputTokens: message.usage.output_tokens,
  };
}
