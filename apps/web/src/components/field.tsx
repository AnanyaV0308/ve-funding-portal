export const inputClass = "w-full rounded-md border border-ve-line bg-white px-3 py-2";

/** A labelled form field with an optional hint and error, wired up for screen readers by id. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ve-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** aria-describedby for a field: its hint and its error, when present. */
export function describedBy(id: string, opts: { hint?: boolean; error?: string }) {
  return [opts.hint ? `${id}-hint` : null, opts.error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}
