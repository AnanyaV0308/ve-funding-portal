import { createHash } from "node:crypto";
import { checkAnnualReport, companiesToFollow, companyCheckDue, companyReportLabel, dueReportFy, partnersToAdd } from "@ve/core";
import { companyReports, db, funderGrantees, funders, getCompaniesFollowed } from "@ve/db";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { readStoredBytes } from "./files";
import { findCompanyReport } from "./find-company-report";
import { pageTexts, ReadError, readerConfigured } from "./pdf";
import { readCompanyReportPdf } from "./read-company-report";
import { rescoreFunders } from "./score";
import { FetchError, fetchPublic, looksLikePdf } from "./web";

const MAX_REPORT_BYTES = 150e6;
/** Companies looked for and reports read in one run, so a first run over a hundred companies is spread out. */
const CHECKS_PER_RUN = 2;
const READS_PER_RUN = 2;

type Company = { id: string; name: string; cin: string | null };
type Report = typeof companyReports.$inferSelect;

const known = (e: unknown): e is FetchError | ReadError => e instanceof FetchError || e instanceof ReadError;

/** The listed companies whose reports the portal looks for: the best-fitting ones, up to the number in Settings. */
export async function followedCompanies() {
  const limit = await getCompaniesFollowed();
  const all = await db
    .select({
      id: funders.id,
      name: funders.name,
      cin: funders.cin,
      isForeign: funders.isForeign,
      eligibility: funders.eligibility,
      fitScore: funders.fitScore,
      reportCheckedAt: funders.reportCheckedAt,
      reportCheckRequestedAt: funders.reportCheckRequestedAt,
      reportCheckResult: funders.reportCheckResult,
    })
    .from(funders)
    .where(eq(funders.type, "company"));
  return companiesToFollow(all, limit);
}

/**
 * Reads a report's CSR section and puts what it says to use: the NGOs it names become "NGOs it
 * funds", replacing what an earlier copy of the same year's report added, and the company is
 * scored again. Returns what happened, in words.
 */
async function readAndApply(report: Report, company: Company, pdf: Uint8Array, texts: string[], spent = { inputTokens: 0, outputTokens: 0 }) {
  const reading = await readCompanyReportPdf(pdf, texts, { companyName: company.name, fy: report.fy });
  const fy = report.fy ?? reading.fy;
  const label = companyReportLabel(company.name, fy);
  const { add, leftOut } = reading.hasCsr
    ? partnersToAdd(reading.partners, { companyName: company.name, pageTexts: reading.readText })
    : { add: [], leftOut: [] };
  await db.transaction(async (tx) => {
    await tx
      .update(companyReports)
      .set({
        status: reading.hasCsr ? "read" : "no_csr",
        fy,
        title: label,
        obligation: reading.obligation,
        spent: reading.spent,
        unspent: reading.unspent,
        policyUrl: reading.policyUrl,
        partners: reading.partners,
        leftOut,
        disabilityWork: reading.disabilityWork,
        pages: reading.pages,
        pagesRead: reading.pagesRead,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        model: reading.model,
        inputTokens: reading.inputTokens + spent.inputTokens,
        outputTokens: reading.outputTokens + spent.outputTokens,
        error: null,
        readAt: new Date(),
      })
      .where(eq(companyReports.id, report.id));
    const sameYear = await tx
      .select({ id: companyReports.id })
      .from(companyReports)
      .where(and(eq(companyReports.funderId, company.id), fy ? eq(companyReports.fy, fy) : isNull(companyReports.fy)));
    await tx.delete(funderGrantees).where(
      inArray(
        funderGrantees.companyReportId,
        sameYear.map((r) => r.id),
      ),
    );
    if (add.length) {
      await tx.insert(funderGrantees).values(
        add.map((p) => ({
          funderId: company.id,
          name: p.name,
          fy,
          amount: p.amountInr,
          sourceLabel: p.page ? `${label}, page ${p.page}` : label,
          sourceUrl: report.url ? `${report.url}${p.page ? `#page=${p.page}` : ""}` : null,
          companyReportId: report.id,
        })),
      );
    }
  });
  await rescoreFunders([company.id]);
  if (!reading.hasCsr) return "Read the report, but it has no CSR section.";
  return `Read its ${fy ? `${fy} ` : ""}annual report: ${add.length === 1 ? "1 NGO" : `${add.length} NGOs`} it funds.`;
}

/**
 * Looks on the web for a company's newest annual report, and reads it if it's one the portal
 * hasn't seen. Notes what it found on the company.
 */
export async function lookForReport(company: Company) {
  const startedAt = new Date();
  let message: string;
  try {
    const have = await db.select({ url: companyReports.url, fy: companyReports.fy }).from(companyReports).where(eq(companyReports.funderId, company.id));
    const found = await findCompanyReport({ name: company.name, cin: company.cin, fy: dueReportFy(startedAt) });
    const spent = { inputTokens: found.inputTokens, outputTokens: found.outputTokens };
    console.log(`[company-reports] ${company.name}: ${found.searches} searches, ${found.inputTokens} input and ${found.outputTokens} output tokens to find`);
    if (!found.url) message = "Couldn't find its annual report on its website.";
    else if (have.some((r) => r.url === found.url)) message = "No newer report than the one already found.";
    else {
      const file = await fetchPublic(found.url, MAX_REPORT_BYTES, { robots: true });
      if (!looksLikePdf(file.body)) throw new ReadError("The link found doesn't lead to a PDF.");
      const { texts } = await pageTexts(file.body);
      const check = checkAnnualReport(texts, company.name);
      if (!check.ok) throw new ReadError(`The PDF found isn't its annual report. ${check.reason}`);
      if (check.fy && have.some((r) => r.fy && r.fy >= check.fy!)) message = `Found its ${check.fy} report; the portal already has that year's.`;
      else {
        const [report] = await db
          .insert(companyReports)
          .values({
            funderId: company.id,
            origin: "search",
            url: found.url,
            title: companyReportLabel(company.name, check.fy),
            fy: check.fy,
            status: "reading",
            readAt: new Date(),
          })
          .onConflictDoNothing()
          .returning();
        if (!report) message = "No newer report than the one already found.";
        else {
          try {
            message = await readAndApply(report, company, file.body, texts, spent);
          } catch (e) {
            if (!known(e)) console.error(e);
            const error = known(e) ? e.message : "Something went wrong reading this report.";
            await db
              .update(companyReports)
              .set({ status: "failed", error, readAt: new Date(), ...spent })
              .where(eq(companyReports.id, report.id));
            message = `Found its annual report, but it couldn't be read: ${error}`;
          }
        }
      }
    }
  } catch (e) {
    if (!known(e)) console.error(e);
    message = known(e) ? e.message : "Something went wrong looking for its report.";
  }
  await db
    .update(funders)
    .set({
      reportCheckedAt: startedAt,
      reportCheckResult: message,
      // A request made while this look ran waits for the next run.
      reportCheckRequestedAt: sql`case when ${funders.reportCheckRequestedAt} <= ${startedAt.toISOString()}::timestamptz then null else ${funders.reportCheckRequestedAt} end`,
    })
    .where(eq(funders.id, company.id));
  return message;
}

/** Companies to look for now: anyone asked for, then followed companies whose month has come round. */
async function dueCompanies(today: Date): Promise<Company[]> {
  const requested = await db
    .select({ id: funders.id, name: funders.name, cin: funders.cin })
    .from(funders)
    .where(isNotNull(funders.reportCheckRequestedAt))
    .orderBy(funders.reportCheckRequestedAt);
  const followed = await followedCompanies();
  const ids = followed.map((f) => f.id);
  const fys = ids.length
    ? await db.select({ funderId: companyReports.funderId, fy: companyReports.fy }).from(companyReports).where(inArray(companyReports.funderId, ids))
    : [];
  const due = followed.filter((f) =>
    companyCheckDue(
      {
        reportFys: fys.filter((r) => r.funderId === f.id && r.fy).map((r) => r.fy!),
        checkedAt: f.reportCheckedAt,
        checkRequestedAt: f.reportCheckRequestedAt,
      },
      today,
    ),
  );
  const seen = new Set<string>();
  return [...requested, ...due].filter((c) => !seen.has(c.id) && seen.add(c.id));
}

/**
 * Looks for the reports that are due, a few companies per run. Without an Anthropic API key
 * nothing can be looked for, so anyone who asked is told so.
 */
export async function checkDueCompanies(log: (message: string) => void = console.log, limit = CHECKS_PER_RUN) {
  if (!readerConfigured()) {
    await db
      .update(funders)
      .set({ reportCheckRequestedAt: null, reportCheckResult: "Looking for annual reports needs the Anthropic API key, which isn't set up yet." })
      .where(isNotNull(funders.reportCheckRequestedAt));
    return 0;
  }
  const due = (await dueCompanies(new Date())).slice(0, limit);
  for (const company of due) log(`[company-reports] ${company.name}: ${await lookForReport(company)}`);
  return due.length;
}

/** Takes the next report someone gave a link to or uploaded, so two runs never read the same one. */
async function claimNextReport() {
  // A read that was cut off (the worker restarted) is tried again after an hour.
  await db
    .update(companyReports)
    .set({ status: "waiting" })
    .where(and(eq(companyReports.status, "reading"), lt(companyReports.readAt, new Date(Date.now() - 3_600_000))));
  const rows = await db.execute<{ id: string }>(sql`
    update company_reports set status = 'reading', read_at = now()
    where id = (select id from company_reports where status = 'waiting' order by found_at limit 1 for update skip locked)
    returning id`);
  const id = rows[0]?.id;
  return id
    ? db.query.companyReports.findFirst({ where: eq(companyReports.id, id), with: { funder: { columns: { id: true, name: true, cin: true } } } })
    : undefined;
}

async function readWaitingReport(report: NonNullable<Awaited<ReturnType<typeof claimNextReport>>>) {
  try {
    const pdf = report.fileKey ? await readStoredBytes(report.fileKey) : (await fetchPublic(report.url!, MAX_REPORT_BYTES, { robots: true })).body;
    if (!looksLikePdf(pdf)) throw new ReadError(report.fileKey ? "The file isn't a PDF." : "The link doesn't lead to a PDF.");
    const { texts } = await pageTexts(pdf);
    const check = checkAnnualReport(texts, report.funder.name);
    if (!check.ok) throw new ReadError(`This doesn't look like ${report.funder.name}'s annual report. ${check.reason}`);
    return await readAndApply({ ...report, fy: report.fy ?? check.fy }, report.funder, pdf, texts);
  } catch (e) {
    if (!known(e)) console.error(e);
    const error = known(e) ? e.message : "Something went wrong reading this report.";
    await db.update(companyReports).set({ status: "failed", error, readAt: new Date() }).where(eq(companyReports.id, report.id));
    return `couldn't be read: ${error}`;
  }
}

/** Reads reports people gave, a few per run. Does nothing until an Anthropic API key is set. */
export async function readWaitingCompanyReports(log: (message: string) => void = console.log) {
  if (!readerConfigured()) return 0;
  let read = 0;
  for (let report = await claimNextReport(); report; report = read < READS_PER_RUN ? await claimNextReport() : undefined) {
    read++;
    log(`[company-reports] ${report.funder.name}, ${report.title}: ${await readWaitingReport(report)}`);
  }
  return read;
}

/** What the worker runs every minute. */
export async function runCompanyReports(log: (message: string) => void = console.log) {
  await readWaitingCompanyReports(log);
  await checkDueCompanies(log);
}

/** Asks the worker to look for a company's newest report on its next run. */
export async function requestReportCheck(funderId: string) {
  await db.update(funders).set({ reportCheckRequestedAt: new Date() }).where(eq(funders.id, funderId));
}

/** Queues a report someone gave the link to or uploaded. Returns null if that link is already known. */
export async function addCompanyReport(
  funderId: string,
  file: { url: string; fileKey?: never; fileName?: never } | { fileKey: string; fileName: string; url?: never },
  userId: string,
) {
  const company = await db.query.funders.findFirst({ where: eq(funders.id, funderId), columns: { name: true } });
  if (!company) return null;
  const [row] = await db
    .insert(companyReports)
    .values({
      funderId,
      origin: file.url ? "link" : "upload",
      url: file.url ?? null,
      fileKey: file.fileKey ?? null,
      title: file.fileName ?? companyReportLabel(company.name, null),
      createdBy: userId,
    })
    .onConflictDoNothing()
    .returning({ id: companyReports.id });
  return row ?? null;
}

/** Puts a report that couldn't be read back in the queue; a report on the web is fetched again from its link. */
export async function retryCompanyReport(id: string) {
  const rows = await db
    .update(companyReports)
    .set({ status: "waiting", error: null })
    .where(and(eq(companyReports.id, id), eq(companyReports.status, "failed")))
    .returning({ id: companyReports.id });
  return rows.length > 0;
}

/** Removes a report and the NGOs it added, then scores the company again. */
export async function removeCompanyReport(id: string) {
  const [row] = await db.delete(companyReports).where(eq(companyReports.id, id)).returning({ funderId: companyReports.funderId });
  if (row) await rescoreFunders([row.funderId]);
  return row ?? null;
}
