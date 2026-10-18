import { can, type Track, TRACKS } from "@ve/core";
import { db, funders } from "@ve/db";
import { asc } from "drizzle-orm";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { listPeople } from "@/lib/people";
import { NewPursuitForm } from "../pursuit-form";

export const metadata = { title: "Add a pursuit" };

export default async function NewPursuitPage({ searchParams }: { searchParams: Promise<{ track?: string }> }) {
  const user = await requireUser();
  if (!can(user.roles, "pipeline:edit")) return <NoAccess what="this page" />;
  const { track } = await searchParams;
  const [funderRows, people] = await Promise.all([
    db.select({ id: funders.id, name: funders.name }).from(funders).orderBy(asc(funders.name)),
    listPeople(),
  ]);
  return (
    <>
      <PageHeader title="Add a pursuit" intro="One pursuit is one ask to one funder. A funder can have several over the years." />
      <NewPursuitForm
        funders={funderRows}
        people={people}
        defaultTrack={TRACKS.find((t): t is Track => t === track) ?? "relationship"}
        defaultOwnerId={user.id}
      />
    </>
  );
}
