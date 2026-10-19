import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const USER_AGENT = "Mozilla/5.0 (compatible; VisionEmpowerFundingPortal/1.0)";
const TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

export class FetchError extends Error {}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
    return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * In production the worker only fetches public websites, so a link someone enters can't reach the
 * hosting provider's internal addresses. Locally (and in tests) any address is allowed.
 */
async function assertPublic(url: URL) {
  if (process.env.NODE_ENV !== "production") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new FetchError(`${url.hostname} isn't a public website.`);
}

/**
 * Fetches a public web page or file, following redirects, and gives up past `maxBytes`. Errors are
 * FetchErrors whose message can be shown to people as it is.
 */
export async function fetchPublic(href: string, maxBytes: number): Promise<{ url: string; type: string; body: Uint8Array }> {
  let url = new URL(href);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new FetchError("Only http and https links can be opened.");
    await assertPublic(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const reason = e instanceof Error && e.name === "TimeoutError" ? "it took too long to answer" : "the site couldn't be reached";
      throw new FetchError(`Couldn't open ${url.hostname}: ${reason}.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new FetchError(`${url.hostname} answered ${res.status}${res.status === 404 ? " (page not found)" : ""}.`);
    }
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > maxBytes) {
      await res.body?.cancel();
      throw new FetchError(`The file is ${Math.round(length / 1e6)} MB, more than the ${Math.round(maxBytes / 1e6)} MB the portal reads.`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    for (let part = await reader?.read(); part && !part.done; part = await reader!.read()) {
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader!.cancel();
        throw new FetchError(`The file is more than the ${Math.round(maxBytes / 1e6)} MB the portal reads.`);
      }
      chunks.push(part.value);
    }
    const body = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      body.set(c, at);
      at += c.byteLength;
    }
    return { url: url.href, type: res.headers.get("content-type") ?? "", body };
  }
  throw new FetchError("The link redirects too many times.");
}

/** True when the bytes are a PDF, whatever the server said the type was. */
export const looksLikePdf = (body: Uint8Array) => body.length > 4 && new TextDecoder().decode(body.subarray(0, 1024)).includes("%PDF-");
