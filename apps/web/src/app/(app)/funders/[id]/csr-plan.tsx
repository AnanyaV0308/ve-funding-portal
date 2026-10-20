import { formatInrShort, fyLabel, PARTNER_LEFT_OUT_REASONS, type PlanProject } from "@ve/core";
import type { csrPlans } from "@ve/db";
import { formatDate } from "@/lib/format";
import { lookForPlan, removePlan, retryPlanRead } from "../report-actions";
import { ReportLinkForm, ReportUploadForm } from "./report-forms";

type Plan = typeof csrPlans.$inferSelect;

/** What has happened to a plan, in words. */
export function csrPlanStatus(p: Pick<Plan, "status" | "error" | "readAt">, readerReady: boolean): string {
  switch (p.status) {
    case "waiting":
      return readerReady ? "Waiting to be read" : "Waiting for an Anthropic API key to be read";
    case "reading":
      return "Being read now";
    case "read":
      return `Read ${formatDate(p.readAt)}`;
    case "not_plan":
      return "Read: it isn't a CSR action plan";
    case "failed":
      return `Couldn't be read. ${p.error ?? ""}`.trim();
  }
}

/** Opens in a new tab, and says so to screen readers. */
function External({ href, children, more = "" }: { href: string; children: React.ReactNode; more?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="sr-only">{more} (opens in a new tab)</span>
    </a>
  );
}

function PageRef({ plan, page }: { plan: Plan; page: number | null }) {
  if (!page) return null;
  if (!plan.url || !plan.pages) return <span className="text-ve-muted"> · page {page}</span>;
  return (
    <>
      {" · "}
      <External href={`${plan.url}#page=${page}`} more=" of the plan">
        page {page}
      </External>
    </>
  );
}

const DisabilityTag = () => <span className="ml-1 inline-block rounded bg-ok-soft px-1.5 text-xs font-medium text-ok">For people with disabilities</span>;

function Projects({ plan }: { plan: Plan }) {
  return (
    <div className="relative overflow-x-auto rounded-md border border-ve-line">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">Projects in {plan.title}</caption>
        <thead className="bg-ve-cream">
          <tr>
            <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
              Project
            </th>
            <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
              Where
            </th>
            <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">
              Amount
            </th>
            <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
              Carried out by
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.projects.map((p, i) => (
            <tr key={i} className="border-t border-ve-line align-top">
              <th scope="row" className="px-3 py-2 font-medium">
                {p.name}
                {p.disability ? <DisabilityTag /> : null}
                <span className="block text-xs font-normal text-ve-muted">
                  {[p.area, p.ongoing ? "Ongoing, over more than a year" : null].filter(Boolean).join(" · ")}
                  <PageRef plan={plan} page={p.page} />
                </span>
              </th>
              <td className="px-3 py-2">{p.states.length ? p.states.join(", ") : <span className="text-ve-muted">Not given</span>}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {p.amountInr !== null ? formatInrShort(p.amountInr) || "₹0" : <span className="text-ve-muted">Not given</span>}
              </td>
              <td className="px-3 py-2">
                {p.agency ?? <span className="text-ve-muted">Not named</span>}
                {p.registration ? <span className="block text-xs text-ve-muted">{p.registration}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Figures({ plan }: { plan: Plan }) {
  const amounts = plan.projects.map((p) => p.amountInr).filter((a): a is number => a !== null);
  const total = amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;
  const states = [...new Set(plan.projects.flatMap((p) => p.states))].sort();
  const rows = [
    {
      label: plan.budget !== null ? `Budget${plan.fy ? ` for ${fyLabel(plan.fy)}` : ""}` : "Projects add up to",
      value: plan.budget ?? total,
    },
    { label: "Projects", value: null, text: String(plan.projects.length) },
    { label: "Where", value: null, text: states.length ? states.join(", ") : null },
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
      {rows.map((r) => {
        const shown = r.text !== undefined ? r.text : r.value !== null ? formatInrShort(r.value) || "₹0" : null;
        return (
          <div key={r.label}>
            <dt className="label text-xs text-ve-muted">{r.label}</dt>
            <dd className="font-medium">{shown ?? <span className="font-normal text-ve-muted">Not given</span>}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ReadPlan({ plan, added }: { plan: Plan; added: number }) {
  const disability: PlanProject[] = plan.projects.filter((p) => p.disability);
  return (
    <div className="grid min-w-0 gap-3 rounded-lg border border-ve-line bg-white p-4">
      <div>
        <h3 className="font-bold">{plan.url ? <External href={plan.url}>{plan.title}</External> : plan.title}</h3>
        <p className="text-sm text-ve-muted">
          Read {formatDate(plan.readAt)}
          {plan.pages ? `, ${plan.pages} ${plan.pages === 1 ? "page" : "pages"}` : ""}.
          {plan.origin === "search" ? " Found on the company's website." : plan.origin === "upload" ? " Uploaded." : ""}
        </p>
      </div>
      <Figures plan={plan} />
      <div className="grid gap-1">
        <h4 className="font-bold">Work on disability</h4>
        {disability.length ? (
          <ul className="grid gap-1">
            {disability.map((p, i) => (
              <li key={i}>
                {p.name}
                {p.amountInr ? <span className="text-ve-muted"> · {formatInrShort(p.amountInr)}</span> : null}
                {p.agency ? <span className="text-ve-muted"> · {p.agency}</span> : null}
                <PageRef plan={plan} page={p.page} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ve-muted">None of its projects is for people with disabilities.</p>
        )}
      </div>
      {plan.projects.length ? (
        <details className="min-w-0" open={plan.projects.length <= 10}>
          <summary className="cursor-pointer font-bold">{plan.projects.length === 1 ? "Its one project" : `All ${plan.projects.length} projects`}</summary>
          <div className="mt-2">
            <Projects plan={plan} />
          </div>
        </details>
      ) : (
        <p className="text-ve-muted">It lists no projects.</p>
      )}
      <p>{added === 1 ? "1 NGO it names was" : `${added} NGOs it names were`} added to the NGOs it funds, below.</p>
      {plan.leftOut.length ? (
        <details>
          <summary className="cursor-pointer">
            Left out: {plan.leftOut.length} {plan.leftOut.length === 1 ? "organisation" : "organisations"}
          </summary>
          <ul className="mt-2 grid gap-1">
            {plan.leftOut.map((l) => (
              <li key={l.name}>
                {l.name} <span className="text-ve-muted">· {PARTNER_LEFT_OUT_REASONS[l.reason]}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The company's CSR annual action plans: what the newest one read says it's funding this year,
 * the others with where they stand, its CSR policy, and ways to look again or add one by hand.
 */
export function CsrPlanSection({
  funder,
  plans,
  addedByPlan,
  policyUrl,
  followed,
  followedCount,
  readerReady,
  canEdit,
}: {
  funder: { id: string; name: string; planCheckedAt: Date | null; planCheckRequestedAt: Date | null; planCheckResult: string | null };
  plans: Plan[];
  addedByPlan: Map<string, number>;
  /** The company's CSR policy, from its plan, its website or its annual report. */
  policyUrl: string | null;
  followed: boolean;
  followedCount: number;
  readerReady: boolean;
  canEdit: boolean;
}) {
  const newest = plans.find((p) => p.status === "read");
  const others = plans.filter((p) => p !== newest);
  return (
    <section aria-labelledby="plan-heading" className="grid content-start gap-3">
      <h2 id="plan-heading" className="text-xl font-bold">
        CSR action plan
      </h2>
      <p className="text-sm text-ve-muted">
        Each year a company&apos;s board approves a CSR action plan: the year&apos;s projects, where they run, what each gets and who carries them out. It says
        what the company is funding now, and its projects count towards the fit score.{" "}
        {followed
          ? "The portal looks on the company's website for this year's plan until it finds it, then checks it for changes every month."
          : `The portal looks for the plans of the ${followedCount} best-fitting companies on its own, and this one isn't among them.`}
      </p>

      {newest ? <ReadPlan plan={newest} added={addedByPlan.get(newest.id) ?? 0} /> : null}

      {policyUrl ? (
        <p>
          <External href={policyUrl}>Its CSR policy</External>
        </p>
      ) : null}

      {others.length ? (
        <ul className="grid gap-2" aria-label="Other CSR action plans">
          {others.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-ve-line bg-white p-3">
              <div>
                <p className="font-medium">{p.url ? <External href={p.url}>{p.title}</External> : p.title}</p>
                <p className="text-sm text-ve-muted">
                  {csrPlanStatus(p, readerReady)}
                  {p.status === "read" ? ` · ${p.projects.length} projects · ${addedByPlan.get(p.id) ?? 0} NGOs added` : ""}
                </p>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  {p.status === "failed" ? (
                    <form action={retryPlanRead}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" aria-label={`Try reading ${p.title} again`}>
                        Try again
                      </button>
                    </form>
                  ) : null}
                  <form action={removePlan}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" aria-label={`Remove ${p.title} and the NGOs it added`}>
                      Remove
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!plans.length ? <p className="text-ve-muted">No CSR action plan yet.</p> : null}

      <p className="text-sm" role="status">
        {funder.planCheckRequestedAt
          ? "The portal will look for its plan in the next few minutes."
          : funder.planCheckedAt
            ? `Last looked ${formatDate(funder.planCheckedAt)}: ${funder.planCheckResult ?? ""}`
            : (funder.planCheckResult ?? "The portal hasn't looked on its website yet.")}
      </p>

      {canEdit ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {newest ? (
              <form action={removePlan}>
                <input type="hidden" name="id" value={newest.id} />
                <button type="submit" className="btn btn-secondary" aria-label={`Remove ${newest.title} and the NGOs it added`}>
                  Remove this plan
                </button>
              </form>
            ) : null}
            <form action={lookForPlan}>
              <input type="hidden" name="funderId" value={funder.id} />
              <button type="submit" className="btn btn-secondary" disabled={Boolean(funder.planCheckRequestedAt)}>
                Look for its CSR action plan
              </button>
            </form>
          </div>
          <details className="rounded-lg border border-ve-line bg-white p-4">
            <summary className="cursor-pointer font-bold">Add a plan by hand</summary>
            <div className="mt-3 grid gap-5">
              <ReportLinkForm funderId={funder.id} kind="plan" />
              <ReportUploadForm funderId={funder.id} kind="plan" />
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
