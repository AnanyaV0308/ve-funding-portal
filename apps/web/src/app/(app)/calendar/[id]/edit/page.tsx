import { can } from "@ve/core";
import { db, opportunities } from "@ve/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { listOrganisers } from "@/lib/calendar";
import { CallForm } from "../../call-form";

export const metadata = { title: "Edit a call" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditCallPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user.roles, "calendar:edit")) return <NoAccess what="this page" />;
  const { id } = await params;
  const call = UUID.test(id) ? await db.query.opportunities.findFirst({ where: eq(opportunities.id, id) }) : null;
  if (!call) notFound();
  return (
    <>
      <PageHeader title={`Edit ${call.title}`} />
      <CallForm
        organisers={await listOrganisers()}
        cancelHref={`/calendar/${call.id}`}
        initial={{
          id: call.id,
          funderId: call.funderId,
          kind: call.kind,
          title: call.title,
          url: call.url ?? "",
          opensOn: call.opensOn ?? "",
          deadline: call.deadline ?? "",
          usualWindow: call.usualWindow ?? "",
          amount: call.amount === null ? "" : String(call.amount),
          amountNote: call.amountNote ?? "",
          categories: call.categories ?? "",
          notes: call.notes ?? "",
        }}
      />
    </>
  );
}
