"use server";

import { auditLog, db, getFitSettings, peerSources } from "@ve/db";
import { addReportDonors, dismissReport, retryReport } from "@ve/ingest";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NotAllowedError, requirePermission } from "@/lib/authz";

export type SourceFormState = { ok: boolean; message: string; values?: { url: string } } | null;

const sourceInput = z.object({
  ngo: z.string().min(1),
  url: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => /^https?:\/\/\S+$/i.test(v), "Paste the full link, starting with https://"),
});

/** Sets the page where the portal looks for an NGO's annual reports, and asks for a check. */
export async function saveSource(_prev: SourceFormState, formData: FormData): Promise<SourceFormState> {
  let user;
  try {
    user = await requirePermission("leads:edit");
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, message: e.message };
    throw e;
  }
  const url = String(formData.get("url") ?? "");
  const parsed = sourceInput.safeParse({ ngo: formData.get("ngo"), url });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message, values: { url } };
  const { peerNgos } = await getFitSettings();
  if (!peerNgos.includes(parsed.data.ngo)) return { ok: false, message: "That NGO isn't on VE's peer list.", values: { url } };

  const now = new Date();
  const [row] = await db
    .insert(peerSources)
    .values({ ngoName: parsed.data.ngo, url: parsed.data.url, checkRequestedAt: now, updatedBy: user.id })
    .onConflictDoUpdate({ target: peerSources.ngoName, set: { url: parsed.data.url, checkRequestedAt: now, updatedAt: now, updatedBy: user.id } })
    .returning({ id: peerSources.id });
  await db.insert(auditLog).values({
    actorId: user.id,
    action: "peer_source.saved",
    targetType: "peer_source",
    targetId: row!.id,
    detail: { ngoName: parsed.data.ngo, url: parsed.data.url },
  });
  revalidatePath("/leads/donors");
  return { ok: true, message: "Saved. The portal will look at this page in the next few minutes.", values: { url: parsed.data.url } };
}

/** Asks the worker to look at an NGO's page again soon, rather than waiting for the monthly check. */
export async function requestCheck(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("id"));
  const [source] = await db
    .update(peerSources)
    .set({ checkRequestedAt: sql`now()` })
    .where(eq(peerSources.id, id))
    .returning({ ngoName: peerSources.ngoName });
  if (source)
    await db.insert(auditLog).values({ actorId: user.id, action: "peer_source.check_requested", targetType: "peer_source", targetId: id, detail: {} });
  revalidatePath("/leads/donors");
  redirect(`/leads/donors?checking=${encodeURIComponent(source?.ngoName ?? "")}#where-heading`);
}

/** Adds the donors read from a report: new ones become funders, and every company is scored again. */
export async function addReport(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("id"));
  const saved = await addReportDonors(id, user.id);
  if (!saved) redirect(`/leads/donors/reports/${id}`);
  await db.insert(auditLog).values({
    actorId: user.id,
    action: "donor_list.added",
    targetType: "donor_list",
    targetId: saved.id,
    detail: { ngoName: saved.ngoName, donors: saved.donors, created: saved.created, peerReportId: id },
  });
  revalidatePath("/leads");
  revalidatePath("/");
  redirect(`/leads/donors?added=${saved.id}`);
}

export async function dismissPeerReport(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("id"));
  if (await dismissReport(id, user.id)) {
    await db.insert(auditLog).values({ actorId: user.id, action: "peer_report.dismissed", targetType: "peer_report", targetId: id, detail: {} });
  }
  revalidatePath("/leads/donors");
  redirect("/leads/donors?dismissed=1");
}

export async function retryPeerReport(formData: FormData): Promise<void> {
  await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("id"));
  await retryReport(id);
  revalidatePath("/leads/donors");
  redirect(`/leads/donors/reports/${id}?retry=1`);
}
