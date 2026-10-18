/**
 * VE's role-based access. Roles are assigned by an admin in Settings; a person can hold several.
 * Permissions are what the code checks, so VE can change who does what without code changes
 * to the screens themselves.
 */
export const ROLES = ["admin", "approver", "associate", "introducer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, { name: string; description: string }> = {
  admin: { name: "Admin", description: "Manages people, roles and settings" },
  approver: { name: "Approver", description: "Approves drafts and applications before they go out" },
  associate: { name: "Associate", description: "Researches leads and works the pipeline day to day" },
  introducer: { name: "Introducer", description: "Founders, trustees and board members who make introductions" },
  viewer: { name: "Viewer", description: "Can see the pipeline and leads but not change them" },
};

export const PERMISSIONS = [
  "pipeline:view",
  "pipeline:edit",
  "leads:view",
  "leads:edit",
  "knowledge:view",
  "knowledge:edit",
  "calendar:view",
  "calendar:edit",
  "drafts:approve",
  "intros:respond",
  "settings:manage",
  "users:manage",
  "profile:edit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Everyone can see the work and choose which emails they get.
const VIEW: Permission[] = ["pipeline:view", "leads:view", "knowledge:view", "calendar:view", "profile:edit"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [...PERMISSIONS],
  approver: [...VIEW, "pipeline:edit", "leads:edit", "knowledge:edit", "calendar:edit", "drafts:approve"],
  associate: [...VIEW, "pipeline:edit", "leads:edit", "knowledge:edit", "calendar:edit"],
  introducer: [...VIEW, "intros:respond"],
  viewer: VIEW,
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
}

/**
 * Roles for someone signing in for the first time. Emails in ADMIN_EMAILS become admins so the
 * portal can be bootstrapped; everyone else starts as a viewer until an admin assigns a role.
 */
export function initialRoles(email: string | null | undefined, adminEmails: string | undefined): Role[] {
  const admins = (adminEmails ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return email && admins.includes(email.trim().toLowerCase()) ? ["admin"] : ["viewer"];
}

/** Refuses a role change that would leave the portal with no admin. */
export function wouldRemoveLastAdmin(opts: {
  targetIsAdmin: boolean;
  nextRoles: readonly Role[];
  adminCount: number;
}): boolean {
  return opts.targetIsAdmin && !opts.nextRoles.includes("admin") && opts.adminCount <= 1;
}
