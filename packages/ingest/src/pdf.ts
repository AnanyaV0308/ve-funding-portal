import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

/** The model that reads reports. Reading and finding need an Anthropic API key in the environment. */
export const READER_MODEL = "claude-opus-5-5";
export const readerConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** The Claude API takes up to 32 MB per request, and base64 makes a file a third bigger. */
export const MAX_SEND_BYTES = 22e6;

export class ReadError extends Error {}

/** The text of each page of a PDF. */
export async function pageTexts(pdf: Uint8Array): Promise<{ pages: number; texts: string[] }> {
  try {
    // Errors only: some reports' fonts make pdf.js print thousands of warnings, which slows reading down.
    const { totalPages, text } = await extractText(await getDocumentProxy(pdf.slice(), { verbosity: 0 }), { mergePages: false });
    return { pages: totalPages, texts: text };
  } catch {
    throw new ReadError("The PDF couldn't be opened. It may be damaged or password-protected.");
  }
}

/** The given pages (1 is the first) as a smaller PDF. */
export async function pdfSubset(pdf: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    source,
    pages.map((n) => n - 1),
  );
  for (const page of copied) out.addPage(page);
  return out.save();
}

/** What to tell people when the Claude API turns a request down. Errors that aren't the API's are passed on. */
export function apiProblem(e: unknown, what: string): never {
  if (e instanceof Anthropic.AuthenticationError) throw new ReadError("The Anthropic API key was turned down. Check ANTHROPIC_API_KEY.");
  if (e instanceof Anthropic.RateLimitError) throw new ReadError("The Anthropic API is busy or the account is out of credit. Try again later.");
  if (e instanceof Anthropic.BadRequestError) throw new ReadError(`The Anthropic API couldn't read ${what}: ${e.message}`);
  if (e instanceof Anthropic.APIError) throw new ReadError("The Anthropic API had a problem. Try again later.");
  throw e;
}

/** Tokens a reply cost, counting cached input as input. */
export function tokensUsed(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}) {
  return {
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}
