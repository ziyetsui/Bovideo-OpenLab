import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Phase A recovery/provenance fields; legacy running rows are reclaimable. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "workflow_runs" ADD COLUMN "lease_owner" varchar;
    ALTER TABLE "workflow_runs" ADD COLUMN "lease_expires_at" timestamp(3) with time zone;
    UPDATE "workflow_runs" SET "lease_expires_at" = NOW() WHERE "status" = 'running';
    CREATE INDEX "status_lease_expires_at_idx" ON "workflow_runs" USING btree ("status","lease_expires_at");
    ALTER TABLE "page_projections" ADD COLUMN "renderer_version" varchar;
    ALTER TABLE "page_projections" ADD COLUMN "validation_report_ref" varchar;
    UPDATE "page_projections" SET "renderer_version" = 'legacy-unprojectable', "validation_report_ref" = 'private/validation/legacy-unprojectable' WHERE "renderer_version" IS NULL;
    ALTER TABLE "page_projections" ALTER COLUMN "renderer_version" SET NOT NULL;
    ALTER TABLE "page_projections" ALTER COLUMN "validation_report_ref" SET NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
