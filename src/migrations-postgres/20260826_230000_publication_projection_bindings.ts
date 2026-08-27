import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Persistent release manifest entries: one active version resolves exact immutable page bytes. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    -- Payload's document-lock query enumerates every configured collection.
    -- The earlier source-observation migration predated that collection's
    -- lock relation column, so repair both additive columns here before a
    -- workflow update attempts a lock check.
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "source_observations_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "publication_projections_id" integer;
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_source_observations_fk";
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_observations_fk"
      FOREIGN KEY ("source_observations_id") REFERENCES "public"."source_observations"("id") ON DELETE cascade ON UPDATE no action;
    CREATE TABLE IF NOT EXISTS "publication_projections" (
      "id" serial PRIMARY KEY NOT NULL,
      "publish_version" numeric NOT NULL,
      "projection_id" integer NOT NULL,
      "route" varchar NOT NULL,
      "locale" "enum_page_projections_locale" NOT NULL,
      "family" "enum_page_projections_family" NOT NULL,
      "internal_noindex" boolean DEFAULT true NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "publication_projections" DROP CONSTRAINT IF EXISTS "publication_projections_projection_id_page_projections_id_fk";
    ALTER TABLE "publication_projections" ADD CONSTRAINT "publication_projections_projection_id_page_projections_id_fk"
      FOREIGN KEY ("projection_id") REFERENCES "public"."page_projections"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_publication_projections_fk";
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publication_projections_fk"
      FOREIGN KEY ("publication_projections_id") REFERENCES "public"."publication_projections"("id") ON DELETE cascade ON UPDATE no action;
    CREATE UNIQUE INDEX IF NOT EXISTS "publication_projections_version_route_idx"
      ON "publication_projections" USING btree ("publish_version", "locale", "family", "route");
    CREATE UNIQUE INDEX IF NOT EXISTS "publication_projections_version_projection_idx"
      ON "publication_projections" USING btree ("publish_version", "projection_id");
    CREATE INDEX IF NOT EXISTS "publication_projections_projection_idx"
      ON "publication_projections" USING btree ("projection_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_source_observations_id_idx"
      ON "payload_locked_documents_rels" USING btree ("source_observations_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_publication_projections_id_idx"
      ON "payload_locked_documents_rels" USING btree ("publication_projections_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
