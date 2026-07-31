import { randomUUID } from 'expo-crypto';

/**
 * Generate a row id.
 *
 * Every primary key in Daylish is a client-generated UUID, because the device
 * must be able to create rows while offline — the server never assigns identity.
 *
 * This wraps `expo-crypto` rather than `globalThis.crypto.randomUUID()`.
 * Hermes, the JavaScript engine React Native runs on, does **not** provide a
 * `crypto` global: the Web Crypto API is a browser and Node feature, not a
 * language one. Calling it compiles and bundles perfectly happily and then
 * throws `Cannot read property 'randomUUID' of undefined` on the first write —
 * which, since the very first thing the app does is create a user row, means it
 * fails at launch.
 *
 * `expo-crypto` is backed by the platform's native secure random source, so the
 * ids are collision-safe across devices, which matters once rows from several
 * devices sync into one Postgres table.
 */
export function newId(): string {
  return randomUUID();
}
