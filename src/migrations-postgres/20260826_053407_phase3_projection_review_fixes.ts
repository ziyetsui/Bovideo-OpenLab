import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "module_envelopes" ALTER COLUMN "payload" DROP NOT NULL;
  ALTER TABLE "module_envelopes" ALTER COLUMN "slot_key" DROP NOT NULL;
  ALTER TABLE "module_envelopes" ALTER COLUMN "position" DROP NOT NULL;
  ALTER TABLE "module_envelopes" ALTER COLUMN "dependency_hash" DROP NOT NULL;
  ALTER TABLE "module_envelopes" ALTER COLUMN "quality_result" DROP NOT NULL;
  ALTER TABLE "module_envelopes" ALTER COLUMN "risk_classes" DROP NOT NULL;
  ALTER TABLE "module_envelopes" ALTER COLUMN "visibility" DROP NOT NULL;
  ALTER TABLE "module_envelopes" ALTER COLUMN "renderer_version" DROP NOT NULL;
  ALTER TABLE "media_evidence" ADD COLUMN "source_version" varchar;
  ALTER TABLE "media_evidence" ADD COLUMN "workflow_run_id" integer;
  ALTER TABLE "media_evidence" ADD CONSTRAINT "media_evidence_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "media_evidence_source_version_idx" ON "media_evidence" USING btree ("source_version");
  CREATE INDEX "media_evidence_workflow_run_idx" ON "media_evidence" USING btree ("workflow_run_id");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
