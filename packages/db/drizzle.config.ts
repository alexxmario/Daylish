import type { Config } from 'drizzle-kit';

/**
 * Generates the on-device SQLite migrations. The Postgres side lives in
 * `supabase/migrations` as hand-written SQL, because it also carries RLS
 * policies that Drizzle does not model.
 */
export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
} satisfies Config;
