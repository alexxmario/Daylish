/**
 * Resolves the `@/…` path alias for Node.
 *
 * `@/` is a bundler convention that Metro and TypeScript both understand from
 * `tsconfig.json`. Node does not, so running app code directly under `node
 * --test` needs this shim. It maps `@/x` to `<app>/src/x`, matching the `paths`
 * entry in tsconfig.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolvePath(here, '..', 'src');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = pathToFileURL(resolvePath(srcDir, specifier.slice(2))).href;
    return { url: target, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
