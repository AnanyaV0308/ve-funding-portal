CREATE TABLE "donor_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ngo_name" text NOT NULL,
	"fy" text,
	"source_label" text NOT NULL,
	"source_url" text,
	"new_funder_type" "funder_type" DEFAULT 'company' NOT NULL,
	"donor_count" integer NOT NULL,
	"matched_count" integer NOT NULL,
	"created_funder_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "funder_grantees" ADD COLUMN "donor_list_id" uuid;--> statement-breakpoint
ALTER TABLE "donor_lists" ADD CONSTRAINT "donor_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funder_grantees" ADD CONSTRAINT "funder_grantees_donor_list_id_donor_lists_id_fk" FOREIGN KEY ("donor_list_id") REFERENCES "public"."donor_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funder_grantees_list_idx" ON "funder_grantees" USING btree ("donor_list_id");