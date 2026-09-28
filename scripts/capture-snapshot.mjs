/**
 * Capture a retrieved LemmaBase publication as an immutable local snapshot.
 *
 * Usage: node scripts/capture-snapshot.mjs <id> <step> <revision> <label> <description> <message> <sourceFile...>
 *
 * The source files must contain the text retrieved from LemmaBase, not the
 * draft that was sent to it — published source comes back canonically
 * formatted, and it is the published bytes the app has to execute.
 *
 * A repository-wide retrieval returns every spec in one blob with no file
 * boundaries in it, so a bundle captured that way is stored as the single file
 * it arrived as. Splitting it back into per-spec files would mean hashing a
 * reconstruction rather than the thing LemmaBase actually returned.
 */
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [id, step, revision, label, description, message, ...sourceFiles] = process.argv.slice(2);
if (!id || sourceFiles.length === 0) {
  console.error('Usage: capture-snapshot.mjs <id> <step> <revision> <label> <description> <message> <sourceFile...>');
  process.exit(1);
}

const files = sourceFiles.map((f) => ({ path: basename(f), code: readFileSync(f, 'utf8') }));

// Every spec name the bundle declares, in the order they appear. Derived rather
// than passed in, so the manifest cannot disagree with the source beside it.
const specs = [
  ...new Set(files.flatMap((f) => [...f.code.matchAll(/^spec\s+(\S+)/gm)].map((m) => m[1]))),
];
if (specs.length === 0) {
  console.error('No `spec` declaration found in the retrieved source. Refusing to capture it.');
  process.exit(1);
}

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
    specs,
    retrievedAt: new Date().toISOString(),
    message,
    // Omitted when the service exposed none. Never invent one: an application
    // snapshot id and a LemmaBase revision are different things.
    ...(revision ? { revision } : {}),
  },
  capturedAt: new Date().toISOString(),
};
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${id} ${sourceHash} specs=${specs.join(',')} rev=${revision || '(none exposed)'}`);
