/**
 * Date helpers.
 *
 * The schema stores an instant *and* a local date on every entry, and these are
 * the only functions allowed to derive one from the other. Getting this wrong is
 * subtle and user-visible: a meal eaten at 00:30 belongs to that calendar day in
 * the user's own timezone, not in UTC, and "today's ring" is a local-date query.
 */

/** `YYYY-MM-DD` for an instant, in the device's current timezone. */
export function toLocalDate(instant: Date = new Date()): string {
  const year = instant.getFullYear();
  const month = String(instant.getMonth() + 1).padStart(2, '0');
  const day = String(instant.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today, as the user's device reckons it. */
export function today(): string {
  return toLocalDate();
}

/** Shift a `YYYY-MM-DD` by whole days without tripping over DST. */
export function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  // Constructed at noon so a DST transition cannot push the result onto the
  // neighbouring day.
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return toLocalDate(date);
}

export function yesterday(from: string = today()): string {
  return addDays(from, -1);
}

/** e.g. "Monday, 27 July". Used as the journal's day heading. */
export function formatDayHeading(localDate: string, now: string = today()): string {
  if (localDate === now) return 'Today';
  if (localDate === yesterday(now)) return 'Yesterday';
  if (localDate === addDays(now, 1)) return 'Tomorrow';

  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day, 12);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** e.g. "12:30". The timeline's per-entry timestamp. */
export function formatTime(isoInstant: string): string {
  return new Date(isoInstant).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The device's IANA timezone, stored on the user so the server can agree with us. */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}

/**
 * An ISO instant that is never the same twice.
 *
 * `updated_at` is how the backup decides what has changed since it last ran:
 * a row is pending when its `updated_at` is newer than its `synced_at`. That
 * comparison only works if two writes to the same row produce two different
 * timestamps — and `Date.now()` has millisecond resolution, so a write landing
 * in the same millisecond as the push that stamped the row is indistinguishable
 * from the version already sent, and would never be backed up.
 *
 * The window is small, but "small window in which an edit is silently never
 * backed up" is the exact failure a backup exists to prevent. Nudging the clock
 * forward when it has not moved costs a millisecond of accuracy on a timestamp
 * nobody reads to the millisecond, and makes the ordering total.
 *
 * Process-local by design: it orders one device's writes against each other,
 * which is all `synced_at` compares. Ordering writes *between* devices is a
 * different problem and wants a server-side receipt, not a cleverer clock.
 */
let lastInstant = 0;

export function nowIso(): string {
  const now = Date.now();
  lastInstant = now > lastInstant ? now : lastInstant + 1;
  return new Date(lastInstant).toISOString();
}
