CREATE TYPE "public"."consent_status" AS ENUM('given', 'pending', 'not_given');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('annual_report', 'audited_accounts', 'registration', 'policy', 'proposal', 'mou', 'award_citation', 'other');--> statement-breakpoint
CREATE TYPE "public"."knowledge_category" AS ENUM('organisation', 'impact', 'programme', 'story', 'answer', 'budget');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"period" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "knowledge_category" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"as_of" date,
	"source_label" text,
	"source_url" text,
	"consent" "consent_status",
	"owner_id" text,
	"refresh_months" integer DEFAULT 12 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_facts_category_title_idx" ON "knowledge_facts" USING btree ("category","title");