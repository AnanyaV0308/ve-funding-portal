import { createHash } from "node:crypto";
import { donorsToAdd, findReportLinks, PEER_CHECK_DAYS, type ReportLink, reportFy, reportsToRead } from "@ve/core";
import { db, peerReports, peerSources } from "@ve/db";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { saveDonorList } from "./donors";
import { ReadError, readerConfigured, readReportPdf } from "./read-report";
import { FetchError, fetchPublic, looksLikePdf } from "./web";

const MAX_PAGE_BYTES = 5e6;
const MAX_REPORT_BYTES = 150e6;
/** Reports read in one run, so a first run over every NGO is spread out. */
const READS_PER_RUN = 3;

type Source = typeof peerSources.$inferSelect;

const html = (body: Uint8Array) => new TextDecoder().decode(body);

/** The annual reports linked from an NGO's page, and from the report pages it links to. */
export async function findReports(pageUrl: string): Promise<ReportLink[]> {
  const path = decodeURIComponent(new URL(pageUrl).pathname);
  if (/\.pdf$/i.test(path)) return [{ url: pageUrl, text: "Annual report", fy: reportFy(path.split("/").pop()!) }];
  const page = await fetchPublic(pageUrl, MAX_PAGE_BYTES);
  const first = findReportLinks(html(page.body), page.url);
  const reports = [...first.reports];
  for (const next of first.pages) {
    try {
      const p = await fetchPublic(next, MAX_PAGE_BYTES);
      if (p.type.includes("html")) reports.push(...findReportLinks(html(p.body), p.url).reports);
    } catch (e) {
      // A broken link elsewhere on the NGO's site doesn't stop the check.
      if (!(e instanceof FetchError)) throw e;
    }
  }
  return reports;
}

/** Looks at one NGO's page for reports the portal hasn't seen, and notes what it found. */
export async function checkPeerSource(source: Source) {
  const startedAt = new Date();
  let result: { ok: boolean; message: string; added: number };
  try {
    const found = await findReports(source.url);
    const known = await db.select({ url: peerReports.url }).from(peerReports).where(eq(peerReports.sourceId, source.id));
    const fresh = reportsToRead(
      found,
      known.map((k) => k.url),
    );
    if (fresh.length) {
      await db
        .insert(peerReports)
        .values(fresh.map((r) => ({ sourceId: source.id, url: r.url, title: r.text.slice(0, 300) || "Annual report", fy: r.fy })))
        .onConflictDoNothing();
    }
    result = {
      ok: found.length > 0,
      added: fresh.length,
      message: !found.length
        ? "No annual reports found on this page."
        : fresh.length
          ? `Found ${fresh.length} new ${fresh.length === 1 ? "report" : "reports"}.`
          : "No new reports.",
    };
  } catch (e) {
    if (!(e instanceof FetchError)) console.error(e);
    result = { ok: false, added: 0, message: e instanceof FetchError ? e.message : "Something went wrong checking this page." };
  }
  await db
    .update(peerSources)
    .set({
      lastCheckedAt: startedAt,
      lastOk: result.ok,
      lastResult: result.message,
      // A request made while this check ran waits for the next run.
      checkRequestedAt: sql`case when ${peerSources.checkRequestedAt} <= ${startedAt.toISOString()}::timestamptz then null else ${peerSources.checkRequestedAt} end`,
    })
    .where(eq(peerSources.id, source.id));
  return result;
}

/**
 * Checks each NGO's page that hasn't been checked for a month, or that someone asked to check now.
 * With `onlyNgo`, checks just that NGO's page, due or not.
 */
export async function checkDueSources(log: (message: string) => void = console.log, onlyNgo?: string) {
  const cutoff = new Date(Date.now() - PEER_CHECK_DAYS * 86_400_000);
  const due = await db
    .select()
    .from(peerSources)
    .where(
      onlyNgo
        ? eq(peerSources.ngoName, onlyNgo)
        : or(isNotNull(peerSources.checkRequestedAt), isNull(peerSources.lastCheckedAt), lt(peerSources.lastCheckedAt, cutoff)),
    );
  for (const source of due) {
    const r = await checkPeerSource(source);
    log(`[peer-reports] ${source.ngoName}: ${r.message}`);
  }
  return due.length;
}

/** Takes the next report waiting to be read, so two runs never read the same one. */
async function claimNextReport() {
  // A read that was cut off (the worker restarted) is tried again after an hour.
  await db
    .update(peerReports)
    .set({ status: "waiting" })
    .where(and(eq(peerReports.status, "reading"), lt(peerReports.readAt, new Date(Date.now() - 3_600_000))));
  const rows = await db.execute<{ id: string }>(sql`
    update peer_reports set status = 'reading', read_at = now()
    where id = (select id from peer_reports where status = 'waiting' order by found_at limit 1 for update skip locked)
    returning id`);
  const id = rows[0]?.id;
  return id ? db.query.peerReports.findFirst({ where: eq(peerReports.id, id), with: { source: true } }) : undefined;
}

/** Downloads and reads one report, then records what it found or why it couldn't be read. */
async function readReport(report: NonNullable<Awaited<ReturnType<typeof claimNextReport>>>) {
  try {
    const file = await fetchPublic(report.url, MAX_REPORT_BYTES);
    if (!looksLikePdf(file.body)) throw new ReadError("The link doesn't lead to a PDF.");
    const reading = await readReportPdf(file.body, { ngoName: report.source.ngoName, fy: report.fy });
    await db
      .update(peerReports)
      .set({
        status: reading.donors.length ? "ready" : "no_donors",
        donors: reading.donors,
        pages: reading.pages,
        pagesRead: reading.pagesRead,
        sha256: createHash("sha256").update(file.body).digest("hex"),
        model: reading.model,
        inputTokens: reading.inputTokens,
        outputTokens: reading.outputTokens,
        error: null,
        readAt: new Date(),
      })
      .where(eq(peerReports.id, report.id));
    return reading.donors.length ? `${reading.donors.length} donors read` : "no donors in it";
  } catch (e) {
    const known = e instanceof FetchError || e instanceof ReadError;
    if (!known) console.error(e);
    const error = known ? e.message : "Something went wrong reading this report.";
    await db.update(peerReports).set({ status: "failed", error, readAt: new Date() }).where(eq(peerReports.id, report.id));
    return `couldn't be read: ${error}`;
  }
}

/** Reads reports waiting to be read, a few per run. Does nothing until an Anthropic API key is set. */
export async function readWaitingReports(log: (message: string) => void = console.log) {
  if (!readerConfigured()) return 0;
  let read = 0;
  for (let report = await claimNextReport(); report; report = read < READS_PER_RUN ? await claimNextReport() : undefined) {
    read++;
    log(`[peer-reports] ${report.source.ngoName}, ${report.title}: ${await readReport(report)}`);
  }
  return read;
}

/** What the worker runs: checks the pages that are due, then reads what's waiting. */
export async function runPeerReports(log: (message: string) => void = console.log) {
  await checkDueSources(log);
  await readWaitingReports(log);
}

/** The label a report's donor list gets, e.g. "Saksham annual report 2023-24". */
export const reportLabel = (ngoName: string, fy: string | null) => `${ngoName} annual report${fy ? ` ${fy}` : ""}`;

/**
 * Adds the donors read from a report, the same way as a list someone pasted. Returns null when
 * the report isn't ready, has no donors the portal adds, or its donors were already added.
 */
export async function addReportDonors(id: string, userId: string) {
  const report = await db.query.peerReports.findFirst({ where: eq(peerReports.id, id), with: { source: true, donorLists: { columns: { id: true } } } });
  if (!report || report.donorLists.length || (report.status !== "ready" && report.status !== "dismissed")) return null;
  const { entries } = donorsToAdd(report.donors);
  if (!entries.length) return null;
  let saved;
  try {
    saved = await saveDonorList(
      {
        ngoName: report.source.ngoName,
        fy: report.fy,
        sourceLabel: reportLabel(report.source.ngoName, report.fy),
        sourceUrl: report.url,
        newFunderType: "company",
        entries,
        peerReportId: report.id,
      },
      userId,
    );
  } catch (e) {
    // Someone else added this report's donors a moment ago.
    if ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") return null;
    throw e;
  }
  await db.update(peerReports).set({ status: "ready", decidedAt: new Date(), decidedBy: userId }).where(eq(peerReports.id, id));
  return { ...saved, ngoName: report.source.ngoName };
}

/** Marks a report as not to be added. Its donors can still be added later. */
export async function dismissReport(id: string, userId: string) {
  const rows = await db
    .update(peerReports)
    .set({ status: "dismissed", decidedAt: new Date(), decidedBy: userId })
    .where(
      and(eq(peerReports.id, id), eq(peerReports.status, "ready"), sql`not exists (select 1 from donor_lists d where d.peer_report_id = ${peerReports.id})`),
    )
    .returning({ id: peerReports.id });
  return rows.length > 0;
}

/** Puts a report that couldn't be read back in the queue. */
export async function retryReport(id: string) {
  const rows = await db
    .update(peerReports)
    .set({ status: "waiting", error: null })
    .where(and(eq(peerReports.id, id), eq(peerReports.status, "failed")))
    .returning({ id: peerReports.id });
  return rows.length > 0;
}
