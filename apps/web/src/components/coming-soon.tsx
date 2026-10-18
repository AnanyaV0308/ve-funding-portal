/** Placeholder for a screen whose build step hasn't landed yet. Says what will be here and when. */
export function ComingSoon({ step, children }: { step: string; children: React.ReactNode }) {
  return (
    <section className="grid max-w-prose gap-3 rounded-lg border border-dashed border-ve-line bg-ve-cream/50 p-6">
      <p className="label text-sm text-ve-olive">Arrives in {step}</p>
      <div className="grid gap-2 text-ve-charcoal">{children}</div>
    </section>
  );
}
