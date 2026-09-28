/**
 * Capture a retrieved LemmaBase publication as an immutable local snapshot.
 *
 * Usage: node scripts/capture-snapshot.mjs <id> <step> <revision> <label> <description> <message> <sourceFile>
 * The source file must contain the text retrieved from LemmaBase, not the draft
 * that was sent to it — published source is returned canonically formatted.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [id, step, revision, label, description, message, sourceFile] = process.argv.slice(2);
const code = readFileSync(sourceFile, 'utf8');
const files = [{ path: 'shortlist_policy.lemma', code }];
const canonical = files
  .slice()
  .sort((a, b) => a.path.localeCompare(b.path))
  .map((f) => `${f.path}\n${f.code.replace(/\r\n/g, '\n')}`)
  .join('\u0000');
const sourceHash = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

const dir = join('policies', 'snapshots', id);
mkdirSync(dir, { recursive: true });
for (const f of files) writeFileSync(join(dir, f.path), f.code);

const manifest = {
  id,
  label,
  description,
  step: Number(step),
  files: files.map((f) => ({ path: f.path })),
  sourceHash,
  provenance: 'live-repository-read',
  publication: {
    repository: '@tristan-van-doorn/ha-shortlist-demo',
    repositoryUrl: 'https://lemmabase.com/@tristan-van-doorn/ha-shortlist-demo',
    spec: 'shortlist_policy',
    retrievedAt: new Date().toISOString(),
    message,
    specEffectiveFrom: '2026-01-01',
    // Omitted when the service exposed none. Never invent one: an application
    // snapshot id and a LemmaBase revision are different things.
    ...(revision ? { revision } : {}),
  },
  capturedAt: new Date().toISOString(),
};
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${id} ${sourceHash} rev=${revision}`);
