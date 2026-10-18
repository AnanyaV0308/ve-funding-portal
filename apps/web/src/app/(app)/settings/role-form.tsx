"use client";

import { ROLE_LABELS, ROLES, type Role } from "@ve/core";
import { useActionState } from "react";
import { setUserRoles, type RoleFormState } from "./actions";

export function RoleForm({ userId, userLabel, roles }: { userId: string; userLabel: string; roles: Role[] }) {
  const [state, action, pending] = useActionState<RoleFormState, FormData>(setUserRoles, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="userId" value={userId} />
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="sr-only">Roles for {userLabel}</legend>
        {ROLES.map((role) => (
          <label key={role} className="inline-flex items-center gap-2" title={ROLE_LABELS[role].description}>
            <input
              type="checkbox"
              name="roles"
              value={role}
              defaultChecked={roles.includes(role)}
              className="size-4 accent-ve-olive"
            />
            {ROLE_LABELS[role].name}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary text-sm" disabled={pending}>
          {pending ? "Saving…" : "Save roles"}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${state?.ok ? "text-ok" : "text-bad"}`}>
          {state?.message}
        </p>
      </div>
    </form>
  );
}
