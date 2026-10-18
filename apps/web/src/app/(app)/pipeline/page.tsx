import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Pipeline" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader title="Pipeline" intro="Every funder VE is pursuing, by stage, with an owner, an ask and a next action." />
      <ComingSoon step="step 3">
        <p>A board and a table showing the same data. Every card can be moved with a "Move to" menu as well as by dragging, so the board works with a screen reader.</p>
      </ComingSoon>
    </>
  );
}
