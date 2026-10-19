import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { EXCHANGE_SITES, reportLinkFromReply } from "@ve/core";
import { apiProblem, READER_MODEL, ReadError, tokensUsed } from "./pdf";

/**
 * Finding a listed company's annual report on its own website, with Claude's web search. Only the
 * company's name, CIN and the year are sent. The stock exchanges' websites are left out: NSE's
 * terms of use forbid automated collection and BSE blocks it. The link that comes back is only a
 * candidate: the portal downloads it and checks it's the company's report before using it.
 */

/** A search that keeps pausing to fetch more pages is stopped after this many turns. */
const MAX_TURNS = 4;

const SYSTEM = `You find Indian listed companies' annual reports on the companies' own websites, for an NGO's fundraising portal.
Search the web, and open the company's investor relations page where you need to. Listed companies also link their annual reports from their page of disclosures under Regulation 46 of the SEBI Listing Regulations. Use only links you have seen in search results or on pages you opened; never build or guess a link.
Give the company's own full annual report: not a subsidiary's, a summary, a notice or a stock exchange filing. Don't use stock exchange websites. Finish with one line, "PDF: " followed by the direct link to the report's PDF, or "PDF: none" if you couldn't find it.`;

export type FoundReport = { url: string | null; searches: number; model: string; inputTokens: number; outputTokens: number };

/** Asks Claude to find the report for `fy`, or the newest one published. Throws a ReadError when the API can't be used. */
export async function findCompanyReport(company: { name: string; cin: string | null; fy: string }): Promise<FoundReport> {
  const [start] = company.fy.split("-");
  const ask = `Find the annual report of ${company.name}${company.cin ? ` (CIN ${company.cin})` : ""} for the financial year ${company.fy} (April ${start} to March ${Number(start) + 1}), as a PDF on the company's own website. If that year's report isn't published yet, give the newest one that is.`;
  const client = new Anthropic();
  const messages: BetaMessageParam[] = [{ role: "user", content: ask }];
  let searches = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let model = READER_MODEL;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let message;
    try {
      message = await client.beta.messages
        .stream({
          model: READER_MODEL,
          max_tokens: 4_000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system: SYSTEM,
          tools: [
            {
              type: "web_search_20260209",
              name: "web_search",
              max_uses: 4,
              blocked_domains: EXCHANGE_SITES,
              user_location: { type: "approximate", country: "IN", timezone: "Asia/Kolkata" },
            },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, blocked_domains: EXCHANGE_SITES, max_content_tokens: 20_000 },
          ],
          messages,
        })
        .finalMessage();
    } catch (e) {
      apiProblem(e, "the search");
    }
    model = message.model;
    searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    const used = tokensUsed(message.usage);
    inputTokens += used.inputTokens;
    outputTokens += used.outputTokens;
    if (message.stop_reason === "pause_turn") {
      // The search is still going: send its turn back and it carries on where it stopped.
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "refusal") throw new ReadError("The search couldn't be done (the model declined).");
    const reply = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { url: reportLinkFromReply(reply), searches, model, inputTokens, outputTokens };
  }
  return { url: null, searches, model, inputTokens, outputTokens };
}
