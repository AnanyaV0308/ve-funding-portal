import Link from "next/link";

export function KnowledgeTabs({ current }: { current: "facts" | "documents" }) {
  const tabs = [
    { key: "facts", href: "/knowledge", label: "Facts and numbers" },
    { key: "documents", href: "/knowledge/documents", label: "Documents" },
  ] as const;
  return (
    <nav aria-label="Knowledge base sections">
      <ul className="flex gap-1 border-b border-ve-line">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={current === t.key ? "page" : undefined}
              className={`-mb-px block border-b-4 px-4 py-2 no-underline ${
                current === t.key ? "border-ve-yellow font-medium text-ve-charcoal" : "border-transparent text-ve-muted hover:text-ve-charcoal"
              }`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
