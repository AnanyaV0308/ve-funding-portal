"use server";

import { MAX_COMPANIES_FOLLOWED, onExchangeSite } from "@ve/core";
import { auditLog, companyReports, db, saveCompaniesFollowed } from "@ve/db";
import { addCompanyReport, removeCompanyReport, requestReportCheck, retryCompanyReport } from "@ve/ingest";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type CurrentUser, NotAllowedError, requirePermission } from "@/lib/authz";
import { createUploadUrl, isValidKey, MAX_UPLOAD_BYTES, newKey, storedSize } from "@/lib/storage";

export type ReportFormState = { ok: boolean; message: string; values?: { url: string } } | null;

async function editor(): Promise<{ user: CurrentUser } | { error: { ok: false; message: string } }> {
  try {
    return { user: await requirePermission("leads:edit") };
  } catch (e) {
    if (e instanceof NotAllowedError) return { error: { ok: false, message: e.message } };
    throw e;
  }
}

const EXCHANGE_MESSAGE = "The portal doesn't fetch from NSE or BSE, whose terms don't allow it. Download the PDF from there and upload it instead.";

function refresh(funderId: string) {
  revalidatePath(`/funders/${funderId}`);
  revalidatePath("/leads/company-reports");
}

/** Asks the worker to look for a company's newest annual report on its next run. */
export async function lookForReport(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("funderId"));
  await requestReportCheck(id);
  await db.insert(auditLog).values({ actorId: user.id, action: "company_report.look_requested", targetType: "funder", targetId: id });
  refresh(id);
}

const linkInput = z.object({
  funderId: z.uuid(),
  url: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => /^https?:\/\/\S+$/i.test(v), "Paste the full link, starting with https://"),
});

/** Queues a report someone has the link to, such as one on the company's investor page. */
export async function addReportLink(_prev: ReportFormState, formData: FormData): Promise<ReportFormState> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const url = String(formData.get("url") ?? "");
  const parsed = linkInput.safeParse({ funderId: formData.get("funderId"), url });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message, values: { url } };
  if (onExchangeSite(new URL(parsed.data.url))) return { ok: false, message: EXCHANGE_MESSAGE, values: { url } };
  const row = await addCompanyReport(parsed.data.funderId, { url: parsed.data.url }, auth.user.id);
  if (!row) return { ok: false, message: "The portal already has this report.", values: { url } };
  await db.insert(auditLog).values({
    actorId: auth.user.id,
    action: "company_report.link_added",
    targetType: "funder",
    targetId: parsed.data.funderId,
    detail: { url: parsed.data.url },
  });
  refresh(parsed.data.funderId);
  return { ok: true, message: "Added. The portal will read it in the next few minutes.", values: { url: "" } };
}

const startInput = z.object({ funderId: z.uuid(), fileName: z.string().min(1).max(300), size: z.number().int().positive() });

/** Step one of an upload: a signed link the browser sends the PDF to. */
export async function startReportUpload(
  input: z.infer<typeof startInput>,
): Promise<{ ok: false; message: string } | { ok: true; key: string; uploadUrl: string }> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = startInput.safeParse(input);
  if (!parsed.success || !/\.pdf$/i.test(parsed.data.fileName)) return { ok: false, message: "Choose the annual report's PDF." };
  if (parsed.data.size > MAX_UPLOAD_BYTES) return { ok: false, message: "Files can be up to 50 MB. For a larger report, paste its link instead." };
  const key = newKey(parsed.data.fileName);
  return { ok: true, key, uploadUrl: createUploadUrl(key) };
}

const recordInput = z.object({ funderId: z.uuid(), key: z.string(), fileName: z.string().min(1).max(300) });

/** Step two: record the uploaded PDF so the worker reads it. */
export async function recordReportUpload(input: z.infer<typeof recordInput>): Promise<{ ok: boolean; message: string }> {
  const auth = await editor();
  if ("error" in auth) return auth.error;
  const parsed = recordInput.safeParse(input);
  if (!parsed.success || !isValidKey(parsed.data.key)) return { ok: false, message: "That upload couldn't be saved. Try again." };
  if ((await storedSize(parsed.data.key)) === null) return { ok: false, message: "The file didn't finish uploading. Try again." };
  const row = await addCompanyReport(parsed.data.funderId, { fileKey: parsed.data.key, fileName: parsed.data.fileName }, auth.user.id);
  if (!row) return { ok: false, message: "That company no longer exists." };
  await db.insert(auditLog).values({
    actorId: auth.user.id,
    action: "company_report.uploaded",
    targetType: "funder",
    targetId: parsed.data.funderId,
    detail: { fileName: parsed.data.fileName },
  });
  refresh(parsed.data.funderId);
  return { ok: true, message: "Uploaded. The portal will read it in the next few minutes." };
}

async function reportFunder(id: string) {
  const row = await db.query.companyReports.findFirst({ where: eq(companyReports.id, id), columns: { funderId: true, title: true } });
  return row ?? null;
}

/** Puts a report that couldn't be read back in the queue. */
export async function retryReportRead(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("id"));
  const report = await reportFunder(id);
  if (report && (await retryCompanyReport(id))) {
    await db.insert(auditLog).values({ actorId: user.id, action: "company_report.retried", targetType: "company_report", targetId: id });
    refresh(report.funderId);
  }
}

/** Removes a report and the NGOs it added. */
export async function removeReport(formData: FormData): Promise<void> {
  const user = await requirePermission("leads:edit");
  const id = z.uuid().parse(formData.get("id"));
  const report = await reportFunder(id);
  if (!report) return;
  await removeCompanyReport(id);
  await db.insert(auditLog).values({
    actorId: user.id,
    action: "company_report.removed",
    targetType: "funder",
    targetId: report.funderId,
    detail: { title: report.title },
  });
  refresh(report.funderId);
  revalidatePath("/leads");
}

export type FollowFormState = { ok: boolean; message: string; value?: string } | null;

/** How many of the best-fitting listed companies the portal follows. Admins only, since each look costs money. */
export async function saveFollowed(_prev: FollowFormState, formData: FormData): Promise<FollowFormState> {
  let user;
  try {
    user = await requirePermission("settings:manage");
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, message: e.message };
    throw e;
  }
  const value = String(formData.get("count") ?? "").trim();
  const n = Number(value);
  if (!/^\d+$/.test(value) || n > MAX_COMPANIES_FOLLOWED) {
    return { ok: false, message: `Enter a whole number from 0 to ${MAX_COMPANIES_FOLLOWED}.`, value };
  }
  await saveCompaniesFollowed(n, user.id);
  await db.insert(auditLog).values({ actorId: user.id, action: "settings.companies_followed", targetType: "app_settings", detail: { count: n } });
  revalidatePath("/leads/company-reports");
  return {
    ok: true,
    message: n ? `Saved. The portal follows the ${n} best-fitting listed companies.` : "Saved. The portal won't look for reports on its own.",
    value,
  };
}
