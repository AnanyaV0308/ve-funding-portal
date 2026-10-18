import { can, KNOWLEDGE_CATEGORIES, KNOWLEDGE_CATEGORY_LABELS } from "@ve/core";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { listPeople } from "@/lib/people";
import { FactForm } from "../../fact-form";

export const metadata = { title: "Add a fact" };

export default async function NewFactPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const user = await requireUser();
  if (!can(user.roles, "knowledge:edit")) return <NoAccess what="this page" />;
  const { category: c } = await searchParams;
  const category = KNOWLEDGE_CATEGORIES.find((k) => k === c) ?? "impact";
  return (
    <>
      <PageHeader title="Add a fact" intro="Adding a fact marks it as checked by you today." />
      <FactForm
        people={await listPeople()}
        values={{
          category,
          title: "",
          body: "",
          asOf: null,
          sourceLabel: null,
          sourceUrl: null,
          consent: null,
          ownerId: user.id,
          refreshMonths: KNOWLEDGE_CATEGORY_LABELS[category].refreshMonths,
        }}
      />
    </>
  );
}
