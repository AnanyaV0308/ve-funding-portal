"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; soon?: string };

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap gap-1 md:flex-col">
      {items.map((item) => {
        if (item.soon) {
          return (
            <li key={item.href} className="px-3 py-2 text-ve-muted">
              {item.label} <span className="label text-xs">({item.soon})</span>
            </li>
          );
        }
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-md px-3 py-2 no-underline ${
                active ? "bg-ve-yellow font-medium text-ve-on-yellow" : "text-ve-charcoal hover:bg-ve-cream"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
