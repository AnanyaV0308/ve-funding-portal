import { fullRescoreDue, markFullRescore } from "@ve/db";
import { claimNextImport, runImport } from "./import-csr";
import { rescoreFunders } from "./score";

/**
 * Everything waiting for the worker: queued imports, then a full rescore if the fit settings
 * changed since the last one. The worker calls this every minute; `pnpm --filter @ve/ingest
 * run-pending` runs it once by hand.
 */
export async function runPending(log: (message: string) => void = console.log) {
  for (let id = await claimNextImport(); id; id = await claimNextImport()) {
    log(`[ingest] importing ${id}`);
    await runImport(id);
  }
  if (await fullRescoreDue()) {
    const startedAt = new Date();
    const count = await rescoreFunders();
    await markFullRescore(startedAt);
    log(`[ingest] fit settings changed, rescored ${count} companies`);
  }
}
