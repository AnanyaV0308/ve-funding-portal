import { donorsToAdd, type ReportDonor } from "@ve/core";

type ReportForStatus = { status: "waiting" | "reading" | "ready" | "no_donors" | "failed" | "dismissed"; error: string | null; donors: ReportDonor[] };

/** What has happened to a report, in words. `added` is when its donors were added, if they were. */
export function reportStatus(r: ReportForStatus, added: Date | null, readerReady: boolean): string {
  if (added) return "Donors added";
  const count = donorsToAdd(r.donors).entries.length;
  switch (r.status) {
    case "waiting":
      return readerReady ? "Waiting to be read" : "Waiting for an Anthropic API key to be read";
    case "reading":
      return "Being read now";
    case "ready":
      return count ? `Ready to check: ${count} ${count === 1 ? "donor" : "donors"}` : "Read: no Indian companies or foundations in it";
    case "no_donors":
      return "Read: it names no donors";
    case "failed":
      return `Couldn't be read. ${r.error ?? ""}`.trim();
    case "dismissed":
      return "Not added";
  }
}
