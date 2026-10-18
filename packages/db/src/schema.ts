import {
  ACTIVITY_KINDS,
  ALL_STAGES,
  CALL_KINDS,
  CONSENT_STATUSES,
  DOCUMENT_KINDS,
  ELIGIBILITY,
  type EligibilityCheck,
  type FitPartResult,
  FUNDER_TYPES,
  KNOWLEDGE_CATEGORIES,
  ROLES,
  TRACKS,
} from "@ve/core";
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
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
  /** Each person chooses which emails they get, under Settings. */
  digestEmails: boolean("digest_emails").notNull().default(true),
  reminderEmails: boolean("reminder_emails").notNull().default(true),
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
export const eligibilityEnum = pgEnum("eligibility", ELIGIBILITY);

export const funders = pgTable(
  "funders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: funderTypeEnum("type").notNull(),
    website: text("website"),
    notes: text("notes"),
    /** The Indian company's Corporate Identification Number. Only Indian entities can fund VE. */
    cin: text("cin").unique(),
    /** Set by hand for a multinational parent or other foreign entity; VE can't take its money without FCRA. */
    isForeign: boolean("is_foreign").notNull().default(false),
    /** Who at VE knows someone there, and how. Counts towards the fit score's warm-path part. */
    warmPath: text("warm_path"),
    // Worked out by the CSR engine from the data below; see packages/core/src/csr.ts.
    eligibility: eligibilityEnum("eligibility"),
    eligibilityReasons: jsonb("eligibility_reasons").$type<string[]>(),
    fitScore: integer("fit_score"),
    fitParts: jsonb("fit_parts").$type<FitPartResult[]>(),
    fitSummary: text("fit_summary"),
    latestFy: text("latest_fy"),
    /** Whole rupees. */
    latestSpend: bigint("latest_spend", { mode: "number" }),
    ticketEstimate: bigint("ticket_estimate", { mode: "number" }),
    ticketBasis: text("ticket_basis"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("funders_name_idx").on(sql`lower(${t.name})`), index("funders_fit_idx").on(t.eligibility, t.fitScore)],
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
    /** The award or grant call an application pursuit is for. */
    opportunityId: uuid("opportunity_id").references((): AnyPgColumn => opportunities.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pursuits_track_stage_idx").on(t.track, t.stage),
    index("pursuits_owner_idx").on(t.ownerId),
    index("pursuits_opportunity_idx").on(t.opportunityId),
  ],
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

// ---------------------------------------------------------------------------
// CSR data. One row per company per financial year, plus how that year's spend split by
// development sector and by state. Each row remembers which import it came from.
// ---------------------------------------------------------------------------

export const importStatusEnum = pgEnum("import_status", ["queued", "running", "done", "failed"]);
export const csrBreakdownKindEnum = pgEnum("csr_breakdown_kind", ["sector", "state"]);

export const dataImports = pgTable("data_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Where the data came from, e.g. "National CSR Portal". */
  source: text("source").notNull(),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  /** "auto", "crore", "lakh" or "rupees". */
  unit: text("unit").notNull().default("auto"),
  status: importStatusEnum("status").notNull().default("queued"),
  rowsRead: integer("rows_read"),
  companies: integer("companies"),
  fundersCreated: integer("funders_created"),
  problems: jsonb("problems").$type<{ row: number; message: string }[]>(),
  error: text("error"),
  createdAt: createdAt(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const csrYears = pgTable(
  "csr_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funderId: uuid("funder_id")
      .notNull()
      .references(() => funders.id, { onDelete: "cascade" }),
    /** "2023-24". */
    fy: text("fy").notNull(),
    /** Whole rupees. */
    spent: bigint("spent", { mode: "number" }).notNull(),
    prescribed: bigint("prescribed", { mode: "number" }),
    projectCount: integer("project_count").notNull().default(0),
    importId: uuid("import_id").references(() => dataImports.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("csr_years_funder_fy_idx").on(t.funderId, t.fy), index("csr_years_fy_idx").on(t.fy)],
);

export const csrBreakdown = pgTable(
  "csr_breakdown",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funderId: uuid("funder_id")
      .notNull()
      .references(() => funders.id, { onDelete: "cascade" }),
    fy: text("fy").notNull(),
    kind: csrBreakdownKindEnum("kind").notNull(),
    /** A development sector or a state, as the portal names it. */
    name: text("name").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("csr_breakdown_idx").on(t.funderId, t.fy, t.kind, t.name), index("csr_breakdown_name_idx").on(t.kind, t.name)],
);

/** NGOs a funder is known to fund, from annual reports or VE's own knowledge. Drives the peer part of the fit score. */
export const funderGrantees = pgTable(
  "funder_grantees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funderId: uuid("funder_id")
      .notNull()
      .references(() => funders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fy: text("fy"),
    amount: bigint("amount", { mode: "number" }),
    sourceLabel: text("source_label"),
    sourceUrl: text("source_url"),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("funder_grantees_funder_idx").on(t.funderId)],
);

/** Settings admins change in the app, such as the fit-score weights. One JSON value per key. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

// ---------------------------------------------------------------------------
// Awards and grants calendar: time-bound calls with a deadline and an eligibility checklist.
// ---------------------------------------------------------------------------

export const callKindEnum = pgEnum("call_kind", CALL_KINDS);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who runs the award or grant. */
    funderId: uuid("funder_id")
      .notNull()
      .references(() => funders.id, { onDelete: "restrict" }),
    kind: callKindEnum("kind").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    opensOn: date("opens_on", { mode: "string" }),
    deadline: date("deadline", { mode: "string" }),
    /** For a recurring award whose next dates aren't out yet, e.g. "Usually mid-May to mid-July". */
    usualWindow: text("usual_window"),
    /** Whole rupees, when there is a cash prize or grant amount. */
    amount: bigint("amount", { mode: "number" }),
    amountNote: text("amount_note"),
    categories: text("categories"),
    notes: text("notes"),
    // The checklist a person fills in, and the verdict packages/core/src/awards.ts works out from it.
    checks: jsonb("checks").$type<EligibilityCheck[]>().notNull().default([]),
    eligibility: eligibilityEnum("eligibility").notNull().default("needs_check"),
    eligibilityReasons: jsonb("eligibility_reasons").$type<string[]>(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkedBy: text("checked_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when VE decides not to apply; skipped calls get no reminders. */
    skippedReason: text("skipped_reason"),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("opportunities_title_idx").on(sql`lower(${t.title})`), index("opportunities_deadline_idx").on(t.deadline)],
);

// ---------------------------------------------------------------------------
// Email the portal sends: deadline reminders and the weekly digest. Each email has a dedupe key
// (for example "reminder:<call>:14:<user>") so a reminder or digest is never sent twice.
// ---------------------------------------------------------------------------

export const emailKindEnum = pgEnum("email_kind", ["reminder", "digest"]);
export const emailStatusEnum = pgEnum("email_status", ["queued", "sent", "failed"]);

export const outboundEmails = pgTable(
  "outbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: emailKindEnum("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    status: emailStatusEnum("status").notNull().default("queued"),
    /** Where it went: "outbox" (a local folder) until an email service is set up. */
    provider: text("provider"),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbound_emails_status_idx").on(t.status, t.createdAt), index("outbound_emails_opportunity_idx").on(t.opportunityId)],
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
  opportunities: many(opportunities),
  csrYears: many(csrYears),
  csrBreakdown: many(csrBreakdown),
  grantees: many(funderGrantees),
}));

export const csrYearsRelations = relations(csrYears, ({ one }) => ({
  funder: one(funders, { fields: [csrYears.funderId], references: [funders.id] }),
  dataImport: one(dataImports, { fields: [csrYears.importId], references: [dataImports.id] }),
}));

export const csrBreakdownRelations = relations(csrBreakdown, ({ one }) => ({
  funder: one(funders, { fields: [csrBreakdown.funderId], references: [funders.id] }),
}));

export const funderGranteesRelations = relations(funderGrantees, ({ one }) => ({
  funder: one(funders, { fields: [funderGrantees.funderId], references: [funders.id] }),
}));

export const dataImportsRelations = relations(dataImports, ({ one }) => ({
  creator: one(users, { fields: [dataImports.createdBy], references: [users.id] }),
}));

export const opportunitiesRelations = relations(opportunities, ({ one, many }) => ({
  funder: one(funders, { fields: [opportunities.funderId], references: [funders.id] }),
  checker: one(users, { fields: [opportunities.checkedBy], references: [users.id], relationName: "callChecker" }),
  pursuits: many(pursuits),
}));

export const pursuitsRelations = relations(pursuits, ({ one, many }) => ({
  funder: one(funders, { fields: [pursuits.funderId], references: [funders.id] }),
  opportunity: one(opportunities, { fields: [pursuits.opportunityId], references: [opportunities.id] }),
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
