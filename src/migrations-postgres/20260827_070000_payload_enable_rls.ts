import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Payload is accessed only through the server-side Postgres connection.  Keep
 * the public schema closed to Supabase Data API roles by enabling RLS on every
 * application table; the database owner used by Payload continues to bypass
 * RLS, while no anonymous/authenticated policies are created.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE table_record record;
    BEGIN
      FOR table_record IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
          'public',
          table_record.tablename
        );
      END LOOP;
    END $$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
