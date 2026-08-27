import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Keep the immutable projection/binding locale enum aligned with the canonical
 * application locale contract. Both tables intentionally share this enum.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'ja-JP';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'ko-KR';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'de-DE';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'fr-FR';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'it-IT';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'es-ES';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'es-419';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'pt-PT';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'hi-IN';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'th-TH';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'tr-TR';
    ALTER TYPE "public"."enum_page_projections_locale" ADD VALUE IF NOT EXISTS 'vi-VN';
  `)
}

// PostgreSQL enum values cannot be safely removed while immutable release rows
// may reference them. Rollback is therefore deliberately additive/no-op.
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
