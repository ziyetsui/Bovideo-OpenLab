import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Additive, append-only storage for reviewer-bound golden replacements. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."enum_golden_replacement_approvals_status" AS ENUM('recorded');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE "public"."enum_golden_replacement_approvals_reviewer_role" AS ENUM('reviewer');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE "public"."enum_golden_replacement_approvals_audit_outcome" AS ENUM('allowed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE IF NOT EXISTS "golden_replacement_approvals" (
      "id" serial PRIMARY KEY NOT NULL,
      "stable_id" varchar NOT NULL,
      "revision" numeric DEFAULT 1 NOT NULL,
      "schema_version" numeric DEFAULT 1 NOT NULL,
      "source_version" varchar NOT NULL,
      "status" "enum_golden_replacement_approvals_status" DEFAULT 'recorded' NOT NULL,
      "audit_created_by_id" integer,
      "audit_updated_by_id" integer,
      "audit_correlation_id" varchar,
      "baseline_manifest_hash" varchar NOT NULL,
      "candidate_manifest_hash" varchar NOT NULL,
      "evaluator_version" varchar NOT NULL,
      "reviewer_user_id" integer NOT NULL,
      "reviewer_actor_id" varchar NOT NULL,
      "reviewer_role" "enum_golden_replacement_approvals_reviewer_role" DEFAULT 'reviewer' NOT NULL,
      "correlation_id" varchar NOT NULL,
      "approved_at" timestamp(3) with time zone NOT NULL,
      "audit_ref" varchar NOT NULL,
      "audit_outcome" "enum_golden_replacement_approvals_audit_outcome" DEFAULT 'allowed' NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    DO $$ BEGIN
      ALTER TABLE "golden_replacement_approvals" ADD CONSTRAINT "golden_replacement_approvals_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE "golden_replacement_approvals" ADD CONSTRAINT "golden_replacement_approvals_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE "golden_replacement_approvals" ADD CONSTRAINT "golden_replacement_approvals_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "golden_replacement_approvals_id" integer;
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_golden_replacement_approvals_fk" FOREIGN KEY ("golden_replacement_approvals_id") REFERENCES "public"."golden_replacement_approvals"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS "golden_replacement_approvals_stable_id_idx" ON "golden_replacement_approvals" USING btree ("stable_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "golden_replacement_approvals_manifest_evaluator_idx" ON "golden_replacement_approvals" USING btree ("baseline_manifest_hash", "candidate_manifest_hash", "evaluator_version");
    CREATE UNIQUE INDEX IF NOT EXISTS "golden_replacement_approvals_correlation_id_idx" ON "golden_replacement_approvals" USING btree ("correlation_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "golden_replacement_approvals_audit_ref_idx" ON "golden_replacement_approvals" USING btree ("audit_ref");
    CREATE INDEX IF NOT EXISTS "golden_replacement_approvals_reviewer_actor_id_idx" ON "golden_replacement_approvals" USING btree ("reviewer_actor_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_golden_replacement_approvals_id_idx" ON "payload_locked_documents_rels" USING btree ("golden_replacement_approvals_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Approval evidence is immutable. Rollback is restore-required and preserves
  // the durable table; `up` is deliberately idempotent so a ledger replay is safe.
  await db.execute(sql`SELECT 1`)
}
