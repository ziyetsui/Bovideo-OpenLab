import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Consolidate the two historical X providers without discarding their raw
 * evidence. The source-observations rows are written before aliases are
 * repointed/deleted, so every source raw_ref remains queryable privately.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "semantic_key" varchar;

    CREATE TABLE IF NOT EXISTS "source_observations" (
      "id" serial PRIMARY KEY NOT NULL,
      "stable_id" varchar NOT NULL,
      "revision" numeric DEFAULT 1 NOT NULL,
      "schema_version" numeric DEFAULT 1 NOT NULL,
      "source_version" varchar NOT NULL,
      "source_ref_id" integer NOT NULL,
      "workflow_run_id" integer NOT NULL,
      "provider" varchar NOT NULL,
      "provider_record_id" varchar NOT NULL,
      "canonical_url" varchar NOT NULL,
      "raw_ref" jsonb NOT NULL,
      "captured_at" timestamp(3) with time zone NOT NULL,
      "content_hash" varchar NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "source_observations" DROP CONSTRAINT IF EXISTS "source_observations_source_ref_id_sources_id_fk";
    ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_source_ref_id_sources_id_fk"
      FOREIGN KEY ("source_ref_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "source_observations" DROP CONSTRAINT IF EXISTS "source_observations_workflow_run_id_workflow_runs_id_fk";
    ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_workflow_run_id_workflow_runs_id_fk"
      FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;

    CREATE UNIQUE INDEX IF NOT EXISTS "source_observations_stable_id_idx" ON "source_observations" USING btree ("stable_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "source_observations_provider_record_content_idx" ON "source_observations" USING btree ("provider", "provider_record_id", "content_hash");
    CREATE INDEX IF NOT EXISTS "source_observations_source_captured_idx" ON "source_observations" USING btree ("source_ref_id", "captured_at");
    CREATE INDEX IF NOT EXISTS "source_observations_workflow_run_idx" ON "source_observations" USING btree ("workflow_run_id");
    CREATE INDEX IF NOT EXISTS "source_observations_provider_idx" ON "source_observations" USING btree ("provider");
    CREATE INDEX IF NOT EXISTS "source_observations_provider_record_idx" ON "source_observations" USING btree ("provider_record_id");
    CREATE INDEX IF NOT EXISTS "source_observations_source_version_idx" ON "source_observations" USING btree ("source_version");
    CREATE INDEX IF NOT EXISTS "source_observations_captured_at_idx" ON "source_observations" USING btree ("captured_at");
    CREATE INDEX IF NOT EXISTS "source_observations_content_hash_idx" ON "source_observations" USING btree ("content_hash");

    WITH backfill_run AS (
      INSERT INTO "workflow_runs" (
        "stable_id", "revision", "schema_version", "source_version", "status", "job_type", "idempotency_key", "attempt", "input_ref", "output_ref", "error_class"
      ) VALUES (
        '00000000-0000-4000-8000-0000000000b1', 1, 1,
        'sha256:v1:4fca3c08b4af1658e38505c96cf4f7d23dc2443b0a1a2d5c7a0127f0e65e7b11',
        'succeeded', 'ingest', 'source-observation-backfill-v1', 0,
        'private/source-observations/backfill-v1', 'private/source-observations/backfill-v1', NULL
      ) ON CONFLICT ("job_type", "idempotency_key") DO UPDATE
        SET "output_ref" = EXCLUDED."output_ref"
      RETURNING "id"
    ), ranked AS (
      SELECT
        s.*,
        first_value(s."id") OVER (
          PARTITION BY s."provider_record_id"
          ORDER BY CASE s."provider"::text WHEN 'twitter241' THEN 0 WHEN 'x_public_search' THEN 1 ELSE 2 END, s."id"
        ) AS canonical_source_id
      FROM "sources" s
      WHERE s."provider"::text IN ('twitter241', 'x_public_search')
    )
    INSERT INTO "source_observations" (
      "stable_id", "revision", "schema_version", "source_version", "source_ref_id", "workflow_run_id",
      "provider", "provider_record_id", "canonical_url", "raw_ref", "captured_at", "content_hash"
    )
    SELECT
      substr(md5('source-observation:' || ranked."id"::text), 1, 8) || '-' ||
        substr(md5('source-observation:' || ranked."id"::text), 9, 4) || '-4' ||
        substr(md5('source-observation:' || ranked."id"::text), 14, 3) || '-8' ||
        substr(md5('source-observation:' || ranked."id"::text), 18, 3) || '-' ||
        substr(md5('source-observation:' || ranked."id"::text), 21, 12),
      1, 1, ranked."source_version", ranked.canonical_source_id, backfill_run."id",
      ranked."provider"::text, ranked."provider_record_id", ranked."canonical_url", ranked."raw_ref", ranked."captured_at", ranked."content_hash"
    FROM ranked CROSS JOIN backfill_run
    ON CONFLICT ("provider", "provider_record_id", "content_hash") DO NOTHING;

    -- Exact prompt text is the same semantic artifact. Delete only the
    -- redundant alias copy; non-identical prompts remain until reviewed.
    WITH aliases AS (
      SELECT s."id" AS alias_id,
        first_value(s."id") OVER (PARTITION BY s."provider_record_id" ORDER BY CASE s."provider"::text WHEN 'twitter241' THEN 0 ELSE 1 END, s."id") AS canonical_id
      FROM "sources" s WHERE s."provider"::text IN ('twitter241', 'x_public_search')
    )
    DELETE FROM "prompt_artifacts" alias_artifact
    USING aliases, "prompt_artifacts" canonical_artifact
    WHERE aliases.alias_id = alias_artifact."source_id"
      AND aliases.alias_id <> aliases.canonical_id
      AND canonical_artifact."source_id" = aliases.canonical_id
      AND canonical_artifact."kind" = alias_artifact."kind"
      AND canonical_artifact."prompt_original_text" = alias_artifact."prompt_original_text";

    -- Repoint any remaining non-conflicting artifacts to the canonical source.
    WITH aliases AS (
      SELECT s."id" AS alias_id,
        first_value(s."id") OVER (PARTITION BY s."provider_record_id" ORDER BY CASE s."provider"::text WHEN 'twitter241' THEN 0 ELSE 1 END, s."id") AS canonical_id
      FROM "sources" s WHERE s."provider"::text IN ('twitter241', 'x_public_search')
    )
    UPDATE "prompt_artifacts" artifact SET "source_id" = aliases.canonical_id
    FROM aliases
    WHERE artifact."source_id" = aliases.alias_id
      AND aliases.alias_id <> aliases.canonical_id
      AND NOT EXISTS (
        SELECT 1 FROM "prompt_artifacts" existing
        WHERE existing."source_id" = aliases.canonical_id
          AND existing."kind" = artifact."kind"
          AND existing."source_version" = artifact."source_version"
      );

    -- Media with an identical source-independent URL is the same evidence
    -- fact. Keep the first canonical copy and repoint unique leftovers.
    WITH aliases AS (
      SELECT s."id" AS alias_id,
        first_value(s."id") OVER (PARTITION BY s."provider_record_id" ORDER BY CASE s."provider"::text WHEN 'twitter241' THEN 0 ELSE 1 END, s."id") AS canonical_id
      FROM "sources" s WHERE s."provider"::text IN ('twitter241', 'x_public_search')
    )
    DELETE FROM "media_evidence" alias_media
    USING aliases, "media_evidence" canonical_media
    WHERE aliases.alias_id = alias_media."source_ref_id"
      AND aliases.alias_id <> aliases.canonical_id
      AND canonical_media."source_ref_id" = aliases.canonical_id
      AND canonical_media."remote_url" = alias_media."remote_url";

    WITH aliases AS (
      SELECT s."id" AS alias_id,
        first_value(s."id") OVER (PARTITION BY s."provider_record_id" ORDER BY CASE s."provider"::text WHEN 'twitter241' THEN 0 ELSE 1 END, s."id") AS canonical_id
      FROM "sources" s WHERE s."provider"::text IN ('twitter241', 'x_public_search')
    )
    UPDATE "media_evidence" media SET "source_ref_id" = aliases.canonical_id
    FROM aliases
    WHERE media."source_ref_id" = aliases.alias_id
      AND aliases.alias_id <> aliases.canonical_id
      AND NOT EXISTS (
        SELECT 1 FROM "media_evidence" existing
        WHERE existing."source_ref_id" = aliases.canonical_id
          AND existing."remote_url" = media."remote_url"
      );

    -- A source with no remaining direct facts can now be removed safely. Its
    -- private source-observation row retains the original provider/raw_ref.
    WITH aliases AS (
      SELECT s."id" AS alias_id,
        first_value(s."id") OVER (PARTITION BY s."provider_record_id" ORDER BY CASE s."provider"::text WHEN 'twitter241' THEN 0 ELSE 1 END, s."id") AS canonical_id
      FROM "sources" s WHERE s."provider"::text IN ('twitter241', 'x_public_search')
    )
    DELETE FROM "sources" source
    USING aliases
    WHERE source."id" = aliases.alias_id
      AND aliases.alias_id <> aliases.canonical_id
      AND NOT EXISTS (SELECT 1 FROM "prompt_artifacts" artifact WHERE artifact."source_id" = source."id")
      AND NOT EXISTS (SELECT 1 FROM "media_evidence" media WHERE media."source_ref_id" = source."id");

    UPDATE "sources"
      SET "semantic_key" = 'x-status:' || "provider_record_id"
      WHERE "provider"::text IN ('twitter241', 'x_public_search')
        AND "semantic_key" IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "sources_semantic_key_unique_idx"
      ON "sources" USING btree ("semantic_key") WHERE "semantic_key" IS NOT NULL;
  `)
}

/** Source aliases are evidence history; rollback must not discard it. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
