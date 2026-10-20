CREATE TYPE "public"."csr_plan_status" AS ENUM('waiting', 'reading', 'read', 'not_plan', 'failed');--> statement-breakpoint
CREATE TABLE "csr_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"origin" "company_report_origin" NOT NULL,
	"url" text,
	"file_key" text,
	"title" text NOT NULL,
	"fy" text,
	"status" "csr_plan_status" DEFAULT 'waiting' NOT NULL,
	"budget" bigint,
	"policy_url" text,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"partners" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"left_out" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pages" integer,
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
ALTER TABLE "funder_grantees" ADD COLUMN "csr_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "plan_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "plan_check_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "plan_check_result" text;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "csr_policy_url" text;--> statement-breakpoint
ALTER TABLE "csr_plans" ADD CONSTRAINT "csr_plans_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csr_plans" ADD CONSTRAINT "csr_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "csr_plans_funder_url_idx" ON "csr_plans" USING btree ("funder_id","url");--> statement-breakpoint
CREATE INDEX "csr_plans_status_idx" ON "csr_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "csr_plans_funder_idx" ON "csr_plans" USING btree ("funder_id","fy");--> statement-breakpoint
ALTER TABLE "funder_grantees" ADD CONSTRAINT "funder_grantees_csr_plan_id_csr_plans_id_fk" FOREIGN KEY ("csr_plan_id") REFERENCES "public"."csr_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funder_grantees_plan_idx" ON "funder_grantees" USING btree ("csr_plan_id");