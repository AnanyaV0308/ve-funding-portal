/**
 * Email layouts in VE's brand. Every email has a plain-text twin, real headings and lists for
 * screen readers, and links that make sense on their own. VE yellow is only ever a fill behind
 * dark text.
 */

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** "12 Nov 2026" for a YYYY-MM-DD date. */
export function formatDay(day: string): string {
  return dayFmt.format(new Date(`${day}T00:00:00+05:30`));
}

/** "today", "tomorrow", "in 12 days". */
export function daysLeftLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The portal's address, for links in emails. */
export function appUrl(): string {
  return (process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type Section = { heading: string; empty?: string; items: { html: string; text: string }[] };

const FONT = "Ubuntu, 'Segoe UI', Arial, sans-serif";

/** Wraps a body in the shared layout. `sections` render as h2 + list. */
export function layout(opts: { title: string; intro: string; sections: Section[]; footer: string }): { html: string; text: string } {
  const sections = opts.sections
    .map((s) => {
      const body = s.items.length
        ? `<ul style="margin:0 0 8px;padding-left:20px">${s.items.map((i) => `<li style="margin:0 0 10px">${i.html}</li>`).join("")}</ul>`
        : `<p style="margin:0 0 8px;color:#5f5849">${escapeHtml(s.empty ?? "Nothing this time.")}</p>`;
      return `<h2 style="font-size:18px;margin:24px 0 8px;color:#333333">${escapeHtml(s.heading)}</h2>${body}`;
    })
    .join("");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#fffdf8;color:#333333;font-family:${FONT};font-size:16px;line-height:1.5">
<div style="max-width:640px;margin:0 auto;padding:0 16px 32px">
<p style="margin:0 0 24px;padding:12px 16px;background:#f7cd4b;color:#2b2619;font-weight:bold">Vision Empower · Funding portal</p>
<h1 style="font-size:24px;margin:0 0 8px">${escapeHtml(opts.title)}</h1>
<p style="margin:0 0 8px">${opts.intro}</p>
${sections}
<p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e8dfcb;font-size:14px;color:#5f5849">${opts.footer}</p>
</div>
</body>
</html>`;

  const text = [
    opts.title,
    "",
    stripTags(opts.intro),
    ...opts.sections.flatMap((s) => ["", s.heading, ...(s.items.length ? s.items.map((i) => `- ${i.text}`) : [s.empty ?? "Nothing this time."])]),
    "",
    "--",
    stripTags(opts.footer),
  ].join("\n");
  return { html, text };
}

function stripTags(s: string): string {
  return s
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:#514937;text-decoration-color:#f7cd4b">${escapeHtml(label)}</a>`;
}

export function settingsFooter(why: string): string {
  return `${escapeHtml(why)} Choose which emails you get under ${link(`${appUrl()}/settings#emails`, "Settings, Emails to me")}.`;
}
