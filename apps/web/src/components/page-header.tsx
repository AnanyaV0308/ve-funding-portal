export function PageHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <header className="grid gap-2">
      <h1 className="text-3xl font-bold text-ve-charcoal">{title}</h1>
      {intro ? <p className="max-w-prose text-ve-muted">{intro}</p> : null}
    </header>
  );
}
