CREATE TYPE "public"."call_kind" AS ENUM('award', 'grant', 'rfp');--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('reminder', 'digest');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"kind" "call_kind" NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"opens_on" date,
	"deadline" date,
	"usual_window" text,
	"amount" bigint,
	"amount_note" text,
	"categories" text,
	"notes" text,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eligibility" "eligibility" DEFAULT 'needs_check' NOT NULL,
	"eligibility_reasons" jsonb,
	"checked_at" timestamp with time zone,
	"checked_by" text,
	"skipped_reason" text,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "email_kind" NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_user_id" text,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"opportunity_id" uuid,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbound_emails_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "pursuits" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reminder_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_title_idx" ON "opportunities" USING btree (lower("title"));--> statement-breakpoint
CREATE INDEX "opportunities_deadline_idx" ON "opportunities" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "outbound_emails_status_idx" ON "outbound_emails" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbound_emails_opportunity_idx" ON "outbound_emails" USING btree ("opportunity_id");--> statement-breakpoint
ALTER TABLE "pursuits" ADD CONSTRAINT "pursuits_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pursuits_opportunity_idx" ON "pursuits" USING btree ("opportunity_id");