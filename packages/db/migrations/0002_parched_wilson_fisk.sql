CREATE TYPE "public"."activity_kind" AS ENUM('note', 'call', 'meeting', 'email', 'document');--> statement-breakpoint
CREATE TYPE "public"."funder_type" AS ENUM('company', 'foundation', 'hni', 'intermediary', 'government', 'award_body');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('identified', 'qualified', 'intro_requested', 'contacted', 'in_conversation', 'meeting_held', 'proposal_sent', 'due_diligence', 'committed', 'funds_received', 'not_now', 'spotted', 'eligible', 'drafting', 'in_review', 'approved', 'submitted', 'shortlisted', 'won', 'not_selected');--> statement-breakpoint
CREATE TYPE "public"."track" AS ENUM('relationship', 'application');--> statement-breakpoint
CREATE TABLE "funders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "funder_type" NOT NULL,
	"website" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "pursuit_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pursuit_id" uuid NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"summary" text NOT NULL,
	"occurred_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "pursuit_stage_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pursuit_id" uuid NOT NULL,
	"from_stage" "stage",
	"to_stage" "stage" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text
);
--> statement-breakpoint
CREATE TABLE "pursuits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"title" text NOT NULL,
	"track" "track" NOT NULL,
	"stage" "stage" NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" text,
	"ask_amount" bigint,
	"probability_override" integer,
	"next_action" text,
	"next_action_due" date,
	"closed_reason" text,
	"revisit_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funders" ADD CONSTRAINT "funders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_activities" ADD CONSTRAINT "pursuit_activities_pursuit_id_pursuits_id_fk" FOREIGN KEY ("pursuit_id") REFERENCES "public"."pursuits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_activities" ADD CONSTRAINT "pursuit_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_stage_changes" ADD CONSTRAINT "pursuit_stage_changes_pursuit_id_pursuits_id_fk" FOREIGN KEY ("pursuit_id") REFERENCES "public"."pursuits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_stage_changes" ADD CONSTRAINT "pursuit_stage_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuits" ADD CONSTRAINT "pursuits_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuits" ADD CONSTRAINT "pursuits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuits" ADD CONSTRAINT "pursuits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funders_name_idx" ON "funders" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "pursuit_activities_pursuit_idx" ON "pursuit_activities" USING btree ("pursuit_id","occurred_on");--> statement-breakpoint
CREATE INDEX "pursuit_stage_changes_pursuit_idx" ON "pursuit_stage_changes" USING btree ("pursuit_id","created_at");--> statement-breakpoint
CREATE INDEX "pursuits_track_stage_idx" ON "pursuits" USING btree ("track","stage");--> statement-breakpoint
CREATE INDEX "pursuits_owner_idx" ON "pursuits" USING btree ("owner_id");