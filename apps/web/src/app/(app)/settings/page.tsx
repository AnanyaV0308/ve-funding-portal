import { can, ROLE_LABELS, ROLES } from "@ve/core";
import { db, getFitSettings, users } from "@ve/db";
import { asc } from "drizzle-orm";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { FitForm } from "./fit-form";
import { RoleForm } from "./role-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  if (!can(me.roles, "users:manage")) return <NoAccess what="Settings" />;

  const [people, fit] = await Promise.all([
    db.query.users.findMany({ with: { roles: true }, orderBy: asc(users.name) }),
    can(me.roles, "settings:manage") ? getFitSettings() : null,
  ]);

  return (
    <>
      <PageHeader title="Settings" intro="Choose who can do what, and how CSR leads are scored." />

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

      {fit ? (
        <section aria-labelledby="fit-heading" className="grid gap-3">
          <h2 id="fit-heading" className="text-xl font-bold">
            Fit score
          </h2>
          <p className="max-w-prose text-sm text-ve-muted">
            Every CSR lead gets a score out of 100 in six parts. The starting weights come from the PRD; change them as VE learns what
            predicts a yes.
          </p>
          <div className="rounded-lg border border-ve-line bg-white p-5">
            <FitForm settings={fit} />
          </div>
        </section>
      ) : null}
    </>
  );
}
