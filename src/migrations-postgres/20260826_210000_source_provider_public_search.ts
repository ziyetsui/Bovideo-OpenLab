import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Historical public-search snapshots are a distinct provenance provider. Enum values are additive-only. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "enum_sources_provider" ADD VALUE IF NOT EXISTS 'x_public_search'`)
}

/** PostgreSQL does not support safe removal of a live enum value. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
