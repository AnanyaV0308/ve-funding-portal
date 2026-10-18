import { describe, expect, it } from "vitest";
import {
  daysUntil,
  dueState,
  ALL_STAGES,
  defaultProbability,
  effectiveProbability,
  firstStage,
  formatInr,
  formatInrShort,
  isClosed,
  isLost,
  isStageInTrack,
  isStuck,
  parseInr,
  STAGES_BY_TRACK,
  weightedValue,
} from "./pipeline";

describe("stages", () => {
  it("uses the PRD's relationship probabilities", () => {
    expect(defaultProbability("identified")).toBe(2);
    expect(defaultProbability("proposal_sent")).toBe(45);
    expect(defaultProbability("committed")).toBe(90);
    expect(defaultProbability("funds_received")).toBe(100);
    expect(defaultProbability("not_now")).toBe(0);
  });

  it("keeps the two tracks separate", () => {
    expect(isStageInTrack("relationship", "proposal_sent")).toBe(true);
    expect(isStageInTrack("application", "proposal_sent")).toBe(false);
    expect(isStageInTrack("application", "shortlisted")).toBe(true);
    expect(isStageInTrack("relationship", "nonsense")).toBe(false);
  });

  it("has no stage name in both tracks", () => {
    const r = new Set(STAGES_BY_TRACK.relationship);
    expect(STAGES_BY_TRACK.application.filter((s) => r.has(s))).toEqual([]);
    expect(new Set(ALL_STAGES).size).toBe(ALL_STAGES.length);
  });

  it("knows which stages are closed", () => {
    expect(isClosed("funds_received")).toBe(true);
    expect(isClosed("won")).toBe(true);
    expect(isLost("not_now")).toBe(true);
    expect(isLost("not_selected")).toBe(true);
    expect(isClosed("committed")).toBe(false);
    expect(firstStage("relationship")).toBe("identified");
    expect(firstStage("application")).toBe("spotted");
  });
});

describe("weighted value", () => {
  it("multiplies the ask by the probability", () => {
    expect(weightedValue(4_000_000, 45)).toBe(1_800_000);
    expect(weightedValue(null, 45)).toBe(0);
  });

  it("prefers a person's override to the stage default", () => {
    expect(effectiveProbability("proposal_sent", 60)).toBe(60);
    expect(effectiveProbability("proposal_sent", null)).toBe(45);
    expect(effectiveProbability("proposal_sent", 0)).toBe(0);
  });
});

describe("isStuck", () => {
  const changed = new Date("2026-10-01T00:00:00Z");
  it("flags open pursuits with no stage change for more than 21 days", () => {
    expect(isStuck("contacted", changed, new Date("2026-10-22T00:00:00Z"))).toBe(false);
    expect(isStuck("contacted", changed, new Date("2026-10-23T00:00:00Z"))).toBe(true);
  });
  it("never flags closed pursuits", () => {
    expect(isStuck("funds_received", changed, new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("rupee formatting", () => {
  it("writes lakh and crore shorthand", () => {
    expect(formatInrShort(4_000_000)).toBe("₹40 L");
    expect(formatInrShort(12_500_000)).toBe("₹1.25 Cr");
    expect(formatInrShort(550_000)).toBe("₹5.5 L");
    expect(formatInrShort(75_000)).toBe("₹75,000");
    expect(formatInrShort(null)).toBe("");
  });

  it("uses Indian digit grouping", () => {
    expect(formatInr(4_000_000)).toBe("₹40,00,000");
  });

  it("reads amounts the way people type them", () => {
    expect(parseInr("40 lakh")).toBe(4_000_000);
    expect(parseInr("40L")).toBe(4_000_000);
    expect(parseInr("1.5 cr")).toBe(15_000_000);
    expect(parseInr("₹40,00,000")).toBe(4_000_000);
    expect(parseInr("Rs. 500000")).toBe(500_000);
    expect(parseInr("75k")).toBe(75_000);
    expect(parseInr("")).toBeNull();
    expect(parseInr("lots")).toBeNull();
  });
});

describe("next action due dates", () => {
  it("counts whole days across months and years", () => {
    expect(daysUntil("2026-11-01", "2026-10-30")).toBe(2);
    expect(daysUntil("2026-12-31", "2027-01-02")).toBe(-2);
  });
  it("buckets due dates", () => {
    expect(dueState("2026-10-16", "2026-10-18")).toBe("overdue");
    expect(dueState("2026-10-18", "2026-10-18")).toBe("today");
    expect(dueState("2026-11-01", "2026-10-18")).toBe("soon");
    expect(dueState("2026-11-02", "2026-10-18")).toBe("later");
  });
});
