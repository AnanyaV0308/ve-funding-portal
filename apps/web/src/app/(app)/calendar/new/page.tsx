import { can } from "@ve/core";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { listOrganisers } from "@/lib/calendar";
import { CallForm } from "../call-form";

export const metadata = { title: "Add a call" };

export default async function NewCallPage() {
  const user = await requireUser();
  if (!can(user.roles, "calendar:edit")) return <NoAccess what="this page" />;
  return (
    <>
      <PageHeader
        title="Add an award or grant call"
        intro="Add the dates if they're out. You'll check VE's eligibility on the next page, and reminders start once there's a deadline."
      />
      <CallForm organisers={await listOrganisers()} cancelHref="/calendar" />
    </>
  );
}
