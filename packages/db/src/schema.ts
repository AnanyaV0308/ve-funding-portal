import {
  ACTIVITY_KINDS,
  ALL_STAGES,
  CONSENT_STATUSES,
  DOCUMENT_KINDS,
  FUNDER_TYPES,
  KNOWLEDGE_CATEGORIES,
  ROLES,
  TRACKS,
} from "@ve/core";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
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

// ---------------------------------------------------------------------------
// Pipeline: funders and VE's pursuit of each one, stage by stage.
// ---------------------------------------------------------------------------

export const funderTypeEnum = pgEnum("funder_type", FUNDER_TYPES);
export const trackEnum = pgEnum("track", TRACKS);
export const stageEnum = pgEnum("stage", ALL_STAGES);
export const activityKindEnum = pgEnum("activity_kind", ACTIVITY_KINDS);

/** An organisation or person who can give. Step 4 adds the Indian entity, CIN, eligibility and fit. */
export const funders = pgTable(
  "funders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: funderTypeEnum("type").notNull(),
    website: text("website"),
    notes: text("notes"),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("funders_name_idx").on(sql`lower(${t.name})`)],
);

export const pursuits = pgTable(
  "pursuits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funderId: uuid("funder_id")
      .notNull()
      .references(() => funders.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    track: trackEnum("track").notNull(),
    stage: stageEnum("stage").notNull(),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    /** Whole rupees. */
    askAmount: bigint("ask_amount", { mode: "number" }),
    /** Set only when a person overrides the stage's default probability. */
    probabilityOverride: integer("probability_override"),
    nextAction: text("next_action"),
    nextActionDue: date("next_action_due", { mode: "string" }),
    closedReason: text("closed_reason"),
    revisitOn: date("revisit_on", { mode: "string" }),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pursuits_track_stage_idx").on(t.track, t.stage), index("pursuits_owner_idx").on(t.ownerId)],
);

export const pursuitStageChanges = pgTable(
  "pursuit_stage_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pursuitId: uuid("pursuit_id")
      .notNull()
      .references(() => pursuits.id, { onDelete: "cascade" }),
    fromStage: stageEnum("from_stage"),
    toStage: stageEnum("to_stage").notNull(),
    note: text("note"),
    changedAt: createdAt(),
    changedBy: text("changed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("pursuit_stage_changes_pursuit_idx").on(t.pursuitId, t.changedAt)],
);

export const pursuitActivities = pgTable(
  "pursuit_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pursuitId: uuid("pursuit_id")
      .notNull()
      .references(() => pursuits.id, { onDelete: "cascade" }),
    kind: activityKindEnum("kind").notNull(),
    summary: text("summary").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("pursuit_activities_pursuit_idx").on(t.pursuitId, t.occurredOn)],
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

export const fundersRelations = relations(funders, ({ many }) => ({
  pursuits: many(pursuits),
}));

export const pursuitsRelations = relations(pursuits, ({ one, many }) => ({
  funder: one(funders, { fields: [pursuits.funderId], references: [funders.id] }),
  owner: one(users, { fields: [pursuits.ownerId], references: [users.id], relationName: "pursuitOwner" }),
  stageChanges: many(pursuitStageChanges),
  activities: many(pursuitActivities),
}));

export const pursuitStageChangesRelations = relations(pursuitStageChanges, ({ one }) => ({
  pursuit: one(pursuits, { fields: [pursuitStageChanges.pursuitId], references: [pursuits.id] }),
  changer: one(users, { fields: [pursuitStageChanges.changedBy], references: [users.id], relationName: "stageChanger" }),
}));

export const pursuitActivitiesRelations = relations(pursuitActivities, ({ one }) => ({
  pursuit: one(pursuits, { fields: [pursuitActivities.pursuitId], references: [pursuits.id] }),
  author: one(users, { fields: [pursuitActivities.createdBy], references: [users.id], relationName: "activityAuthor" }),
}));
