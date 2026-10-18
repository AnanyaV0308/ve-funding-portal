import { describe, expect, it } from "vitest";
import { addMonths, factStatus, reviewDueDate, usableInDrafts } from "./knowledge";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(addMonths(d("2026-01-15"), 3).toISOString().slice(0, 10)).toBe("2026-04-15");
  });

  it("clamps to the end of shorter months", () => {
    expect(addMonths(d("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(d("2028-01-31"), 1).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("crosses year boundaries", () => {
    expect(addMonths(d("2026-11-30"), 3).toISOString().slice(0, 10)).toBe("2027-02-28");
  });
});

describe("factStatus", () => {
  const confirmed = d("2026-01-01");

  it("flags facts nobody has confirmed", () => {
    expect(factStatus({ confirmedAt: null, refreshMonths: 12 }, d("2026-01-02"))).toBe("unconfirmed");
  });

  it("is current well before the review date", () => {
    expect(factStatus({ confirmedAt: confirmed, refreshMonths: 3 }, d("2026-02-01"))).toBe("current");
  });

  it("asks for review in the last 30 days", () => {
    expect(reviewDueDate(confirmed, 3).toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(factStatus({ confirmedAt: confirmed, refreshMonths: 3 }, d("2026-03-02"))).toBe("due_soon");
  });

  it("is out of date on and after the review date", () => {
    expect(factStatus({ confirmedAt: confirmed, refreshMonths: 3 }, d("2026-04-01"))).toBe("stale");
    expect(factStatus({ confirmedAt: confirmed, refreshMonths: 3 }, d("2027-01-01"))).toBe("stale");
  });
});

describe("usableInDrafts", () => {
  it("only lets confirmed, in-date facts into drafts", () => {
    expect(usableInDrafts("current")).toBe(true);
    expect(usableInDrafts("due_soon")).toBe(true);
    expect(usableInDrafts("stale")).toBe(false);
    expect(usableInDrafts("unconfirmed")).toBe(false);
  });
});
