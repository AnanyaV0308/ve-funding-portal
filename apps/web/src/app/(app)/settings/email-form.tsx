"use client";

import { useActionState } from "react";
import { type EmailPrefsState, saveEmailPrefs } from "./email-actions";

export function EmailPrefsForm({ digestEmails, reminderEmails, showReminders }: { digestEmails: boolean; reminderEmails: boolean; showReminders: boolean }) {
  const [state, action, pending] = useActionState<EmailPrefsState, FormData>(saveEmailPrefs, null);
  return (
    <form action={action} className="grid gap-3">
      <fieldset className="grid gap-3">
        <legend className="sr-only">Emails to me</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="digestEmails" defaultChecked={digestEmails} className="mt-1.5 size-4 accent-ve-olive" />
          <span>
            Weekly digest
            <span className="block text-sm text-ve-muted">Monday mornings: new high-fit leads, deadlines in the next two weeks, stuck pursuits and wins.</span>
          </span>
        </label>
        {showReminders ? (
          <label className="flex items-start gap-2">
            <input type="checkbox" name="reminderEmails" defaultChecked={reminderEmails} className="mt-1.5 size-4 accent-ve-olive" />
            <span>
              Award and grant deadline reminders
              <span className="block text-sm text-ve-muted">
                30, 14, 7 and 2 days before a deadline, for applications you own, and for calls nobody has picked up yet.
              </span>
            </span>
          </label>
        ) : (
          <input type="hidden" name="reminderEmails" value={reminderEmails ? "on" : ""} />
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary text-sm" disabled={pending}>
          {pending ? "Saving…" : "Save email choices"}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${state?.ok ? "text-ok" : "text-bad"}`}>
          {state?.message}
        </p>
      </div>
    </form>
  );
}
