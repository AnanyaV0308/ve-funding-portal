import { can, factStatus } from "@ve/core";
import { db, knowledgeFacts } from "@ve/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { listPeople } from "@/lib/people";
import { DeleteFact } from "../../delete-fact";
import { FactForm } from "../../fact-form";

export const metadata = { title: "Edit fact" };

export default async function EditFactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user.roles, "knowledge:edit")) return <NoAccess what="this page" />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const fact = await db.query.knowledgeFacts.findFirst({
    where: eq(knowledgeFacts.id, id),
    with: { confirmer: { columns: { name: true, email: true } } },
  });
  if (!fact) notFound();

  return (
    <>
      <PageHeader title={`Edit: ${fact.title}`} />
      <p className="flex flex-wrap items-center gap-2 text-sm text-ve-muted">
        <StatusPill status={factStatus(fact)} />
        {fact.confirmedAt
          ? `Last checked ${formatDate(fact.confirmedAt)} by ${fact.confirmer?.name ?? fact.confirmer?.email ?? "someone"}.`
          : "Loaded from public sources during research. Nobody at VE has checked it yet."}
      </p>
      <FactForm people={await listPeople()} values={fact} />
      <div className="max-w-2xl border-t border-ve-line pt-5">
        <DeleteFact id={fact.id} title={fact.title} />
      </div>
    </>
  );
}
