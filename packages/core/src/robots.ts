// robots.txt: whether a site lets automated visitors such as the portal's worker fetch a page.
// Follows RFC 9309: the group naming the portal wins over "*", the longest matching rule wins, and
// Allow wins a tie.

type Rule = { allow: boolean; pattern: string };

/** The part of the worker's user agent that robots.txt groups can name. */
export const ROBOTS_AGENT = "VEFundingPortal";

function groups(text: string): { agents: string[]; rules: Rule[] }[] {
  const out: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let afterAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      // Consecutive User-agent lines share the rules that follow them; any rule line, even an empty one, ends the list.
      if (!current || !afterAgent) out.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      afterAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      afterAgent = false;
      // An empty Disallow allows everything, so it adds no rule.
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    }
  }
  return out;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** Whether robots.txt lets `agent` fetch `path` (the URL's path and query). */
export function robotsAllows(robotsTxt: string, path: string, agent = ROBOTS_AGENT): boolean {
  const all = groups(robotsTxt);
  const name = agent.toLowerCase();
  const own = all.filter((g) => g.agents.some((a) => a !== "*" && name.includes(a)));
  const rules = (own.length ? own : all.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best?.allow ?? true;
}
