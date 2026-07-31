/**
 * Inlines the generated SQL migrations into a TypeScript module.
 *
 * React Native has no filesystem access to arbitrary project files at runtime,
 * so the migration SQL has to be part of the JS bundle. Drizzle's Expo migrator
 * solves this with a Babel plugin; embedding the statements ourselves keeps the
 * build simpler and makes the applied SQL greppable in the repo.
 *
 * Run after any `drizzle-kit generate`:  node scripts/build-migrations.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const outFile = join(here, '..', 'src', 'migrations.generated.ts');

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const migrations = files.map((file) => {
  const raw = readFileSync(join(migrationsDir, file), 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  return { name: file, statements };
});

const body = `/**
 * GENERATED FILE — do not edit.
 * Produced by scripts/build-migrations.mjs from ./migrations/*.sql
 */

export interface Migration {
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = ${JSON.stringify(migrations, null, 2)};
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, body, 'utf8');

const count = migrations.reduce((n, m) => n + m.statements.length, 0);
console.log(`Wrote ${migrations.length} migration(s), ${count} statements → ${outFile}`);
