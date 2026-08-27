import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Keeps Payload's generated document-lock relation table in sync with configured collections. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "source_observations_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "publication_projections_id" integer;
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_source_observations_fk";
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_observations_fk"
      FOREIGN KEY ("source_observations_id") REFERENCES "public"."source_observations"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_publication_projections_fk";
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publication_projections_fk"
      FOREIGN KEY ("publication_projections_id") REFERENCES "public"."publication_projections"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_source_observations_id_idx"
      ON "payload_locked_documents_rels" USING btree ("source_observations_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_publication_projections_id_idx"
      ON "payload_locked_documents_rels" USING btree ("publication_projections_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
