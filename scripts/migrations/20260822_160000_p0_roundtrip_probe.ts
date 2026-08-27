import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

/** Local Phase-0 harness migration. It is intentionally outside src/migrations. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`locale_variants\` ADD COLUMN \`migration_probe_revision\` integer NOT NULL DEFAULT 1;`)
  await db.run(sql`CREATE INDEX \`locale_variants_migration_probe_revision_idx\` ON \`locale_variants\` (\`migration_probe_revision\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`locale_variants_migration_probe_revision_idx\`;`)
  await db.run(sql`ALTER TABLE \`locale_variants\` DROP COLUMN \`migration_probe_revision\`;`)
}
