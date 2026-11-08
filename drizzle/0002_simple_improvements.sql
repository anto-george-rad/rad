CREATE TABLE IF NOT EXISTS "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"related_type" text NOT NULL,
	"related_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"dedupe_key" text,
	"summary" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "duration_min" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "attendees" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "manager_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "account_type" text DEFAULT 'Prospect' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "emirate" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "zone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trade_licence_no" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trade_licence_expiry" date;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "licence_reminder_for" date;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "employees" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "annual_revenue" double precision;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "linkedin" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "customer_since" date;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "buying_role" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "linkedin" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "birthday" date;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "win_reason" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "amount_base" double precision;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "deal_type" text DEFAULT 'New business' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "lead_source" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "contract_start" date;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "contract_end" date;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "term_months" integer;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "recurring_value" double precision;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "renewal_deal_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "tender_number" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "submission_deadline" date;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "payment_terms" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "emirate" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "company_size" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "budget" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "timeline" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "product_interest_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "disqual_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "first_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "cost_price" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "billing_type" text DEFAULT 'One-time' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_target" double precision;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_rel_idx" ON "attachments" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_runs_dedupe_idx" ON "automation_runs" USING btree ("automation_id","record_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_auto_idx" ON "automation_runs" USING btree ("automation_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_uniq" ON "favorites" USING btree ("user_id","record_type","record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");