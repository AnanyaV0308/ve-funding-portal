"use client";

import { useState } from "react";
import { deleteFact } from "./actions";

/** Two-step delete: the first click asks, the second deletes. */
export function DeleteFact({ id, title }: { id: string; title: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn-secondary text-bad" onClick={() => setAsking(true)}>
        Delete this fact
      </button>
    );
  }
  return (
    <form action={deleteFact} className="flex flex-wrap items-center gap-3 rounded-md bg-bad-soft p-3" role="group" aria-label="Confirm delete">
      <input type="hidden" name="id" value={id} />
      <p className="text-bad">Delete “{title}”? This can't be undone.</p>
      <button type="submit" className="btn bg-bad text-white" autoFocus>
        Yes, delete
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
        Keep it
      </button>
    </form>
  );
}
