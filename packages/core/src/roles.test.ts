import { describe, expect, it } from "vitest";
import { can, initialRoles, isRole, permissionsFor, wouldRemoveLastAdmin } from "./roles";

describe("can", () => {
  it("gives admins every permission", () => {
    expect(can(["admin"], "users:manage")).toBe(true);
    expect(can(["admin"], "drafts:approve")).toBe(true);
  });

  it("keeps viewers read-only", () => {
    expect(can(["viewer"], "pipeline:view")).toBe(true);
    expect(can(["viewer"], "pipeline:edit")).toBe(false);
  });

  it("only lets approvers and admins approve drafts", () => {
    expect(can(["associate"], "drafts:approve")).toBe(false);
    expect(can(["approver"], "drafts:approve")).toBe(true);
  });

  it("combines permissions across several roles", () => {
    expect(can(["introducer", "associate"], "intros:respond")).toBe(true);
    expect(can(["introducer", "associate"], "pipeline:edit")).toBe(true);
    expect(permissionsFor(["introducer", "associate"]).has("users:manage")).toBe(false);
  });

  it("gives no permissions with no roles", () => {
    expect(can([], "pipeline:view")).toBe(false);
  });
});

describe("initialRoles", () => {
  it("makes listed emails admins, ignoring case and spaces", () => {
    expect(initialRoles("Sylvia@VisionEmpower.org", " sylvia@visionempower.org , a@b.org")).toEqual(["admin"]);
  });

  it("makes everyone else a viewer", () => {
    expect(initialRoles("someone@visionempower.org", "sylvia@visionempower.org")).toEqual(["viewer"]);
    expect(initialRoles(null, "sylvia@visionempower.org")).toEqual(["viewer"]);
    expect(initialRoles("x@y.org", undefined)).toEqual(["viewer"]);
  });
});

describe("wouldRemoveLastAdmin", () => {
  it("blocks removing the only admin", () => {
    expect(wouldRemoveLastAdmin({ targetIsAdmin: true, nextRoles: ["associate"], adminCount: 1 })).toBe(true);
  });

  it("allows it when another admin exists", () => {
    expect(wouldRemoveLastAdmin({ targetIsAdmin: true, nextRoles: ["associate"], adminCount: 2 })).toBe(false);
  });

  it("allows changes that keep admin", () => {
    expect(wouldRemoveLastAdmin({ targetIsAdmin: true, nextRoles: ["admin", "approver"], adminCount: 1 })).toBe(false);
  });
});

describe("isRole", () => {
  it("accepts known roles only", () => {
    expect(isRole("approver")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(3)).toBe(false);
  });
});
