import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";

export const metadata = { title: "This week" };

export default async function ThisWeekPage() {
  const user = await requireUser();
  const firstName = user.name?.split(" ")[0];
  return (
    <>
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "This week"}
        intro="Your starting point each day: new high-fit leads, deadlines coming up, pursuits that have gone quiet, and your tasks."
      />
      <ComingSoon step="step 3, with the pipeline">
        <p>This page will show the weighted pipeline value by source, deadlines in the next 14 days, pursuits stuck for more than 21 days, and the tasks assigned to you.</p>
      </ComingSoon>
    </>
  );
}
