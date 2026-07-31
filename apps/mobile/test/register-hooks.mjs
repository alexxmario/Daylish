/**
 * Registers the `@/` alias resolver before the test modules load.
 * Used via `node --import=./test/register-hooks.mjs`.
 */
import { register } from 'node:module';

register('./alias-hook.mjs', import.meta.url);
