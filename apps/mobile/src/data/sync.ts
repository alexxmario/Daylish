/**
 * Pushing the diary to the account.
 *
 * The device stays the source of truth: every read in the app hits local SQLite
 * and nothing else, and that does not change. This is a backup, running behind
 * the app, so that losing a phone stops meaning losing a year of logs. Nothing
 * here is on any path a person waits for.
 *
 * Three properties make this much smaller than a sync layer usually is, and all
 * three were decided long before this file existed:
 *
 *   - **Ids are client-generated UUIDs.** The server never assigns identity, so
 *     there is no id reconciliation — the hardest part of most sync layers
 *     simply does not exist here.
 *   - **Deletes are soft.** A deleted row is still a row, carrying `deleted_at`.
 *     So the queued *operation* turns out not to matter: insert, update and
 *     delete all reduce to "send the row as it stands now".
 *   - **The queue is written in the same transaction as the write.** A crash
 *     cannot leave a row saved locally but never queued.
 *
 * **What is pending is derived from the rows, not from the queue.** A row needs
 * pushing when `synced_at` is null or older than `updated_at`, and that question
 * is asked of the table itself.
 *
 * That is deliberately not what `sync_outbox` was built for, and the reason is a
 * bug this file found on its first run: `user.ts` never enqueued anything, so a
 * new account's profile, first weigh-in and first goal — precisely what a new
 * phone needs in order to restore — would have been silently skipped forever.
 * A queue that five repositories must each remember to write to is a queue that
 * will eventually be missing a row, and a backup that is quietly incomplete is
 * worse than one that is obviously broken.
 *
 * Reading `synced_at` instead is self-healing: a repository that forgets to
 * enqueue still gets its rows pushed, because the row itself says it has never
 * been sent. The outbox is still drained here so it cannot grow without bound,
 * and it remains useful for seeing what triggered a push — but nothing depends
 * on it being complete.
 *
 * Rows are read at push time rather than from the queued payload, so several
 * edits to one row collapse into one send and nothing stale is transmitted.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { sqlite } from '@/db/client.ts';
import { newId } from '@/lib/ids.ts';
import { supabase } from '@/lib/supabase.ts';

/**
 * Columns that exist on the device and have no server counterpart.
 *
 * Verified by diffing both schemas rather than assumed — every other column on
 * every synced table matches by name, which is what makes the manifest below a
 * list of table names rather than a list of columns.
 *
 *   `synced_at`  device bookkeeping; this file is what sets it.
 *   `email`      lives in `auth.users` on the server, not on `profiles`.
 *   `photo_uri`  a path on one phone, meaningless on another. Progress photos
 *                have never left the device and this is not the change that
 *                starts uploading them.
 */
const DEVICE_ONLY_COLUMNS: readonly string[] = ['synced_at', 'email', 'photo_uri'];

/**
 * What gets pushed, parents before children.
 *
 * The order is load-bearing: `profiles` must exist before anything referencing
 * it, and a saved meal before its items, or the foreign key rejects the child.
 * `users` is the only table whose name differs — the server calls it `profiles`.
 *
 * Not listed: `pantry_items`, `meal_plans`, `meal_plan_slots`. They have no UI,
 * so they cannot hold anything; adding them when they do is one line.
 */
interface SyncedTable {
  readonly device: string;
  readonly server: string;
  /**
   * How to tell whose rows these are, as a SQL fragment taking one user id.
   *
   * Never optional, and never omitted for convenience. Signing out leaves the
   * previous account's rows on the device by design — there is no server copy
   * yet, so wiping them would destroy the only one — which means an unscoped
   * push would offer one person's diary under another's session. RLS would
   * refuse it, correctly, and then the worker would retry that refusal forever.
   */
  readonly owner: string;
}

const SYNCED_TABLES: readonly SyncedTable[] = [
  { device: 'users', server: 'profiles', owner: 'id = ?' },
  { device: 'user_goals', server: 'user_goals', owner: 'user_id = ?' },
  { device: 'journal_entries', server: 'journal_entries', owner: 'user_id = ?' },
  {
    device: 'journal_entry_items',
    server: 'journal_entry_items',
    // Ownership is proved through the parent, exactly as the RLS policy does.
    owner: 'entry_id IN (SELECT id FROM journal_entries WHERE user_id = ?)',
  },
  { device: 'water_logs', server: 'water_logs', owner: 'user_id = ?' },
  { device: 'weight_entries', server: 'weight_entries', owner: 'user_id = ?' },
  { device: 'mood_entries', server: 'mood_entries', owner: 'user_id = ?' },
  { device: 'fasting_sessions', server: 'fasting_sessions', owner: 'user_id = ?' },
  { device: 'saved_meals', server: 'saved_meals', owner: 'user_id = ?' },
  {
    device: 'saved_meal_items',
    server: 'saved_meal_items',
    owner: 'saved_meal_id IN (SELECT id FROM saved_meals WHERE user_id = ?)',
  },
  { device: 'recipe_interactions', server: 'recipe_interactions', owner: 'user_id = ?' },
  { device: 'shopping_list_recipes', server: 'shopping_list_recipes', owner: 'user_id = ?' },
  { device: 'shopping_list_checks', server: 'shopping_list_checks', owner: 'user_id = ?' },
];

/**
 * How many times a row is retried before it is stepped over.
 *
 * A row that can never be accepted — one the server rejects for a reason
 * retrying will not fix — must not block the rows behind it. It stays in the
 * queue with its error recorded rather than being dropped, because deleting
 * data the server refused is how a backup quietly becomes a lie.
 */
const MAX_ATTEMPTS = 5;

/** Rows per request. Small enough to stay well inside any payload limit. */
const BATCH_SIZE = 200;

export interface SyncOutcome {
  /** Rows accepted by the server this run. */
  readonly pushed: number;
  /** Rows still queued, including any that have exhausted their attempts. */
  readonly pending: number;
  /** Rows stepped over because they have failed too often. */
  readonly stuck: number;
  readonly error: string | null;
}

/**
 * Where rows are sent.
 *
 * An interface rather than a direct Supabase call so the runtime tests can
 * exercise the whole worker — batching, ordering, the `synced_at` stamp, the
 * retry accounting — against a fake. This is data-loss-adjacent code; proving it
 * by running it is worth an indirection.
 */
export interface PushTarget {
  upsert(serverTable: string, rows: readonly Record<string, unknown>[]): Promise<void>;
}

export function supabasePushTarget(client: SupabaseClient): PushTarget {
  return {
    async upsert(serverTable, rows) {
      const { error } = await client.from(serverTable).upsert(rows as never[], {
        onConflict: 'id',
        // The row we hold is the truth; the server copy is a replica of it.
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`${serverTable}: ${error.message}`);
    },
  };
}

/** Columns a device table actually has, minus the ones the server does not. */
function syncableColumns(deviceTable: string): string[] {
  return sqlite
    .getAllSync<{ name: string }>(`PRAGMA table_info(${deviceTable})`)
    .map((column) => column.name)
    .filter((name) => !DEVICE_ONLY_COLUMNS.includes(name));
}

/**
 * A row is pending when it has never been sent, or has changed since it was.
 *
 * `updated_at > synced_at` rather than `!=` because both are ISO-8601 strings in
 * UTC, which compare lexically in the same order they compare chronologically.
 */
const PENDING = 'synced_at IS NULL OR updated_at > synced_at';

/** How many of this person's rows are waiting to reach the server. */
export function pendingWrites(userId: string): number {
  let total = 0;
  for (const { device, owner } of SYNCED_TABLES) {
    const row = sqlite.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${device} WHERE (${owner}) AND (${PENDING})`,
      [userId],
    );
    total += row?.c ?? 0;
  }
  return total;
}

/**
 * Push everything queued.
 *
 * Returns rather than throws: a failed backup is not an error the person needs
 * handling, it is a state the next run will resolve. The caller decides whether
 * to say anything about it.
 */
export async function pushOutbox(
  userId: string,
  target: PushTarget | null = supabase ? supabasePushTarget(supabase) : null,
): Promise<SyncOutcome> {
  if (!target) return { pushed: 0, pending: pendingWrites(userId), stuck: 0, error: null };

  /** Rows the server has already refused too often, by table and id. */
  const exhausted = new Map<string, Set<string>>();
  for (const row of sqlite.getAllSync<{ table_name: string; row_id: string }>(
    'SELECT table_name, row_id FROM sync_outbox WHERE attempts >= ? GROUP BY table_name, row_id',
    [MAX_ATTEMPTS],
  )) {
    const set = exhausted.get(row.table_name) ?? new Set<string>();
    set.add(row.row_id);
    exhausted.set(row.table_name, set);
  }

  let pushed = 0;
  let stuck = 0;
  let firstError: string | null = null;

  for (const { device, server, owner } of SYNCED_TABLES) {
    const columns = syncableColumns(device);
    const skip = exhausted.get(device) ?? new Set<string>();

    // Oldest first, so a partial run leaves a contiguous backlog rather than
    // holes, and children stay behind the parents they reference.
    const candidates = sqlite.getAllSync<Record<string, unknown>>(
      `SELECT ${columns.join(', ')} FROM ${device}
        WHERE (${owner}) AND (${PENDING}) ORDER BY created_at ASC`,
      [userId],
    );

    const rows = candidates.filter((row) => !skip.has(String(row.id)));
    stuck += candidates.length - rows.length;
    if (rows.length === 0) continue;

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      const ids = batch.map((row) => String(row.id));

      try {
        await target.upsert(server, batch.map((row) => normalise(device, row)));
        stampSynced(device, batch);
        clearQueued(device, ids);
        pushed += batch.length;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        firstError ??= message;
        recordFailure(device, ids, message);
        // Stop this table rather than hammering the rest of its backlog with a
        // failure that is almost certainly about the connection, not the row.
        break;
      }
    }
  }

  return { pushed, pending: pendingWrites(userId), stuck, error: firstError };
}

/**
 * Shape a device row for Postgres.
 *
 * Two conversions, and both were verified against the live database rather than
 * reasoned about — see `supabase/scripts/verify-sync.mjs`.
 *
 * **Booleans.** SQLite has no boolean type, so flags are stored as 0 and 1 and
 * have to arrive as `true`/`false`.
 *
 * **JSON.** This is the one that bit. SQLite stores these columns as text, and
 * an earlier version of this file sent that text straight into the matching
 * `jsonb` column on the assumption Postgres would parse it. It does not: it
 * stores the *string*, so `'["peanuts"]'` came back as the string
 * `["peanuts"]` rather than an array of one. The value survives a round trip
 * looking plausible while having quietly stopped being a list — which for an
 * allergen list is about the worst shape a silent bug can take. They are parsed
 * here so the column receives real JSON.
 */
const BOOLEAN_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ['detailed_nutrition'],
  journal_entry_items: ['optional'],
};

/** Columns declared `mode: 'json'` on the device, per `packages/db/src/schema.ts`. */
const JSON_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ['allergens', 'disliked_ingredients', 'equipment'],
  journal_entry_items: ['nutrients'],
  saved_meal_items: ['nutrients'],
};

function normalise(deviceTable: string, row: Record<string, unknown>): Record<string, unknown> {
  const booleans = BOOLEAN_COLUMNS[deviceTable];
  const json = JSON_COLUMNS[deviceTable];
  if (!booleans && !json) return row;

  const shaped = { ...row };

  for (const column of booleans ?? []) {
    if (column in shaped) shaped[column] = shaped[column] === 1 || shaped[column] === true;
  }

  for (const column of json ?? []) {
    const value = shaped[column];
    if (typeof value !== 'string') continue;
    try {
      shaped[column] = JSON.parse(value);
    } catch {
      // Unparseable JSON in a JSON column is a local corruption, and dropping
      // the row would lose everything else on it. Send null and keep the rest;
      // the column is nullable on both sides.
      shaped[column] = null;
    }
  }

  return shaped;
}

function clearQueued(deviceTable: string, rowIds: readonly string[]): void {
  if (rowIds.length === 0) return;
  const placeholders = rowIds.map(() => '?').join(', ');
  sqlite.runSync(
    `DELETE FROM sync_outbox WHERE table_name = ? AND row_id IN (${placeholders})`,
    [deviceTable, ...rowIds],
  );
}

/**
 * Mark the rows as acknowledged, at the version that was actually sent.
 *
 * `synced_at` is set to the row's own `updated_at` rather than to the wall
 * clock, and the update is conditional on `updated_at` still holding that
 * value. Two bugs fall out of that, both of which lose an edit:
 *
 *   - Stamping "now" and comparing `updated_at > synced_at` drops any edit made
 *     in the same millisecond as the push, because equal is not greater.
 *   - Stamping unconditionally marks an edit that landed *between* the read and
 *     the send as sent, when what went to the server was the version before it.
 *
 * Recording the version pushed, and only if it is still the current one, means
 * an edit that races the push is simply pending again on the next run.
 */
function stampSynced(deviceTable: string, rows: readonly Record<string, unknown>[]): void {
  for (const row of rows) {
    sqlite.runSync(
      `UPDATE ${deviceTable} SET synced_at = ? WHERE id = ? AND updated_at = ?`,
      [String(row.updated_at), String(row.id), String(row.updated_at)],
    );
  }
}

/**
 * Count a refusal against each row.
 *
 * The outbox is the ledger for this, and a row may have no entry in it — the
 * push is driven by `synced_at`, not by the queue, so a repository that never
 * enqueued still gets pushed. Without inserting a marker here its attempts
 * would never rise, and a row the server will never accept would be retried on
 * every launch forever.
 */
function recordFailure(deviceTable: string, rowIds: readonly string[], message: string): void {
  if (rowIds.length === 0) return;
  const error = message.slice(0, 500);
  const timestamp = new Date().toISOString();

  for (const rowId of rowIds) {
    const changed = sqlite.runSync(
      `UPDATE sync_outbox SET attempts = attempts + 1, last_error = ?
        WHERE table_name = ? AND row_id = ?`,
      [error, deviceTable, rowId],
    );
    if (changed.changes === 0) {
      sqlite.runSync(
        `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, queued_at, attempts, last_error)
         VALUES (?, ?, ?, 'update', '{}', ?, 1, ?)`,
        [newId(), deviceTable, rowId, timestamp, error],
      );
    }
  }
}

/**
 * When this person's data last reached the server.
 *
 * Derived from the rows rather than remembered separately, so it cannot drift
 * from the truth: a stored "backed up at" can happily claim success while rows
 * sit unsent, and a backup that lies about being a backup is worse than one
 * that admits it is behind.
 */
export function lastBackupAt(userId: string): string | null {
  let latest: string | null = null;

  for (const { device, owner } of SYNCED_TABLES) {
    const row = sqlite.getFirstSync<{ at: string | null }>(
      `SELECT MAX(synced_at) AS at FROM ${device} WHERE ${owner}`,
      [userId],
    );
    if (row?.at && (latest === null || row.at > latest)) latest = row.at;
  }

  return latest;
}

/**
 * A push that will not run twice at once.
 *
 * Two triggers can land together — signing in while the app is coming to the
 * foreground — and two concurrent runs would read the same pending rows, send
 * them twice and race each other's `synced_at` stamps. Sharing the in-flight
 * promise makes the second caller wait for the first rather than duplicate it.
 */
let inFlight: Promise<SyncOutcome> | null = null;

export function syncNow(userId: string): Promise<SyncOutcome> {
  inFlight ??= pushOutbox(userId).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Where rows are read back from. The mirror of {@link PushTarget}.
 *
 * No user filter: row-level security already scopes every select to the signed-in
 * account, and re-stating the condition here would be a second implementation of
 * ownership that could disagree with the first.
 */
export interface PullSource {
  select(serverTable: string): Promise<Record<string, unknown>[]>;
}

export function supabasePullSource(client: SupabaseClient): PullSource {
  return {
    async select(serverTable) {
      const { data, error } = await client.from(serverTable).select('*');
      if (error) throw new Error(`${serverTable}: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    },
  };
}

export interface RestoreOutcome {
  readonly restored: number;
  /** True when the device already held a diary, so nothing was touched. */
  readonly skipped: boolean;
  readonly error: string | null;
}

/**
 * Is this device carrying a diary for this account already?
 *
 * `users` is excluded deliberately: signing in creates a profile row before
 * anything else runs, so its presence says nothing about whether there is a
 * diary here. Every other table is real content — one weigh-in is enough to
 * mean "this phone has been used".
 */
function hasLocalDiary(userId: string): boolean {
  for (const { device, owner } of SYNCED_TABLES) {
    if (device === 'users') continue;
    const row = sqlite.getFirstSync<{ id: string }>(
      `SELECT id FROM ${device} WHERE ${owner} LIMIT 1`,
      [userId],
    );
    if (row) return true;
  }
  return false;
}

/**
 * Turn a server row back into a device row.
 *
 * Two conversions, both of them things Postgres and SQLite genuinely disagree
 * about rather than preferences. `jsonb` comes back as parsed objects and has to
 * be re-serialised, because SQLite stores it as text. Booleans come back as
 * `true`/`false` and SQLite has no boolean type, so they become 1 and 0.
 */
function toDeviceRow(row: Record<string, unknown>): Record<string, unknown> {
  const shaped: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    if (value !== null && typeof value === 'object') shaped[column] = JSON.stringify(value);
    else if (typeof value === 'boolean') shaped[column] = value ? 1 : 0;
    else shaped[column] = value;
  }

  return shaped;
}

/**
 * Bring the diary back onto a fresh device.
 *
 * Runs only when this phone holds nothing for the account, which is what makes
 * it safe to do silently and without asking: there is no local work to weigh
 * against the server's copy, so there is no merge and nothing can be lost. A
 * phone that already has a diary is left completely alone — the push will carry
 * its rows up, and reconciling two populated devices is a different problem that
 * this deliberately does not attempt.
 *
 * Restored rows are stamped as already backed up. Without that the next push
 * would send the entire diary straight back to the server it just came from.
 */
export async function restoreFromAccount(
  userId: string,
  source: PullSource | null = supabase ? supabasePullSource(supabase) : null,
): Promise<RestoreOutcome> {
  if (!source) return { restored: 0, skipped: true, error: null };
  if (hasLocalDiary(userId)) return { restored: 0, skipped: true, error: null };

  let restored = 0;

  try {
    for (const { device, server } of SYNCED_TABLES) {
      const rows = await source.select(server);
      if (rows.length === 0) continue;

      const writable = new Set(syncableColumns(device));

      sqlite.execSync('BEGIN');
      try {
        for (const raw of rows) {
          const row = toDeviceRow(raw);
          // Only columns this device actually has. A server that has gained a
          // column the app does not know about must not fail the restore.
          const columns = Object.keys(row).filter((column) => writable.has(column));
          if (columns.length === 0) continue;

          sqlite.runSync(
            `INSERT OR REPLACE INTO ${device} (${columns.join(', ')}, synced_at)
             VALUES (${columns.map(() => '?').join(', ')}, ?)`,
            [...columns.map((column) => row[column] as string), String(row.updated_at ?? '')],
          );
          restored += 1;
        }
        sqlite.execSync('COMMIT');
      } catch (error) {
        sqlite.execSync('ROLLBACK');
        throw error;
      }
    }
  } catch (cause) {
    return {
      restored,
      skipped: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }

  return { restored, skipped: false, error: null };
}
