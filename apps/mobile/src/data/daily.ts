/**
 * The rest of the day: weigh-ins, water, fasting, mood.
 *
 * These sit alongside the journal rather than inside it because they are not
 * meals — the timeline unions them at read time. Keeping them apart is what lets
 * `journal_entries` stay append-only and conflict-free while a weigh-in can be
 * corrected in place.
 *
 * The weigh-in functions matter more than they look: the adaptive goal engine
 * has nothing to work from without them, so this is the module that makes
 * targets actually adapt.
 */

import type { FastingProtocol, MoodTag } from '@daylish/core';

import { sqlite } from '@/db/client.ts';
import { nowIso, toLocalDate, today } from '@/lib/dates.ts';
import { newId } from '@/lib/ids.ts';


function enqueue(
  tableName: string,
  rowId: string,
  operation: 'insert' | 'update' | 'delete',
  payload: Record<string, unknown>,
) {
  sqlite.runSync(
    `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, queued_at, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [newId(), tableName, rowId, operation, JSON.stringify(payload), nowIso()],
  );
}

// ---------------------------------------------------------------------------
// Weigh-ins
// ---------------------------------------------------------------------------

export interface WeighIn {
  id: string;
  localDate: string;
  weightKg: number;
  bodyFatPercent: number | null;
  source: string;
}

/**
 * Record a weigh-in.
 *
 * One per day, upserted: weighing twice in a morning is a correction, not two
 * data points, and the unique index on `(user_id, local_date)` enforces that.
 * Letting both rows stand would double-count that day in the trend regression.
 */
export function recordWeight(
  userId: string,
  weightKg: number,
  options: { localDate?: string; bodyFatPercent?: number | null; source?: string } = {},
): void {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) {
    throw new RangeError(`recordWeight: implausible weight ${weightKg} kg`);
  }

  const date = options.localDate ?? today();
  const timestamp = nowIso();
  const id = newId();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `INSERT INTO weight_entries (id, user_id, local_date, weight_kg, body_fat_percent, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, local_date) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         body_fat_percent = excluded.body_fat_percent,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
      [
        id,
        userId,
        date,
        weightKg,
        options.bodyFatPercent ?? null,
        options.source ?? 'manual',
        timestamp,
        timestamp,
      ],
    );
    /*
      The id of the row that actually exists, which on a correction is not `id`.
      The insert above upserts on `(user_id, local_date)`, so weighing twice in
      a morning keeps the first row and its first id — while `id` here is a
      fresh UUID that was generated and then discarded by the conflict clause.
      Queueing that discarded id pointed the sync worker at a row that does not
      exist, so corrections were silently never backed up.
    */
    const persisted = sqlite.getFirstSync<{ id: string }>(
      'SELECT id FROM weight_entries WHERE user_id = ? AND local_date = ?',
      [userId, date],
    );
    enqueue('weight_entries', persisted?.id ?? id, 'insert', {
      user_id: userId,
      local_date: date,
      weight_kg: weightKg,
    });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

export function getWeightForDate(userId: string, localDate: string = today()): WeighIn | null {
  const row = sqlite.getFirstSync<{
    id: string;
    local_date: string;
    weight_kg: number;
    body_fat_percent: number | null;
    source: string;
  }>(
    `SELECT id, local_date, weight_kg, body_fat_percent, source
     FROM weight_entries
     WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL`,
    [userId, localDate],
  );
  if (!row) return null;
  return {
    id: row.id,
    localDate: row.local_date,
    weightKg: row.weight_kg,
    bodyFatPercent: row.body_fat_percent,
    source: row.source,
  };
}

/** The most recent weigh-in at or before `localDate`, for pre-filling the input. */
export function getLatestWeight(userId: string, localDate: string = today()): WeighIn | null {
  const row = sqlite.getFirstSync<{
    id: string;
    local_date: string;
    weight_kg: number;
    body_fat_percent: number | null;
    source: string;
  }>(
    `SELECT id, local_date, weight_kg, body_fat_percent, source
     FROM weight_entries
     WHERE user_id = ? AND local_date <= ? AND deleted_at IS NULL
     ORDER BY local_date DESC LIMIT 1`,
    [userId, localDate],
  );
  if (!row) return null;
  return {
    id: row.id,
    localDate: row.local_date,
    weightKg: row.weight_kg,
    bodyFatPercent: row.body_fat_percent,
    source: row.source,
  };
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/** Default glass. Used by the quick-add buttons. */
export const GLASS_ML = 250;

/**
 * A sensible daily goal, in millilitres.
 *
 * 35 ml per kg of bodyweight is the common clinical rule of thumb. It is only a
 * default — the app shows progress against it but never treats falling short as
 * a failure, in keeping with everything else here.
 */
export function waterGoalMl(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return 2000;
  return Math.round((weightKg * 35) / 50) * 50;
}

export function logWater(userId: string, millilitres: number, at: Date = new Date()): void {
  if (!Number.isFinite(millilitres) || millilitres <= 0) {
    throw new RangeError(`logWater: amount must be positive, got ${millilitres}`);
  }
  const id = newId();
  const timestamp = nowIso();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `INSERT INTO water_logs (id, user_id, logged_at, local_date, millilitres, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, at.toISOString(), toLocalDate(at), millilitres, timestamp, timestamp],
    );
    enqueue('water_logs', id, 'insert', { user_id: userId, millilitres });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

export function getWaterTotal(userId: string, localDate: string = today()): number {
  const row = sqlite.getFirstSync<{ total: number | null }>(
    `SELECT SUM(millilitres) AS total FROM water_logs
     WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL`,
    [userId, localDate],
  );
  return row?.total ?? 0;
}

/** Remove the most recent entry for the day — the undo for a mis-tap. */
export function undoLastWater(userId: string, localDate: string = today()): boolean {
  const row = sqlite.getFirstSync<{ id: string }>(
    `SELECT id FROM water_logs
     WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL
     ORDER BY logged_at DESC LIMIT 1`,
    [userId, localDate],
  );
  if (!row) return false;

  const timestamp = nowIso();
  sqlite.runSync('UPDATE water_logs SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    timestamp,
    timestamp,
    row.id,
  ]);
  enqueue('water_logs', row.id, 'delete', { id: row.id, deleted_at: timestamp });
  return true;
}

// ---------------------------------------------------------------------------
// Fasting
// ---------------------------------------------------------------------------

export const FASTING_PROTOCOLS: {
  value: FastingProtocol;
  label: string;
  hours: number;
  blurb: string;
}[] = [
  { value: '16:8', label: '16:8', hours: 16, blurb: 'Eat within eight hours' },
  { value: '18:6', label: '18:6', hours: 18, blurb: 'Eat within six hours' },
  { value: '20:4', label: '20:4', hours: 20, blurb: 'Eat within four hours' },
  { value: 'omad', label: 'OMAD', hours: 23, blurb: 'One meal a day' },
  { value: '5:2', label: '5:2', hours: 24, blurb: 'Two lighter days a week' },
];

export interface FastingSession {
  id: string;
  protocol: FastingProtocol;
  startedAt: string;
  endedAt: string | null;
  targetHours: number;
}

export interface FastingProgress {
  session: FastingSession;
  elapsedHours: number;
  remainingHours: number;
  /** 0–1, clamped. Past the target this stays at 1 and `remainingHours` goes to 0. */
  fraction: number;
  complete: boolean;
}

export function getActiveFast(userId: string): FastingSession | null {
  const row = sqlite.getFirstSync<{
    id: string;
    protocol: FastingProtocol;
    started_at: string;
    ended_at: string | null;
    target_hours: number;
  }>(
    `SELECT id, protocol, started_at, ended_at, target_hours
     FROM fasting_sessions
     WHERE user_id = ? AND ended_at IS NULL AND deleted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [userId],
  );
  if (!row) return null;
  return {
    id: row.id,
    protocol: row.protocol,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    targetHours: row.target_hours,
  };
}

export function describeFast(session: FastingSession, now: Date = new Date()): FastingProgress {
  const elapsedMs = now.getTime() - new Date(session.startedAt).getTime();
  const elapsedHours = Math.max(0, elapsedMs / 3_600_000);
  const remainingHours = Math.max(0, session.targetHours - elapsedHours);
  return {
    session,
    elapsedHours,
    remainingHours,
    fraction: Math.max(0, Math.min(1, elapsedHours / session.targetHours)),
    complete: elapsedHours >= session.targetHours,
  };
}

/**
 * Begin a fast.
 *
 * Any fast already running is closed first. Two open sessions would make
 * "am I fasting?" ambiguous, and the timeline band would have no single span to
 * draw.
 */
export function startFast(
  userId: string,
  protocol: FastingProtocol,
  targetHours: number,
  startedAt: Date = new Date(),
): string {
  const id = newId();
  const timestamp = nowIso();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `UPDATE fasting_sessions SET ended_at = ?, updated_at = ?
       WHERE user_id = ? AND ended_at IS NULL AND deleted_at IS NULL`,
      [timestamp, timestamp, userId],
    );
    sqlite.runSync(
      `INSERT INTO fasting_sessions (id, user_id, protocol, started_at, target_hours, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, protocol, startedAt.toISOString(), targetHours, timestamp, timestamp],
    );
    enqueue('fasting_sessions', id, 'insert', { user_id: userId, protocol, target_hours: targetHours });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
  return id;
}

export function endFast(sessionId: string, endedAt: Date = new Date()): void {
  const timestamp = nowIso();
  sqlite.runSync('UPDATE fasting_sessions SET ended_at = ?, updated_at = ? WHERE id = ?', [
    endedAt.toISOString(),
    timestamp,
    sessionId,
  ]);
  enqueue('fasting_sessions', sessionId, 'update', { id: sessionId, ended_at: endedAt.toISOString() });
}

/**
 * The fasting span to draw on a given day's ribbon, in local hours.
 *
 * A fast usually crosses midnight, so the span is clipped to the day being
 * viewed: a 16-hour fast started at 20:00 renders as 20:00–24:00 yesterday and
 * 00:00–12:00 today, which is what actually happened.
 */
export function fastingBandForDate(
  userId: string,
  localDate: string,
): { startHour: number; endHour: number } | null {
  const row = sqlite.getFirstSync<{ started_at: string; ended_at: string | null; target_hours: number }>(
    `SELECT started_at, ended_at, target_hours FROM fasting_sessions
     WHERE user_id = ? AND deleted_at IS NULL
       AND date(started_at, 'localtime') <= ?
       AND (ended_at IS NULL OR date(ended_at, 'localtime') >= ?)
     -- An open fast outranks a closed one regardless of start time. Ordering by
     -- start alone picks a fast ended earlier *today* over one still running
     -- since last night, because the ended one started later — and the band for
     -- the ongoing fast then silently disappears from the timeline.
     ORDER BY (ended_at IS NULL) DESC, started_at DESC
     LIMIT 1`,
    [userId, localDate, localDate],
  );
  if (!row) return null;

  const dayStart = new Date(`${localDate}T00:00:00`);
  const dayEnd = new Date(`${localDate}T23:59:59`);
  const start = new Date(row.started_at);
  const end = row.ended_at
    ? new Date(row.ended_at)
    : new Date(start.getTime() + row.target_hours * 3_600_000);

  const clippedStart = start < dayStart ? dayStart : start;
  const clippedEnd = end > dayEnd ? dayEnd : end;
  if (clippedEnd <= clippedStart) return null;

  return {
    startHour: clippedStart.getHours() + clippedStart.getMinutes() / 60,
    endHour: clippedEnd.getHours() + clippedEnd.getMinutes() / 60,
  };
}

// ---------------------------------------------------------------------------
// Mood
// ---------------------------------------------------------------------------

export function logMood(
  userId: string,
  input: { mood?: MoodTag; energy?: number; hunger?: number; entryId?: string | null },
  at: Date = new Date(),
): void {
  const id = newId();
  const timestamp = nowIso();
  sqlite.runSync(
    `INSERT INTO mood_entries (id, user_id, entry_id, logged_at, local_date, mood, energy, hunger, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.entryId ?? null,
      at.toISOString(),
      toLocalDate(at),
      input.mood ?? null,
      input.energy ?? null,
      input.hunger ?? null,
      timestamp,
      timestamp,
    ],
  );
}
