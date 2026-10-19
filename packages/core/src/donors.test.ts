import { describe, expect, it } from "vitest";
import { companyNameKey, MAX_DONOR_LINES, matchDonors, readDonorLines } from "./donors";

const CIN = "L22210MH1995PLC084781";

describe("companyNameKey", () => {
  it("treats common spellings of a company's name as the same", () => {
    expect(companyNameKey("Infosys Ltd.")).toBe("infosys");
    expect(companyNameKey("INFOSYS LIMITED")).toBe("infosys");
    expect(companyNameKey("Larsen & Toubro Limited")).toBe(companyNameKey("Larsen and Toubro Ltd"));
    expect(companyNameKey("The Tata Power Company Limited")).toBe("tata power");
    expect(companyNameKey("Bosch (P) Ltd")).toBe("bosch");
  });

  it("keeps words that tell companies apart", () => {
    expect(companyNameKey("Tata Steel")).not.toBe(companyNameKey("Tata Power"));
    expect(companyNameKey("Unilever India Ltd")).toBe("unilever india");
    // A name made only of a legal word is left as it is rather than emptied.
    expect(companyNameKey("Limited")).toBe("limited");
  });
});

describe("readDonorLines", () => {
  it("reads one donor per line, ignoring bullets, numbering and blank lines", () => {
    const { entries, problems } = readDonorLines("1. Infosys Ltd\n\n• Wipro Limited\n- Tata Steel\n3) Bosch Ltd (India)\n");
    expect(entries.map((e) => [e.line, e.name])).toEqual([
      [1, "Infosys Ltd"],
      [3, "Wipro Limited"],
      [4, "Tata Steel"],
      [5, "Bosch Ltd (India)"],
    ]);
    expect(problems).toEqual([]);
  });

  it("takes an amount after the last comma or tab, and a CIN from anywhere on the line", () => {
    const { entries } = readDonorLines(`Tata Steel Ltd, 25 lakh\nCipla\t₹1.5 crore\nMahindra (${CIN})\nLarsen & Toubro, Ltd`);
    expect(entries).toEqual([
      { line: 1, name: "Tata Steel Ltd", cin: null, amount: 2_500_000 },
      { line: 2, name: "Cipla", cin: null, amount: 15_000_000 },
      { line: 3, name: "Mahindra", cin: CIN, amount: null },
      // "Ltd" isn't an amount, so the comma is part of the name.
      { line: 4, name: "Larsen & Toubro, Ltd", cin: null, amount: null },
    ]);
  });

  it("counts a donor listed twice once, and says why", () => {
    const { entries, problems } = readDonorLines("Infosys Ltd\nWipro\nINFOSYS LIMITED, 10 lakh");
    expect(entries.map((e) => e.name)).toEqual(["Infosys Ltd", "Wipro"]);
    expect(problems).toEqual([{ line: 3, text: "INFOSYS LIMITED, 10 lakh", reason: "Same donor as line 1, so it's counted once." }]);
  });

  it("keeps same-named companies apart when their CINs differ", () => {
    const { entries } = readDonorLines(`Acme Ltd ${CIN}\nAcme Ltd U22210MH1995PTC084782`);
    expect(entries).toHaveLength(2);
  });

  it("flags lines with no name", () => {
    const { entries, problems } = readDonorLines("12.\n, 5 lakh\nCipla");
    expect(entries.map((e) => e.name)).toEqual(["Cipla"]);
    expect(problems.map((p) => [p.line, p.reason])).toEqual([
      [1, "No donor name on this line."],
      [2, "No donor name on this line."],
    ]);
  });

  it("stops at the line limit", () => {
    const text = Array.from({ length: MAX_DONOR_LINES + 3 }, (_, i) => `Company ${i + 1}`).join("\n");
    const { entries, problems } = readDonorLines(text);
    expect(entries).toHaveLength(MAX_DONOR_LINES);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toMatch(/Only the first 500/);
  });
});

describe("matchDonors", () => {
  const known = [
    { id: "f1", name: "Infosys Limited", cin: "L85110KA1981PLC013115", type: "company" },
    { id: "f2", name: "Tata Trusts", cin: null, type: "foundation" },
    { id: "f3", name: "Acme Ltd", cin: CIN, type: "company" },
    { id: "f4", name: "Cipla Foundation", cin: null, type: "foundation" },
    { id: "f5", name: "Cipla Foundation Ltd", cin: null, type: "company" },
  ];
  const entry = (name: string, cin: string | null = null) => ({ line: 1, name, cin, amount: null });

  it("matches on CIN first, then on name", () => {
    expect(matchDonors([entry("Infosys Technologies", "L85110KA1981PLC013115")], known)[0]).toMatchObject({ match: "cin", funder: { id: "f1" } });
    expect(matchDonors([entry("INFOSYS LTD")], known)[0]).toMatchObject({ match: "name", funder: { id: "f1" } });
    expect(matchDonors([entry("Tata Trusts")], known)[0]).toMatchObject({ match: "name", funder: { id: "f2", type: "foundation" } });
  });

  it("adds anyone it can't find", () => {
    expect(matchDonors([entry("Wipro Ltd")], known)[0]).toMatchObject({ match: "new", funder: null });
  });

  it("doesn't match a same-named company with a different CIN", () => {
    expect(matchDonors([entry("Acme Limited", "U22210MH1995PTC084782")], known)[0]!.match).toBe("new");
    expect(matchDonors([entry("Acme Limited")], known)[0]).toMatchObject({ match: "name", funder: { id: "f3" } });
  });

  it("prefers the company when a company and a foundation share a name", () => {
    expect(matchDonors([entry("Cipla Foundation")], known)[0]).toMatchObject({ funder: { id: "f5" } });
  });
});
