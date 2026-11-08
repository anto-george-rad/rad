CREATE TABLE IF NOT EXISTS "agent_leave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"direction" text NOT NULL,
	"subject" text NOT NULL,
	"snippet" text,
	"from_email" text,
	"to_emails" text,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"web_link" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escalation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid,
	"level" integer NOT NULL,
	"after_minutes" integer DEFAULT 0 NOT NULL,
	"target" text NOT NULL,
	"user_id" uuid,
	"reassign" boolean DEFAULT false NOT NULL,
	"raise_priority" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forum_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"body" text NOT NULL,
	"contact_id" uuid,
	"user_id" uuid,
	"author_name" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forum_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"contact_id" uuid,
	"user_id" uuid,
	"author_name" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"answer_id" uuid,
	"views" integer DEFAULT 0 NOT NULL,
	"last_post_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "licences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"vendor" text,
	"seats" integer DEFAULT 1 NOT NULL,
	"licence_key" text,
	"start_date" date,
	"end_date" date,
	"value" double precision,
	"currency" text DEFAULT 'AED' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deal_id" uuid,
	"renewal_deal_id" uuid,
	"notes" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"day" integer DEFAULT 1 NOT NULL,
	"hour" integer DEFAULT 8 NOT NULL,
	"recipient_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'incident' NOT NULL,
	"status" text DEFAULT 'investigating' NOT NULL,
	"impact" text DEFAULT 'minor' NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"ticket_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tier" text DEFAULT 'Standard' NOT NULL,
	"sla_policy_id" uuid,
	"hours_included" double precision,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"value" double precision,
	"currency" text DEFAULT 'AED' NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deal_id" uuid,
	"notes" text,
	"low_hours_warned_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_threads" ADD COLUMN "attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "vendor_name" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "vendor_case_no" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "vendor_status" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "vendor_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalation_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "is_incident" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "incident_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sentiment" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "handoff_lead_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "skills" jsonb DEFAULT '{"products":[],"vendors":[],"languages":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shift" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mail_sync" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mail_synced_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_leave" ADD CONSTRAINT "agent_leave_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_topic_id_forum_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."forum_topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "licences" ADD CONSTRAINT "licences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "licences" ADD CONSTRAINT "licences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "licences" ADD CONSTRAINT "licences_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_contracts" ADD CONSTRAINT "support_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_logs_msg_idx" ON "email_logs" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_contact_idx" ON "email_logs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_deal_idx" ON "email_logs" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_company_idx" ON "email_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forum_posts_topic_idx" ON "forum_posts" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "licences_company_idx" ON "licences" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "licences_end_idx" ON "licences" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_contracts_company_idx" ON "support_contracts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_owner_idx" ON "activities" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_owner_idx" ON "companies" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_parent_idx" ON "companies" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_owner_idx" ON "deals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_contact_idx" ON "deals" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_closed_idx" ON "deals" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_time_ticket_idx" ON "ticket_time" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_due_idx" ON "tickets" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_created_idx" ON "tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_incident_idx" ON "tickets" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_contract_idx" ON "tickets" USING btree ("contract_id");