/** Resolves the app's "@/..." paths so server modules can be run under plain node. */
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolve(specifier, context, next) {
  if (!specifier.startsWith('@/')) return next(specifier, context);
  const base = resolvePath('src', specifier.slice(2));
  const file = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync);
  if (!file) throw new Error(`Cannot resolve ${specifier}`);
  return { url: pathToFileURL(file).href, shortCircuit: true };
}
