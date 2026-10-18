import { FACT_STATUS_LABELS, type FactStatus } from "@ve/core";

const STYLES: Record<FactStatus, string> = {
  current: "bg-ok-soft text-ok",
  due_soon: "bg-warn-soft text-warn",
  stale: "bg-bad-soft text-bad",
  unconfirmed: "bg-ve-cream text-ve-olive",
};

export function StatusPill({ status }: { status: FactStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}>
      {FACT_STATUS_LABELS[status]}
    </span>
  );
}
