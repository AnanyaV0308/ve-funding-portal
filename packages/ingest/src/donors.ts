import { type DonorMatch, type DonorProblem, type FunderType, matchDonors, readDonorLines } from "@ve/core";
import { db, donorLists, funderGrantees, funders } from "@ve/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { rescoreFunders } from "./score";

export type DonorListInput = {
  ngoName: string;
  fy: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  newFunderType: FunderType;
  text: string;
};

export type DonorPreview = { matches: DonorMatch[]; problems: DonorProblem[] };

/** Reads the pasted list and finds each donor among the funders already in the portal. Writes nothing. */
export async function previewDonorList(text: string): Promise<DonorPreview> {
  const { entries, problems } = readDonorLines(text);
  const known = await db.select({ id: funders.id, name: funders.name, cin: funders.cin, type: funders.type }).from(funders);
  return { matches: matchDonors(entries, known), problems };
}

/**
 * Saves a donor list: adds the donors the portal doesn't know yet, records the NGO against each
 * donor, and scores the companies again. A donor that already names this NGO for the same year
 * isn't recorded twice.
 */
export async function saveDonorList(input: DonorListInput, userId: string) {
  const { matches } = await previewDonorList(input.text);
  const result = await db.transaction(async (tx) => {
    const names = new Set((await tx.select({ name: funders.name }).from(funders)).map((f) => f.name.toLowerCase()));
    const created: string[] = [];
    const donorIds: { funderId: string; amount: number | null }[] = [];
    for (const m of matches) {
      let funderId = m.funder?.id;
      if (!funderId) {
        // Two different companies can share a name; the CIN keeps them apart.
        const name = names.has(m.name.toLowerCase()) && m.cin ? `${m.name} (${m.cin})` : m.name;
        names.add(name.toLowerCase());
        const [row] = await tx
          .insert(funders)
          .values({ name, type: input.newFunderType, cin: m.cin, createdBy: userId })
          .returning({ id: funders.id });
        funderId = row!.id;
        created.push(funderId);
      }
      if (!donorIds.some((d) => d.funderId === funderId)) donorIds.push({ funderId, amount: m.amount });
    }
    const [list] = await tx
      .insert(donorLists)
      .values({
        ngoName: input.ngoName,
        fy: input.fy,
        sourceLabel: input.sourceLabel,
        sourceUrl: input.sourceUrl,
        newFunderType: input.newFunderType,
        donorCount: donorIds.length,
        matchedCount: donorIds.length - created.length,
        createdFunderIds: created,
        createdBy: userId,
      })
      .returning({ id: donorLists.id });
    const already = donorIds.length
      ? await tx
          .select({ funderId: funderGrantees.funderId })
          .from(funderGrantees)
          .where(
            and(
              inArray(
                funderGrantees.funderId,
                donorIds.map((d) => d.funderId),
              ),
              sql`lower(${funderGrantees.name}) = lower(${input.ngoName})`,
              input.fy ? eq(funderGrantees.fy, input.fy) : sql`${funderGrantees.fy} is null`,
            ),
          )
      : [];
    const fresh = donorIds.filter((d) => !already.some((a) => a.funderId === d.funderId));
    if (fresh.length) {
      await tx.insert(funderGrantees).values(
        fresh.map((d) => ({
          funderId: d.funderId,
          name: input.ngoName,
          fy: input.fy,
          amount: d.amount,
          sourceLabel: input.sourceLabel,
          sourceUrl: input.sourceUrl,
          donorListId: list!.id,
          createdBy: userId,
        })),
      );
    }
    return { id: list!.id, donors: donorIds.length, created: created.length, alreadyRecorded: already.length, funderIds: donorIds.map((d) => d.funderId) };
  });
  await rescoreFunders(result.funderIds);
  return result;
}

/**
 * Removes a donor list and what it recorded. Funders it added are removed too, unless something
 * else now refers to them (CSR data, another NGO, a pursuit, a call or notes someone wrote).
 */
export async function removeDonorList(id: string) {
  const out = await db.transaction(async (tx) => {
    const [list] = await tx.select().from(donorLists).where(eq(donorLists.id, id));
    if (!list) return null;
    const touched = (await tx.select({ funderId: funderGrantees.funderId }).from(funderGrantees).where(eq(funderGrantees.donorListId, id))).map(
      (r) => r.funderId,
    );
    await tx.delete(donorLists).where(eq(donorLists.id, id));
    let removed: string[] = [];
    if (list.createdFunderIds.length) {
      const rows = await tx.execute<{ id: string }>(sql`
        delete from funders f
        where f.id in (${sql.join(
          list.createdFunderIds.map((fid) => sql`${fid}::uuid`),
          sql`, `,
        )})
          and f.notes is null and f.warm_path is null and f.website is null
          and not exists (select 1 from csr_years y where y.funder_id = f.id)
          and not exists (select 1 from funder_grantees g where g.funder_id = f.id)
          and not exists (select 1 from pursuits p where p.funder_id = f.id)
          and not exists (select 1 from opportunities o where o.funder_id = f.id)
        returning f.id`);
      removed = rows.map((r) => r.id);
    }
    return { list, removed: removed.length, rescore: touched.filter((fid) => !removed.includes(fid)) };
  });
  if (out?.rescore.length) await rescoreFunders(out.rescore);
  return out;
}
