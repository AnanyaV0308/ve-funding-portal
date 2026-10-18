import { can, ROLE_LABELS, ROLES } from "@ve/core";
import { db, getFitSettings, outboundEmails, users } from "@ve/db";
import { asc, desc, eq } from "drizzle-orm";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { EmailPrefsForm } from "./email-form";
import { FitForm } from "./fit-form";
import { RoleForm } from "./role-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  if (!can(me.roles, "profile:edit")) return <NoAccess what="Settings" />;
  const isAdmin = can(me.roles, "users:manage");
  const canManage = can(me.roles, "settings:manage");

  const [mine, people, fit, emails] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, me.id),
      columns: { digestEmails: true, reminderEmails: true },
    }),
    isAdmin
      ? db.query.users.findMany({
          with: { roles: true },
          orderBy: asc(users.name),
        })
      : null,
    canManage ? getFitSettings() : null,
    canManage ? db.select().from(outboundEmails).orderBy(desc(outboundEmails.createdAt)).limit(20) : null,
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        intro={isAdmin ? "Choose who can do what, how CSR leads are scored, and which emails you get." : "Choose which emails you get."}
      />

      <section id="emails" aria-labelledby="emails-heading" className="grid gap-3 scroll-mt-4">
        <h2 id="emails-heading" className="text-xl font-bold">
          Emails to me
        </h2>
        <div className="rounded-lg border border-ve-line bg-white p-4">
          <EmailPrefsForm
            digestEmails={mine?.digestEmails ?? true}
            reminderEmails={mine?.reminderEmails ?? true}
            showReminders={can(me.roles, "calendar:edit") || can(me.roles, "pipeline:edit")}
          />
        </div>
      </section>

      {people ? (
        <>
          <section aria-labelledby="roles-heading" className="grid gap-3">
            <h2 id="roles-heading" className="text-xl font-bold">
              What each role can do
            </h2>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ROLES.map((r) => (
                <div key={r} className="rounded-md border border-ve-line bg-white p-3">
                  <dt className="font-medium">{ROLE_LABELS[r].name}</dt>
                  <dd className="text-sm text-ve-muted">{ROLE_LABELS[r].description}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="people-heading" className="grid gap-3">
            <h2 id="people-heading" className="text-xl font-bold">
              People ({people.length})
            </h2>
            <p className="max-w-prose text-sm text-ve-muted">
              People appear here after they first sign in with their Microsoft 365 account. New people start as viewers.
            </p>
            <ul className="grid gap-3">
              {people.map((p) => {
                const label = p.name ?? p.email ?? "Unnamed person";
                return (
                  <li key={p.id} className="grid gap-3 rounded-lg border border-ve-line bg-white p-4">
                    <div>
                      <h3 className="font-medium">
                        {label}
                        {p.id === me.id ? <span className="text-ve-muted"> (you)</span> : null}
                      </h3>
                      {p.email ? <p className="text-sm text-ve-muted">{p.email}</p> : null}
                    </div>
                    <RoleForm userId={p.id} userLabel={label} roles={p.roles.map((r) => r.role)} />
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}

      {fit ? (
        <section aria-labelledby="fit-heading" className="grid gap-3">
          <h2 id="fit-heading" className="text-xl font-bold">
            Fit score
          </h2>
          <p className="max-w-prose text-sm text-ve-muted">
            Every CSR lead gets a score out of 100 in six parts. The starting weights come from the PRD; change them as VE learns what predicts a yes.
          </p>
          <div className="rounded-lg border border-ve-line bg-white p-5">
            <FitForm settings={fit} />
          </div>
        </section>
      ) : null}

      {emails ? (
        <section aria-labelledby="sent-heading" className="grid gap-3">
          <h2 id="sent-heading" className="text-xl font-bold">
            Emails sent
          </h2>
          <p className="max-w-prose text-sm text-ve-muted">
            The latest reminders and digests. Until VE sets up an email service, they are saved to the portal&apos;s outbox folder instead of being sent.
          </p>
          {emails.length ? (
            <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ve-line bg-ve-cream">
                    <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                      When
                    </th>
                    <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                      To
                    </th>
                    <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                      Subject
                    </th>
                    <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {emails.map((e) => (
                    <tr key={e.id} className="border-t border-ve-line align-top">
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(e.createdAt)}</td>
                      <td className="px-3 py-2">{e.toEmail}</td>
                      <td className="px-3 py-2">
                        <details>
                          <summary className="cursor-pointer">{e.subject}</summary>
                          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs">{e.text}</pre>
                        </details>
                      </td>
                      <td className="px-3 py-2">
                        {e.status === "sent"
                          ? e.provider === "outbox"
                            ? "Saved to outbox"
                            : "Sent"
                          : e.status === "failed"
                            ? `Failed: ${e.error}`
                            : "Waiting"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-ve-muted">No emails yet.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
