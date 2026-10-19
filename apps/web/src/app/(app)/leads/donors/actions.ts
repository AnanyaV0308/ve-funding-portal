"use server";

import { createHash } from "node:crypto";
import { type DonorProblem, matchPeers, normaliseFy } from "@ve/core";
import { auditLog, db, getFitSettings } from "@ve/db";
import { previewDonorList, removeDonorList, saveDonorList } from "@ve/ingest";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NotAllowedError, requirePermission } from "@/lib/authz";

export type PreviewRow = {
  line: number;
  name: string;
  amount: number | null;
  match: "cin" | "name" | "new";
  funder: { id: string; name: string } | null;
};

export type DonorFormState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  preview?: { checked: string; ngoName: string; onPeerList: boolean; rows: PreviewRow[]; problems: DonorProblem[] };
} | null;

/** Who can be added from a donor list when the portal doesn't know them yet. */
const NEW_TYPES = ["company", "foundation", "hni"] as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const submitted = (fd: FormData) => Object.fromEntries([...fd].filter((e): e is [string, string] => typeof e[1] === "string"));

const input = z
  .object({
    ngo: z.string().min(1, "Choose the NGO whose donors these are"),
    ngoOther: z.preprocess(blank, z.string().trim().max(200).optional()),
    fy: z.preprocess(blank, z.string().optional()).transform((v, ctx) => {
      if (!v) return null;
      const fy = normaliseFy(v);
      if (!fy) ctx.addIssue({ code: "custom", message: "Write a year like 2024-25" });
      return fy;
    }),
    sourceLabel: z.string().trim().min(1, "Say where the list comes from, e.g. “Saksham annual report 2024-25”").max(300),
    sourceUrl: z.preprocess(
      blank,
      z
        .string()
        .trim()
        .max(1000)
        .refine((v) => /^https?:\/\/\S+$/i.test(v), "Paste the full link, starting with https://")
        .optional(),
    ),
    newFunderType: z.enum(NEW_TYPES, { message: "Choose what new names are added as" }),
    donors: z.string().trim().min(1, "Paste at least one donor, one per line").max(60_000, "That's too long. Split it into two lists."),
  })
  .superRefine((v, ctx) => {
    if (v.ngo === "__other" && !v.ngoOther) ctx.addIssue({ code: "custom", path: ["ngoOther"], message: "Give the NGO's name" });
  });

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** The fingerprint of what was checked, so Save only saves the list the person saw matched. */
const fingerprint = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);

export async function checkDonorList(_prev: DonorFormState, formData: FormData): Promise<DonorFormState> {
  let user;
  try {
    user = await requirePermission("leads:edit");
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, message: e.message };
    throw e;
  }
  const values = submitted(formData);
  const parsed = input.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Some fields need fixing.", fieldErrors: fieldErrors(parsed.error), values };
  const v = parsed.data;
  const ngoName = v.ngo === "__other" ? v.ngoOther! : v.ngo;

  const preview = await previewDonorList(v.donors);
  if (!preview.matches.length) {
    return { ok: false, message: "Some fields need fixing.", fieldErrors: { donors: "No donor names found. Put one donor on each line." }, values };
  }
  const checked = fingerprint([ngoName, v.fy, v.newFunderType, v.donors, preview.matches.map((m) => [m.match, m.funder?.id])]);

  if (formData.get("intent") === "save" && formData.get("checked") === checked) {
    const saved = await saveDonorList(
      { ngoName, fy: v.fy, sourceLabel: v.sourceLabel, sourceUrl: v.sourceUrl ?? null, newFunderType: v.newFunderType, text: v.donors },
      user.id,
    );
    await db.insert(auditLog).values({
      actorId: user.id,
      action: "donor_list.added",
      targetType: "donor_list",
      targetId: saved.id,
      detail: { ngoName, donors: saved.donors, created: saved.created },
    });
    revalidatePath("/leads");
    revalidatePath("/");
    redirect(`/leads/donors?added=${saved.id}`);
  }

  const { peerNgos } = await getFitSettings();
  return {
    ok: true,
    message:
      formData.get("intent") === "save"
        ? "The list changed after you checked it. Look over the new matches below, then save."
        : "Look over the matches below, then save the list.",
    values: { ...values, checked },
    preview: {
      checked,
      ngoName,
      onPeerList: matchPeers([ngoName], peerNgos).length > 0,
      rows: preview.matches.map((m) => ({
        line: m.line,
        name: m.name,
        amount: m.amount,
        match: m.match,
        funder: m.funder ? { id: m.funder.id, name: m.funder.name } : null,
      })),
      problems: preview.problems,
    },
  };
}

export async function deleteDonorList(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("id"));
  const out = await removeDonorList(id);
  if (out) {
    await db.insert(auditLog).values({
      actorId: user.id,
      action: "donor_list.removed",
      targetType: "donor_list",
      targetId: id,
      detail: { ngoName: out.list.ngoName, removedFunders: out.removed },
    });
  }
  revalidatePath("/leads");
  revalidatePath("/");
  redirect(`/leads/donors?removed=${out ? out.removed : 0}`);
}
