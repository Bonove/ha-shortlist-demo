import { createHash } from 'node:crypto';
import type { PolicySourceFile } from '@/lib/contracts';

/**
 * Content hash over a complete executable source bundle.
 *
 * Canonicalisation: files sorted by path, each rendered as `path\n<code>`,
 * joined with a NUL separator. Line endings are normalised to \n so a bundle
 * that survives a round trip through export/import hashes identically.
 *
 * This is the one definition of a bundle hash in the app. Do not re-implement.
 */
export function hashBundle(files: PolicySourceFile[]): string {
  const canonical = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.path}\n${f.code.replace(/\r\n/g, '\n')}`)
    .join('\u0000');
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
