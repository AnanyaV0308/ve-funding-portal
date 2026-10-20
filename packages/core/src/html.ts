// Web pages as plain text, for reading pages such as a company's CSR page.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  rupee: "₹",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/**
 * The readable text of a web page: its title, then its body without scripts, styles or tags, with
 * entities decoded, one block per line and table cells split by " | ".
 */
export function htmlText(html: string): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|table|section|article|ul|ol|header|footer|nav|main|aside|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(`${title}\n${body}`)
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim();
}
