CREATE TYPE "public"."csr_breakdown_kind" AS ENUM('sector', 'state');--> statement-breakpoint
CREATE TYPE "public"."eligibility" AS ENUM('eligible', 'needs_check', 'not_eligible');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "csr_breakdown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"kind" "csr_breakdown_kind" NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csr_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"spent" bigint NOT NULL,
	"prescribed" bigint,
	"project_count" integer DEFAULT 0 NOT NULL,
	"import_id" uuid
);
--> statement-breakpoint
CREATE TABLE "data_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"unit" text DEFAULT 'auto' NOT NULL,
	"status" "import_status" DEFAULT 'queued' NOT NULL,
	"rows_read" integer,
	"companies" integer,
	"funders_created" integer,
	"problems" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "funder_grantees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fy" text,
	"amount" bigint,
	"source_label" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "cin" text;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "is_foreign" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "warm_path" text;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "eligibility" "eligibility";--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "eligibility_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "fit_score" integer;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "fit_parts" jsonb;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "fit_summary" text;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "latest_fy" text;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "latest_spend" bigint;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "ticket_estimate" bigint;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "ticket_basis" text;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csr_breakdown" ADD CONSTRAINT "csr_breakdown_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csr_years" ADD CONSTRAINT "csr_years_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csr_years" ADD CONSTRAINT "csr_years_import_id_data_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."data_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funder_grantees" ADD CONSTRAINT "funder_grantees_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funder_grantees" ADD CONSTRAINT "funder_grantees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "csr_breakdown_idx" ON "csr_breakdown" USING btree ("funder_id","fy","kind","name");--> statement-breakpoint
CREATE INDEX "csr_breakdown_name_idx" ON "csr_breakdown" USING btree ("kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "csr_years_funder_fy_idx" ON "csr_years" USING btree ("funder_id","fy");--> statement-breakpoint
CREATE INDEX "csr_years_fy_idx" ON "csr_years" USING btree ("fy");--> statement-breakpoint
CREATE INDEX "funder_grantees_funder_idx" ON "funder_grantees" USING btree ("funder_id");--> statement-breakpoint
CREATE INDEX "funders_fit_idx" ON "funders" USING btree ("eligibility","fit_score");--> statement-breakpoint
ALTER TABLE "funders" ADD CONSTRAINT "funders_cin_unique" UNIQUE("cin");