export function NoAccess({ what }: { what: string }) {
  return (
    <section role="alert" className="grid max-w-prose gap-2 rounded-lg border border-ve-line bg-white p-6">
      <h2 className="text-xl font-bold">You can't open {what}</h2>
      <p className="text-ve-muted">Your role doesn't include this. Ask a VE admin to change your role in Settings.</p>
    </section>
  );
}
