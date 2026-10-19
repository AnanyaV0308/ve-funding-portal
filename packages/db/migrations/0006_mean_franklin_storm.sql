CREATE TYPE "public"."peer_report_status" AS ENUM('waiting', 'reading', 'ready', 'no_donors', 'failed', 'dismissed');--> statement-breakpoint
CREATE TABLE "peer_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"fy" text,
	"status" "peer_report_status" DEFAULT 'waiting' NOT NULL,
	"donors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pages" integer,
	"pages_read" jsonb,
	"sha256" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
CREATE TABLE "peer_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ngo_name" text NOT NULL,
	"url" text NOT NULL,
	"check_requested_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_ok" boolean,
	"last_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "peer_sources_ngo_name_unique" UNIQUE("ngo_name")
);
--> statement-breakpoint
ALTER TABLE "donor_lists" ADD COLUMN "peer_report_id" uuid;--> statement-breakpoint
ALTER TABLE "peer_reports" ADD CONSTRAINT "peer_reports_source_id_peer_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."peer_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reports" ADD CONSTRAINT "peer_reports_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sources" ADD CONSTRAINT "peer_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "peer_reports_source_url_idx" ON "peer_reports" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "peer_reports_status_idx" ON "peer_reports" USING btree ("status");--> statement-breakpoint
ALTER TABLE "donor_lists" ADD CONSTRAINT "donor_lists_peer_report_id_peer_reports_id_fk" FOREIGN KEY ("peer_report_id") REFERENCES "public"."peer_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "donor_lists_peer_report_idx" ON "donor_lists" USING btree ("peer_report_id");