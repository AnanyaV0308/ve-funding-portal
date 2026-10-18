import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Awards calendar" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Awards and grants calendar" intro="Upcoming calls VE is eligible for, so no deadline is missed." />
      <ComingSoon step="step 5">
        <p>Each call will show its deadline and an eligibility checklist, with reminders at 30, 14, 7 and 2 days before it closes.</p>
      </ComingSoon>
    </>
  );
}
