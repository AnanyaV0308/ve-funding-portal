import { CONSENT_STATUSES, DOCUMENT_KINDS, KNOWLEDGE_CATEGORIES, ROLES } from "@ve/core";
import { relations } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// People and access. The first four tables follow the shape Auth.js expects.
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  createdAt: createdAt(),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const roleEnum = pgEnum("role", ROLES);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** Who did what and when. Approvals, role changes and sends all land here. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    at: createdAt(),
  },
  (t) => [index("audit_log_target_idx").on(t.targetType, t.targetId), index("audit_log_at_idx").on(t.at)],
);

// ---------------------------------------------------------------------------
// Knowledge base: VE's facts and documents, the raw material for every proposal.
// ---------------------------------------------------------------------------

export const knowledgeCategoryEnum = pgEnum("knowledge_category", KNOWLEDGE_CATEGORIES);
export const consentStatusEnum = pgEnum("consent_status", CONSENT_STATUSES);
export const documentKindEnum = pgEnum("document_kind", DOCUMENT_KINDS);

export const knowledgeFacts = pgTable(
  "knowledge_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: knowledgeCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** The date the fact describes, e.g. the end of the financial year for an impact number. */
    asOf: date("as_of", { mode: "string" }),
    sourceLabel: text("source_label"),
    sourceUrl: text("source_url"),
    consent: consentStatusEnum("consent"),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    refreshMonths: integer("refresh_months").notNull().default(12),
    /** When a person last confirmed this is still correct. Null until someone at VE checks it. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("knowledge_facts_category_title_idx").on(t.category, t.title)],
);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  kind: documentKindEnum("kind").notNull(),
  /** Free text such as "2025-26", so financial years read naturally. */
  period: text("period"),
  notes: text("notes"),
  createdAt: createdAt(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
});

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedAt: createdAt(),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("document_versions_doc_version_idx").on(t.documentId, t.version)],
);

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles, { relationName: "holder" }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id], relationName: "holder" }),
}));

export const knowledgeFactsRelations = relations(knowledgeFacts, ({ one }) => ({
  owner: one(users, { fields: [knowledgeFacts.ownerId], references: [users.id], relationName: "factOwner" }),
  confirmer: one(users, { fields: [knowledgeFacts.confirmedBy], references: [users.id], relationName: "factConfirmer" }),
}));

export const documentsRelations = relations(documents, ({ many }) => ({
  versions: many(documentVersions),
}));

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(documents, { fields: [documentVersions.documentId], references: [documents.id] }),
  uploader: one(users, { fields: [documentVersions.uploadedBy], references: [users.id] }),
}));
