"use client";

import { useEffect, useRef } from "react";

/**
 * A confirmation shown after a redirect ("Pursuit added."). It takes focus when it appears so a
 * screen reader reads it straight away; a freshly rendered live region often isn't announced.
 */
export function Notice({ children, tone = "ok" }: { children: React.ReactNode; tone?: "ok" | "warn" }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <p
      ref={ref}
      role="status"
      tabIndex={-1}
      className={`rounded-md p-3 ${tone === "ok" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}
    >
      {children}
    </p>
  );
}
