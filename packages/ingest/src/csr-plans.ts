import { createHash } from "node:crypto";
import { checkActionPlan, currentFy, htmlText, partnersToAdd, planCheckDue, planLabel, planPartners } from "@ve/core";
import { companyReports, csrPlans, db, funderGrantees, funders } from "@ve/db";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { followedCompanies } from "./company-reports";
import { readStoredBytes } from "./files";
import { findCsrPlan } from "./find-csr-plan";
import { pageTexts, ReadError, readerConfigured } from "./pdf";
import { readCsrPlan } from "./read-csr-plan";
import { rescoreFunders } from "./score";
import { FetchError, fetchPublic, looksLikePdf } from "./web";

const MAX_PLAN_BYTES = 30e6;
/** A web page with less text than this needs a browser to show its plan, which the portal doesn't run. */
const MIN_PAGE_TEXT = 200;
/** Companies looked at and plans read in one run, so a first run over a hundred companies is spread out. */
const CHECKS_PER_RUN = 2;
const READS_PER_RUN = 2;

type Company = { id: string; name: string; cin: string | null };
type Plan = typeof csrPlans.$inferSelect;
/** A plan as fetched: its bytes, and either the PDF with its page texts or a web page's text. */
type Opened = { body: Uint8Array; texts: string[]; doc: { pdf: Uint8Array; texts: string[] } | { pageText: string } };

const known = (e: unknown): e is FetchError | ReadError => e instanceof FetchError || e instanceof ReadError;
const sha256 = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

async function openPdf(body: Uint8Array): Promise<Opened> {
  const { texts } = await pageTexts(body);
  return { body, texts, doc: { pdf: body, texts } };
}

/** Downloads a plan from the web, as a PDF or a web page, following the site's robots.txt. */
async function openPlan(href: string): Promise<Opened> {
  const file = await fetchPublic(href, MAX_PLAN_BYTES, { robots: true });
  if (looksLikePdf(file.body)) return openPdf(file.body);
  if (!/html|text\/plain/i.test(file.type)) throw new ReadError("The link doesn't lead to a PDF or a web page.");
  const pageText = htmlText(new TextDecoder().decode(file.body));
  if (pageText.replace(/\s+/g, "").length < MIN_PAGE_TEXT) {
    throw new ReadError("The page shows almost no text without a browser, so it couldn't be read. Download the plan and upload it instead.");
  }
  return { body: file.body, texts: [pageText], doc: { pageText } };
}

async function openStored(fileKey: string): Promise<Opened> {
  const body = await readStoredBytes(fileKey);
  if (!looksLikePdf(body)) throw new ReadError("The file isn't a PDF.");
  return openPdf(body);
}

/**
 * Reads a plan's projects and puts them to use: the agencies it names become "NGOs it funds",
 * replacing what an earlier plan for the same year added, and the company is scored again.
 * Returns what happened, in words.
 */
async function readAndApply(plan: Plan, company: Company, opened: Opened, spent = { inputTokens: 0, outputTokens: 0 }) {
  const reading = await readCsrPlan(opened.doc, { companyName: company.name, fy: plan.fy });
  const fy = plan.fy ?? reading.fy;
  const label = planLabel(company.name, fy);
  const partners = planPartners(reading.projects);
  const { add, leftOut } = reading.isPlan ? partnersToAdd(partners, { companyName: company.name, pageTexts: reading.readText }) : { add: [], leftOut: [] };
  const isPdf = "pdf" in opened.doc;
  await db.transaction(async (tx) => {
    await tx
      .update(csrPlans)
      .set({
        status: reading.isPlan ? "read" : "not_plan",
        fy,
        title: label,
        budget: reading.budget,
        policyUrl: reading.policyUrl ?? plan.policyUrl,
        projects: reading.projects,
        partners,
        leftOut,
        pages: isPdf ? opened.texts.length : null,
        sha256: sha256(opened.body),
        model: reading.model,
        inputTokens: reading.inputTokens + spent.inputTokens,
        outputTokens: reading.outputTokens + spent.outputTokens,
        error: null,
        readAt: new Date(),
      })
      .where(eq(csrPlans.id, plan.id));
    const sameYear = await tx
      .select({ id: csrPlans.id })
      .from(csrPlans)
      .where(and(eq(csrPlans.funderId, company.id), fy ? eq(csrPlans.fy, fy) : isNull(csrPlans.fy)));
    await tx.delete(funderGrantees).where(inArray(funderGrantees.csrPlanId, [plan.id, ...sameYear.map((p) => p.id)]));
    if (add.length) {
      await tx.insert(funderGrantees).values(
        add.map((p) => ({
          funderId: company.id,
          name: p.name,
          fy,
          amount: p.amountInr,
          sourceLabel: p.page ? `${label}, page ${p.page}` : label,
          sourceUrl: plan.url ? `${plan.url}${isPdf && p.page ? `#page=${p.page}` : ""}` : null,
          csrPlanId: plan.id,
        })),
      );
    }
  });
  await rescoreFunders([company.id]);
  if (!reading.isPlan) return "Read it, but it isn't a CSR action plan.";
  const projects = reading.projects.length === 1 ? "1 project" : `${reading.projects.length} projects`;
  return `Read its ${fy ? `${fy} ` : ""}CSR action plan: ${projects}, ${add.length === 1 ? "1 NGO" : `${add.length} NGOs`} it funds.`;
}

/** Reads a plan, marking it failed with the reason when it can't be read. */
async function readOrFail(plan: Plan, company: Company, opened: Opened, spent?: { inputTokens: number; outputTokens: number }) {
  try {
    return { ok: true as const, message: await readAndApply(plan, company, opened, spent) };
  } catch (e) {
    if (!known(e)) console.error(e);
    const error = known(e) ? e.message : "Something went wrong reading this plan.";
    await db
      .update(csrPlans)
      .set({ status: "failed", error, readAt: new Date(), ...spent })
      .where(eq(csrPlans.id, plan.id));
    return { ok: false as const, message: error };
  }
}

/**
 * Looks at a company's CSR action plan: "find" searches its website for this year's plan and its
 * CSR policy; "recheck" downloads the plan the portal has and reads it again if it changed. Notes
 * what happened on the company.
 */
export async function lookForPlan(company: Company, mode: "find" | "recheck" = "find") {
  const startedAt = new Date();
  let message: string;
  try {
    const have = await db.select().from(csrPlans).where(eq(csrPlans.funderId, company.id)).orderBy(desc(csrPlans.fy), desc(csrPlans.foundAt));
    const year = currentFy(startedAt);
    let href: string | null;
    let spent = { inputTokens: 0, outputTokens: 0 };
    let policy: string | null = null;
    if (mode === "recheck") {
      href = have.find((p) => p.url && p.fy && p.fy >= year)?.url ?? null;
    } else {
      // A link the company's annual report printed for its CSR projects is a good place to start.
      const [report] = await db
        .select({ policyUrl: companyReports.policyUrl })
        .from(companyReports)
        .where(and(eq(companyReports.funderId, company.id), isNotNull(companyReports.policyUrl)))
        .orderBy(desc(companyReports.fy))
        .limit(1);
      const found = await findCsrPlan({ name: company.name, cin: company.cin, fy: year, hint: report?.policyUrl ?? null });
      console.log(`[csr-plans] ${company.name}: ${found.searches} searches, ${found.inputTokens} input and ${found.outputTokens} output tokens to find`);
      spent = { inputTokens: found.inputTokens, outputTokens: found.outputTokens };
      href = found.plan;
      policy = found.policy;
      if (policy) await db.update(funders).set({ csrPolicyUrl: policy }).where(eq(funders.id, company.id));
    }
    if (!href)
      message = policy ? "Couldn't find its CSR action plan on its website, only its CSR policy." : "Couldn't find its CSR action plan on its website.";
    else {
      const opened = await openPlan(href);
      const hash = sha256(opened.body);
      const same = have.find((p) => p.url === href);
      const unchanged = have.find((p) => p.sha256 === hash);
      if (unchanged) message = `No change to its ${unchanged.fy ? `${unchanged.fy} ` : ""}CSR action plan.`;
      else {
        const check = checkActionPlan(opened.texts, company.name, { foundAt: href });
        if (!check.ok) throw new ReadError(`What was found isn't its CSR action plan. ${check.reason}`);
        const fy = check.fy ?? same?.fy ?? null;
        if (!same && fy && have.some((p) => p.status === "read" && p.fy && p.fy > fy)) {
          message = `Found its ${fy} plan; the portal already has a newer one.`;
        } else {
          // A plan that changed at the same link is read again in its place; a new link gets its own row.
          const [plan] = same
            ? await db.update(csrPlans).set({ status: "reading", fy, readAt: new Date() }).where(eq(csrPlans.id, same.id)).returning()
            : await db
                .insert(csrPlans)
                .values({ funderId: company.id, origin: "search", url: href, title: planLabel(company.name, fy), fy, status: "reading", readAt: new Date() })
                .onConflictDoNothing()
                .returning();
          if (!plan) message = "No change to its CSR action plan.";
          else {
            const read = await readOrFail(plan, company, opened, spent);
            message = read.ok
              ? `${same ? "Its CSR action plan has changed. " : ""}${read.message}`
              : `Found its CSR action plan, but it couldn't be read: ${read.message}`;
          }
        }
      }
    }
  } catch (e) {
    if (!known(e)) console.error(e);
    message = known(e) ? e.message : "Something went wrong looking for its CSR action plan.";
  }
  await db
    .update(funders)
    .set({
      planCheckedAt: startedAt,
      planCheckResult: message,
      // A request made while this look ran waits for the next run.
      planCheckRequestedAt: sql`case when ${funders.planCheckRequestedAt} <= ${startedAt.toISOString()}::timestamptz then null else ${funders.planCheckRequestedAt} end`,
    })
    .where(eq(funders.id, company.id));
  return message;
}

/** Plans to look at now: anyone asked for, then followed companies whose month has come round. */
async function duePlans(today: Date): Promise<{ company: Company; mode: "find" | "recheck" }[]> {
  const requested = await db
    .select({ id: funders.id, name: funders.name, cin: funders.cin })
    .from(funders)
    .where(isNotNull(funders.planCheckRequestedAt))
    .orderBy(funders.planCheckRequestedAt);
  const followed = await followedCompanies();
  const ids = followed.map((f) => f.id);
  const plans = ids.length
    ? await db
        .select({ funderId: csrPlans.funderId, fy: csrPlans.fy, url: csrPlans.url, status: csrPlans.status })
        .from(csrPlans)
        .where(inArray(csrPlans.funderId, ids))
    : [];
  const year = currentFy(today);
  const due = followed.flatMap((f) => {
    const own = plans.filter((p) => p.funderId === f.id && p.status === "read" && p.fy);
    const mode = planCheckDue(
      {
        planFys: own.map((p) => p.fy!),
        canRecheck: own.some((p) => p.url && p.fy! >= year),
        checkedAt: f.planCheckedAt,
        checkRequestedAt: f.planCheckRequestedAt,
      },
      today,
    );
    return mode ? [{ company: { id: f.id, name: f.name, cin: f.cin }, mode }] : [];
  });
  const seen = new Set<string>();
  return [...requested.map((company) => ({ company, mode: "find" as const })), ...due].filter((d) => !seen.has(d.company.id) && seen.add(d.company.id));
}

/**
 * Looks at the plans that are due, a few companies per run. Without an Anthropic API key nothing
 * can be looked for or read, so anyone who asked is told so.
 */
export async function checkDuePlans(log: (message: string) => void = console.log, limit = CHECKS_PER_RUN) {
  if (!readerConfigured()) {
    await db
      .update(funders)
      .set({ planCheckRequestedAt: null, planCheckResult: "Looking for CSR action plans needs the Anthropic API key, which isn't set up yet." })
      .where(isNotNull(funders.planCheckRequestedAt));
    return 0;
  }
  const due = (await duePlans(new Date())).slice(0, limit);
  for (const { company, mode } of due) log(`[csr-plans] ${company.name}: ${await lookForPlan(company, mode)}`);
  return due.length;
}

/** Takes the next plan someone gave a link to or uploaded, so two runs never read the same one. */
async function claimNextPlan() {
  // A read that was cut off (the worker restarted) is tried again after an hour.
  await db
    .update(csrPlans)
    .set({ status: "waiting" })
    .where(and(eq(csrPlans.status, "reading"), lt(csrPlans.readAt, new Date(Date.now() - 3_600_000))));
  const rows = await db.execute<{ id: string }>(sql`
    update csr_plans set status = 'reading', read_at = now()
    where id = (select id from csr_plans where status = 'waiting' order by found_at limit 1 for update skip locked)
    returning id`);
  const id = rows[0]?.id;
  return id ? db.query.csrPlans.findFirst({ where: eq(csrPlans.id, id), with: { funder: { columns: { id: true, name: true, cin: true } } } }) : undefined;
}

async function readWaitingPlan(plan: NonNullable<Awaited<ReturnType<typeof claimNextPlan>>>) {
  let opened: Opened;
  try {
    opened = plan.fileKey ? await openStored(plan.fileKey) : await openPlan(plan.url!);
  } catch (e) {
    if (!known(e)) console.error(e);
    const error = known(e) ? e.message : "Something went wrong reading this plan.";
    await db.update(csrPlans).set({ status: "failed", error, readAt: new Date() }).where(eq(csrPlans.id, plan.id));
    return `couldn't be read: ${error}`;
  }
  const check = checkActionPlan(opened.texts, plan.funder.name, { givenByPerson: true });
  const read = await readOrFail({ ...plan, fy: plan.fy ?? (check.ok ? check.fy : null) }, plan.funder, opened);
  return read.ok ? read.message : `couldn't be read: ${read.message}`;
}

/** Reads plans people gave, a few per run. Does nothing until an Anthropic API key is set. */
export async function readWaitingCsrPlans(log: (message: string) => void = console.log) {
  if (!readerConfigured()) return 0;
  let read = 0;
  for (let plan = await claimNextPlan(); plan; plan = read < READS_PER_RUN ? await claimNextPlan() : undefined) {
    read++;
    log(`[csr-plans] ${plan.funder.name}, ${plan.title}: ${await readWaitingPlan(plan)}`);
  }
  return read;
}

/** What the worker runs every minute. */
export async function runCsrPlans(log: (message: string) => void = console.log) {
  await readWaitingCsrPlans(log);
  await checkDuePlans(log);
}

/** Asks the worker to look for a company's plan on its next run. */
export async function requestPlanCheck(funderId: string) {
  await db.update(funders).set({ planCheckRequestedAt: new Date() }).where(eq(funders.id, funderId));
}

/** Queues a plan someone gave the link to or uploaded. Returns null if that link is already known. */
export async function addCsrPlan(
  funderId: string,
  file: { url: string; fileKey?: never; fileName?: never } | { fileKey: string; fileName: string; url?: never },
  userId: string,
) {
  const company = await db.query.funders.findFirst({ where: eq(funders.id, funderId), columns: { name: true } });
  if (!company) return null;
  const [row] = await db
    .insert(csrPlans)
    .values({
      funderId,
      origin: file.url ? "link" : "upload",
      url: file.url ?? null,
      fileKey: file.fileKey ?? null,
      title: file.fileName ?? planLabel(company.name, null),
      createdBy: userId,
    })
    .onConflictDoNothing()
    .returning({ id: csrPlans.id });
  return row ?? null;
}

/** Puts a plan that couldn't be read back in the queue; a plan on the web is fetched again from its link. */
export async function retryCsrPlan(id: string) {
  const rows = await db
    .update(csrPlans)
    .set({ status: "waiting", error: null })
    .where(and(eq(csrPlans.id, id), eq(csrPlans.status, "failed")))
    .returning({ id: csrPlans.id });
  return rows.length > 0;
}

/** Removes a plan and the NGOs it added, then scores the company again. */
export async function removeCsrPlan(id: string) {
  const [row] = await db.delete(csrPlans).where(eq(csrPlans.id, id)).returning({ funderId: csrPlans.funderId });
  if (row) await rescoreFunders([row.funderId]);
  return row ?? null;
}
