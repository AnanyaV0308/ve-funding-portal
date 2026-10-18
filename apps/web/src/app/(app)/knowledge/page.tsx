import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Knowledge base" };

export default function KnowledgePage() {
  return (
    <>
      <PageHeader title="VE knowledge base" intro="VE's facts, impact numbers, programme write-ups and documents, kept current in one place." />
      <ComingSoon step="step 2">
        <p>Every fact will have an owner and an as-of date, and stale facts are flagged. Past proposals, MoUs and annual reports are uploaded here.</p>
      </ComingSoon>
    </>
  );
}
