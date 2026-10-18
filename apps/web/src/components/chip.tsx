import Link from "next/link";

/**
 * A pill-shaped link for switching views or toggling a filter. View chips mark the current one with
 * aria-current; toggles ("pressed") say on or off to screen readers instead.
 */
export function Chip({ href, active, label, pressed }: { href: string; active: boolean; label: string; pressed?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={!pressed && active ? "true" : undefined}
        className={`inline-block rounded-full border px-3 py-1 text-sm no-underline ${
          active ? "border-ve-yellow bg-ve-yellow text-ve-on-yellow" : "border-ve-line bg-white text-ve-charcoal hover:bg-ve-cream"
        }`}
      >
        {pressed ? <span aria-hidden="true">{active ? "✓ " : ""}</span> : null}
        {label}
        {pressed ? <span className="sr-only">{active ? " (on)" : " (off)"}</span> : null}
      </Link>
    </li>
  );
}
