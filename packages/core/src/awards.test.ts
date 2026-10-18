import { describe, expect, it } from "vitest";
import {
  addDays,
  blankChecklist,
  callEligibility,
  callStatus,
  dueReminder,
  type EligibilityCheck,
  normaliseChecklist,
  reminderSchedule,
  stillNeedsReminders,
} from "./awards";

const all = (answer: EligibilityCheck["answer"]): EligibilityCheck[] => blankChecklist().map((c) => ({ ...c, answer }));

describe("callEligibility", () => {
  it("is needs check when nobody has looked", () => {
    expect(callEligibility(blankChecklist())).toEqual({ verdict: "needs_check", reasons: ["Nobody has checked this call yet."] });
    expect(callEligibility(null).verdict).toBe("needs_check");
  });

  it("is eligible only when every requirement is met", () => {
    expect(callEligibility(all("yes")).verdict).toBe("eligible");
    const oneLeft = all("yes").map((c) => (c.key === "budget" ? { ...c, answer: null } : c));
    expect(callEligibility(oneLeft)).toEqual({ verdict: "needs_check", reasons: ["Not checked yet: budget size."] });
  });

  it("lists what VE isn't sure about", () => {
    const checks = all("yes").map((c) => (c.key === "years" || c.key === "theme" ? { ...c, answer: "unsure" as const } : c));
    expect(callEligibility(checks)).toEqual({ verdict: "needs_check", reasons: ["Not sure about: years of operation, theme."] });
  });

  it("rules a call out when any requirement isn't met, whatever else is open", () => {
    const checks = blankChecklist().map((c) => (c.key === "geography" ? { ...c, answer: "no" as const } : c));
    expect(callEligibility(checks)).toEqual({ verdict: "not_eligible", reasons: ["VE doesn't meet: geography."] });
  });

  it("explains FCRA when that is the reason", () => {
    const checks = all("yes").map((c) => (c.key === "fcra" ? { ...c, answer: "no" as const } : c));
    const result = callEligibility(checks);
    expect(result.verdict).toBe("not_eligible");
    expect(result.reasons[1]).toMatch(/no FCRA registration/);
  });

  it("puts a partial checklist back in the standard order", () => {
    const list = normaliseChecklist([{ key: "theme", answer: "yes" }]);
    expect(list.map((c) => c.key)).toEqual(["registration", "years", "fcra", "geography", "budget", "theme"]);
    expect(list[5]).toEqual({ key: "theme", answer: "yes" });
    expect(list[0]).toEqual({ key: "registration", answer: null });
  });
});

describe("callStatus", () => {
  const today = "2026-10-18";
  it("works out where a call stands", () => {
    expect(callStatus({ opensOn: null, deadline: null }, today)).toBe("not_announced");
    expect(callStatus({ opensOn: "2026-11-01", deadline: "2026-12-15" }, today)).toBe("upcoming");
    expect(callStatus({ opensOn: "2026-10-01", deadline: "2026-11-15" }, today)).toBe("open");
    expect(callStatus({ opensOn: null, deadline: today }, today)).toBe("open");
    expect(callStatus({ opensOn: null, deadline: "2026-10-17" }, today)).toBe("closed");
    expect(callStatus({ opensOn: "2026-10-01", deadline: null }, today)).toBe("open");
  });
});

describe("reminders", () => {
  const deadline = "2026-11-30";
  it("sends nothing more than 30 days out or after the deadline", () => {
    expect(dueReminder(deadline, "2026-10-30")).toBeNull();
    expect(dueReminder(deadline, "2026-12-01")).toBeNull();
  });

  it("sends each reminder on its day", () => {
    expect(dueReminder(deadline, "2026-10-31")).toBe(30);
    expect(dueReminder(deadline, "2026-11-16")).toBe(14);
    expect(dueReminder(deadline, "2026-11-23")).toBe(7);
    expect(dueReminder(deadline, "2026-11-28")).toBe(2);
  });

  it("catches up on the nearest reminder for a call added late or a missed day", () => {
    expect(dueReminder(deadline, "2026-11-20")).toBe(14);
    expect(dueReminder(deadline, "2026-11-25")).toBe(7);
    expect(dueReminder(deadline, deadline)).toBe(2);
  });

  it("lists the schedule earliest first", () => {
    expect(reminderSchedule(deadline)).toEqual([
      { days: 30, on: "2026-10-31" },
      { days: 14, on: "2026-11-16" },
      { days: 7, on: "2026-11-23" },
      { days: 2, on: "2026-11-28" },
    ]);
  });

  it("stops once the application has gone in", () => {
    expect(stillNeedsReminders("drafting")).toBe(true);
    expect(stillNeedsReminders("approved")).toBe(true);
    expect(stillNeedsReminders("submitted")).toBe(false);
    expect(stillNeedsReminders("won")).toBe(false);
    expect(stillNeedsReminders("not_selected")).toBe(false);
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
});
