import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_module_envelopes_visibility" AS ENUM('private', 'internal_preview', 'public');
  CREATE TYPE "public"."enum_media_evidence_provider" AS ENUM('x', 'approved_cdn', 'first_party');
  CREATE TYPE "public"."enum_media_evidence_media_type" AS ENUM('image', 'video');
  CREATE TYPE "public"."enum_media_evidence_rights_state" AS ENUM('unknown', 'metadata_only', 'display_licensed', 'redistribution_licensed', 'first_party', 'blocked', 'revoked');
  CREATE TYPE "public"."enum_media_evidence_sensitive_content_state" AS ENUM('unknown', 'allowed', 'restricted', 'blocked');
  CREATE TYPE "public"."enum_media_evidence_visibility" AS ENUM('private_evidence', 'internal_preview', 'public');
  CREATE TYPE "public"."enum_media_evidence_delivery_target" AS ENUM('private_reference', 'x_cdn', 'approved_public_cdn');
  CREATE TYPE "public"."enum_page_projections_locale" AS ENUM('en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'sv', 'tr', 'zh-CN', 'zh-TW', 'ar');
  CREATE TYPE "public"."enum_page_projections_family" AS ENUM('hub', 'gallery', 'entity', 'detail');
  CREATE TYPE "public"."enum_page_projections_state" AS ENUM('draft', 'validated', 'released', 'superseded', 'withdrawn');
  ALTER TYPE "public"."enum_workflow_runs_job_type" ADD VALUE 'extract_graph';
  ALTER TYPE "public"."enum_workflow_runs_job_type" ADD VALUE 'generate_module';
  ALTER TYPE "public"."enum_workflow_runs_job_type" ADD VALUE 'project_page';
  ALTER TYPE "public"."enum_workflow_runs_job_type" ADD VALUE 'validate_release';
  ALTER TYPE "public"."enum_workflow_runs_job_type" ADD VALUE 'observe_search';
  CREATE TABLE "media_evidence" (
    "id" serial PRIMARY KEY NOT NULL,
    "media_evidence_id" varchar NOT NULL,
    "source_ref_id" integer NOT NULL,
    "provider" "enum_media_evidence_provider" NOT NULL,
    "provider_media_id" varchar NOT NULL,
    "media_type" "enum_media_evidence_media_type" NOT NULL,
    "width" numeric,
    "height" numeric,
    "duration_ms" numeric,
    "remote_url" varchar NOT NULL,
    "thumbnail_url" varchar,
    "observed_at" timestamp(3) with time zone NOT NULL,
    "rights_state" "enum_media_evidence_rights_state" NOT NULL,
    "sensitive_content_state" "enum_media_evidence_sensitive_content_state" NOT NULL,
    "content_hash" varchar NOT NULL,
    "visibility" "enum_media_evidence_visibility" NOT NULL,
    "delivery_target" "enum_media_evidence_delivery_target" NOT NULL,
    "preview_noindex" boolean DEFAULT true NOT NULL,
    "attribution_url" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "page_projections" (
    "id" serial PRIMARY KEY NOT NULL,
    "projection_id" varchar NOT NULL,
    "page_id" varchar NOT NULL,
    "locale" "enum_page_projections_locale" NOT NULL,
    "family" "enum_page_projections_family" NOT NULL,
    "state" "enum_page_projections_state" NOT NULL,
    "projection" jsonb NOT NULL,
    "dependency_hash" varchar NOT NULL,
    "content_hash" varchar NOT NULL,
    "link_hash" varchar NOT NULL,
    "schema_hash" varchar NOT NULL,
    "workflow_run_id" integer NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  -- Legacy aliases have no safe global semantic mapping. Preserve the exact
  -- label and existing review state, and leave them noncanonical until a human
  -- applies a contextual mapping. This avoids a cast failure on populated DBs.
  DROP INDEX "relation_review_state_idx";
  DROP INDEX "from_key_relation_to_key_source_version_idx";
  ALTER TABLE "edges" RENAME COLUMN "relation" TO "legacy_relation";
  ALTER TYPE "public"."enum_edges_relation" RENAME TO "enum_edges_relation_legacy";
  CREATE TYPE "public"."enum_edges_relation" AS ENUM('generated_with', 'used_for', 'produces', 'has_style', 'uses_technique', 'depicts', 'targets_audience', 'created_by', 'sourced_from', 'variation_of', 'member_of', 'compared_with', 'requires_input');
  ALTER TABLE "edges" ADD COLUMN "relation" "enum_edges_relation";
  ALTER TABLE "edges" ADD COLUMN "legacy_relation_label" varchar;
  ALTER TABLE "edges" ADD COLUMN "relation_migration_state" varchar;
  UPDATE "edges" SET
    "relation" = CASE WHEN "legacy_relation"::text IN ('generated_with', 'used_for', 'produces', 'has_style', 'uses_technique', 'depicts', 'targets_audience', 'created_by', 'sourced_from', 'variation_of', 'member_of', 'compared_with', 'requires_input') THEN "legacy_relation"::text::"enum_edges_relation" ELSE NULL END,
    "legacy_relation_label" = CASE WHEN "legacy_relation"::text IN ('generated_with', 'used_for', 'produces', 'has_style', 'uses_technique', 'depicts', 'targets_audience', 'created_by', 'sourced_from', 'variation_of', 'member_of', 'compared_with', 'requires_input') THEN NULL ELSE "legacy_relation"::text END,
    "relation_migration_state" = CASE WHEN "legacy_relation"::text IN ('generated_with', 'used_for', 'produces', 'has_style', 'uses_technique', 'depicts', 'targets_audience', 'created_by', 'sourced_from', 'variation_of', 'member_of', 'compared_with', 'requires_input') THEN 'canonical' ELSE 'requires_review' END;
  ALTER TABLE "edges" DROP COLUMN "legacy_relation";
  DROP TYPE "public"."enum_edges_relation_legacy";
  CREATE INDEX "relation_review_state_idx" ON "edges" USING btree ("relation","review_state");
  CREATE UNIQUE INDEX "from_key_relation_to_key_source_version_idx" ON "edges" USING btree ("from_key","relation","to_key","source_version") WHERE "relation" IS NOT NULL;
  ALTER TABLE "module_envelopes" ADD COLUMN "payload" jsonb;
  ALTER TABLE "module_envelopes" ADD COLUMN "slot_key" varchar;
  ALTER TABLE "module_envelopes" ADD COLUMN "position" numeric;
  ALTER TABLE "module_envelopes" ADD COLUMN "dependency_hash" varchar;
  ALTER TABLE "module_envelopes" ADD COLUMN "quality_result" jsonb;
  ALTER TABLE "module_envelopes" ADD COLUMN "risk_classes" jsonb;
  ALTER TABLE "module_envelopes" ADD COLUMN "visibility" "enum_module_envelopes_visibility";
  ALTER TABLE "module_envelopes" ADD COLUMN "renderer_version" varchar;
  ALTER TABLE "module_envelopes" ADD COLUMN "stale_reason" varchar;
  ALTER TABLE "module_envelopes_rels" ADD COLUMN "module_envelopes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "media_evidence_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "page_projections_id" integer;
  ALTER TABLE "media_evidence" ADD CONSTRAINT "media_evidence_source_ref_id_sources_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "page_projections" ADD CONSTRAINT "page_projections_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;
  CREATE UNIQUE INDEX "media_evidence_media_evidence_id_idx" ON "media_evidence" USING btree ("media_evidence_id");
  CREATE INDEX "media_evidence_source_ref_idx" ON "media_evidence" USING btree ("source_ref_id");
  CREATE INDEX "media_evidence_provider_media_id_idx" ON "media_evidence" USING btree ("provider_media_id");
  CREATE INDEX "media_evidence_observed_at_idx" ON "media_evidence" USING btree ("observed_at");
  CREATE INDEX "media_evidence_content_hash_idx" ON "media_evidence" USING btree ("content_hash");
  CREATE INDEX "media_evidence_updated_at_idx" ON "media_evidence" USING btree ("updated_at");
  CREATE INDEX "media_evidence_created_at_idx" ON "media_evidence" USING btree ("created_at");
  CREATE UNIQUE INDEX "provider_provider_media_id_idx" ON "media_evidence" USING btree ("provider","provider_media_id");
  CREATE UNIQUE INDEX "page_projections_projection_id_idx" ON "page_projections" USING btree ("projection_id");
  CREATE INDEX "page_projections_page_id_idx" ON "page_projections" USING btree ("page_id");
  CREATE INDEX "page_projections_dependency_hash_idx" ON "page_projections" USING btree ("dependency_hash");
  CREATE INDEX "page_projections_content_hash_idx" ON "page_projections" USING btree ("content_hash");
  CREATE INDEX "page_projections_link_hash_idx" ON "page_projections" USING btree ("link_hash");
  CREATE INDEX "page_projections_schema_hash_idx" ON "page_projections" USING btree ("schema_hash");
  CREATE INDEX "page_projections_workflow_run_idx" ON "page_projections" USING btree ("workflow_run_id");
  CREATE INDEX "page_projections_updated_at_idx" ON "page_projections" USING btree ("updated_at");
  CREATE INDEX "page_projections_created_at_idx" ON "page_projections" USING btree ("created_at");
  CREATE UNIQUE INDEX "projection_id_idx" ON "page_projections" USING btree ("projection_id");
  CREATE INDEX "page_id_locale_state_idx" ON "page_projections" USING btree ("page_id","locale","state");
  CREATE INDEX "dependency_hash_idx" ON "page_projections" USING btree ("dependency_hash");
  CREATE INDEX "content_hash_idx" ON "page_projections" USING btree ("content_hash");
  ALTER TABLE "module_envelopes_rels" ADD CONSTRAINT "module_envelopes_rels_module_envelopes_fk" FOREIGN KEY ("module_envelopes_id") REFERENCES "public"."module_envelopes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_evidence_fk" FOREIGN KEY ("media_evidence_id") REFERENCES "public"."media_evidence"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_page_projections_fk" FOREIGN KEY ("page_projections_id") REFERENCES "public"."page_projections"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "module_envelopes_dependency_hash_idx" ON "module_envelopes" USING btree ("dependency_hash");
  CREATE INDEX "module_envelopes_rels_module_envelopes_id_idx" ON "module_envelopes_rels" USING btree ("module_envelopes_id");
  CREATE INDEX "payload_locked_documents_rels_media_evidence_id_idx" ON "payload_locked_documents_rels" USING btree ("media_evidence_id");
  CREATE INDEX "payload_locked_documents_rels_page_projections_id_idx" ON "payload_locked_documents_rels" USING btree ("page_projections_id");
  `)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  // Projection bytes and their source evidence are append-only. Restore uses a
  // fresh target instead of destructive rollback, while ledger replays stay safe.
  await db.execute(sql`SELECT 1`)
}
