import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
    CREATE TYPE "public"."enum_locale_variants_risk_classes" AS ENUM('money', 'comparison', 'price', 'legal_rights');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE IF NOT EXISTS "locale_variants_risk_classes" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_locale_variants_risk_classes",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  DO $$ BEGIN
    ALTER TABLE "locale_variants_risk_classes" ADD CONSTRAINT "locale_variants_risk_classes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locale_variants"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE INDEX IF NOT EXISTS "locale_variants_risk_classes_order_idx" ON "locale_variants_risk_classes" USING btree ("order");
  CREATE INDEX IF NOT EXISTS "locale_variants_risk_classes_parent_idx" ON "locale_variants_risk_classes" USING btree ("parent_id");
  CREATE INDEX IF NOT EXISTS "locale_variants_risk_classes_value_idx" ON "locale_variants_risk_classes" USING btree ("value");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  // Locale-risk facts determine the review gate for persisted variants. They are
  // immutable migration evidence, so rollback is a verified fresh-target restore;
  // this no-op preserves the durable facts and permits a ledger replay of `up`.
  await db.execute(sql`SELECT 1`)
}
