CREATE TYPE "public"."company_report_origin" AS ENUM('search', 'link', 'upload');--> statement-breakpoint
CREATE TYPE "public"."company_report_status" AS ENUM('waiting', 'reading', 'read', 'no_csr', 'failed');--> statement-breakpoint
CREATE TABLE "company_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"origin" "company_report_origin" NOT NULL,
	"url" text,
	"file_key" text,
	"title" text NOT NULL,
	"fy" text,
	"status" "company_report_status" DEFAULT 'waiting' NOT NULL,
	"obligation" bigint,
	"spent" bigint,
	"unspent" bigint,
	"policy_url" text,
	"partners" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"left_out" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disability_work" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pages" integer,
	"pages_read" jsonb,
	"sha256" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "funder_grantees" ADD COLUMN "company_report_id" uuid;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "report_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "report_check_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "report_check_result" text;--> statement-breakpoint
ALTER TABLE "company_reports" ADD CONSTRAINT "company_reports_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_reports" ADD CONSTRAINT "company_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_reports_funder_url_idx" ON "company_reports" USING btree ("funder_id","url");--> statement-breakpoint
CREATE INDEX "company_reports_status_idx" ON "company_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "company_reports_funder_idx" ON "company_reports" USING btree ("funder_id","fy");--> statement-breakpoint
ALTER TABLE "funder_grantees" ADD CONSTRAINT "funder_grantees_company_report_id_company_reports_id_fk" FOREIGN KEY ("company_report_id") REFERENCES "public"."company_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funder_grantees_report_idx" ON "funder_grantees" USING btree ("company_report_id");