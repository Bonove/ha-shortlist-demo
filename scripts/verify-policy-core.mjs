/**
 * End-to-end check of the policy core, run against the real engine and the real
 * on-disk state file. Run with:  node scripts/verify-policy-core.mjs
 *
 * It restores whatever state it found when it finishes.
 */
import { readFileSync, existsSync, copyFileSync, unlinkSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve as resolveAlias } from './alias-loader.mjs';

// Minimal "@/..." resolver so the app's server modules load under plain node.
registerHooks({ resolve: resolveAlias });

const STATE = 'data/policy-state.json';
const BACKUP = 'data/policy-state.backup.json';
const hadState = existsSync(STATE);
if (hadState) copyFileSync(STATE, BACKUP);

const fail = (m) => {
  console.error('FAIL:', m);
  process.exitCode = 1;
};
const ok = (m) => console.log('ok  ', m);

try {
  const snapshots = await import('../src/lib/policy/snapshots.ts');
  const drafts = await import('../src/lib/policy/drafts.ts');
  const bundleMod = await import('../src/lib/policy/bundle.ts');
  const engine = await import('../src/lib/lemma/engine.ts');
  const assess = await import('../src/lib/lemma/assess.ts');
  const diff = await import('../src/lib/policy/diff.ts');

  console.log('runtime:', engine.runtimeLabel());

  const issues = snapshots.integrityIssues();
  issues.length ? fail(`integrity: ${issues.join(' ')}`) : ok('all captured manifests match hashBundle()');

  const tenant = {
    name: 'Alex',
    city: 'Amsterdam',
    intendedStayMonths: 5,
    maxMonthlyRent: 1200,
    maxInitialPayment: 2500,
    prefersShortCommute: true,
    revision: 1,
  };
  const listings = [
    { reference: 'A', monthlyRent: 1100, requestedDepositMonths: 2, minimumStayMonths: 3 },
    { reference: 'B', monthlyRent: 1150, requestedDepositMonths: 1, minimumStayMonths: 4 },
    { reference: 'C', monthlyRent: 1050, requestedDepositMonths: 1, minimumStayMonths: 6 },
  ].map((l) => ({
    ...l,
    name: l.reference,
    neighbourhood: 'Amsterdam',
    travelMinutesToUniversity: 10,
    availableForRequestedDates: true,
    imageHue: 200,
    revision: 1,
  }));

  const run = (snapshot) =>
    listings
      .map((listing) => {
        const a = assess.assessListing({ snapshot, tenant, listing });
        return `${listing.reference}=${a.costs.initialPayment}/${a.status === 'fits'}`;
      })
      .join(' ');

  // 1. S0 must be the default active snapshot and produce the fixture.
  snapshots.writeState({ activeId: 'S0', previousId: null, importedSnapshots: [], drafts: [] });
  const s0 = snapshots.getActiveSnapshot();
  s0.id === 'S0' ? ok('default active snapshot is S0') : fail(`active is ${s0.id}`);
  const s0Line = run(s0);
  s0Line === 'A=3450/false B=2450/true C=2250/false'
    ? ok(`S0 ${s0Line}`)
    : fail(`S0 fixture mismatch: ${s0Line}`);

  // 2. Activate S2 and re-evaluate.
  const after = snapshots.activate('S2');
  after.activeId === 'S2' && after.previousId === 'S0'
    ? ok('activate(S2) recorded previousId=S0')
    : fail(`activate returned ${JSON.stringify(after)}`);
  const s2Line = run(snapshots.getActiveSnapshot());
  s2Line === 'A=2300/true B=2400/true C=2200/false'
    ? ok(`S2 ${s2Line}`)
    : fail(`S2 fixture mismatch: ${s2Line}`);

  // 3. A deliberately broken draft must produce real diagnostics and change nothing.
  const broken = [{ path: 'shortlist_policy.lemma', code: 'spec shortlist_policy 2026-01-01\n\nrule booking_fee:\n  150 eur +\n' }];
  const { validation } = engine.loadIsolated(broken);
  !validation.valid && validation.diagnostics[0]?.line
    ? ok(`broken draft rejected: ${validation.diagnostics[0].kind} "${validation.diagnostics[0].message}" at line ${validation.diagnostics[0].line}`)
    : fail(`broken draft was not rejected: ${JSON.stringify(validation)}`);
  const stillActive = snapshots.getActiveSnapshot();
  stillActive.id === 'S2' && run(stillActive) === s2Line
    ? ok('active snapshot unchanged after validating a broken draft')
    : fail('active snapshot was damaged by draft validation');

  // 4. Export S2 and re-import it; the hash must survive the round trip.
  const exported = bundleMod.exportBundle(snapshots.getSnapshot('S2'));
  const roundTripped = bundleMod.importBundle(JSON.parse(JSON.stringify(exported)));
  roundTripped.sourceHash === exported.snapshot.sourceHash
    ? ok(`export/import hash matches ${roundTripped.sourceHash.slice(0, 20)}… as ${roundTripped.id}`)
    : fail(`hash drifted: ${roundTripped.sourceHash} vs ${exported.snapshot.sourceHash}`);
  roundTripped.provenance === 'import-metadata'
    ? ok('imported bundle marked import-metadata')
    : fail(`provenance is ${roundTripped.provenance}`);

  // 5. A tampered bundle must be rejected and leave the pointer alone.
  const tampered = JSON.parse(JSON.stringify(exported));
  tampered.snapshot.files[0].code += '\n';
  try {
    bundleMod.importBundle(tampered);
    fail('tampered bundle was accepted');
  } catch (e) {
    e.name === 'BundleError' ? ok(`tampered bundle rejected: ${e.message.slice(0, 60)}…`) : fail(`wrong error ${e}`);
  }
  snapshots.readState().activeId === 'S2'
    ? ok('active pointer untouched by the failed import')
    : fail('failed import moved the active pointer');

  // 6. Drafts and diff.
  const draft = drafts.saveDraft({ name: 'Fee cut', basedOn: 'S2', files: snapshots.getSnapshot('S2').files });
  drafts.draftAsSnapshot(draft).provenance === 'local-draft'
    ? ok('draft is labelled local-draft')
    : fail('draft provenance is wrong');
  const lines = diff.diffBundles(snapshots.getSnapshot('S0').files, snapshots.getSnapshot('S2').files);
  const changed = lines.filter((l) => l.type !== 'ctx');
  changed.length > 0 && lines.some((l) => l.type === 'ctx')
    ? ok(`diff S0→S2: ${changed.filter((l) => l.type === 'add').length} added, ${changed.filter((l) => l.type === 'del').length} removed`)
    : fail('diff produced nothing useful');

  // 7. restore()
  snapshots.restore('S0').activeId === 'S0' ? ok('restore("S0") works') : fail('restore("S0") failed');
  snapshots.restore('previous').activeId === 'S2' ? ok('restore("previous") works') : fail('restore("previous") failed');
} finally {
  if (hadState) copyFileSync(BACKUP, STATE), unlinkSync(BACKUP);
  else rmSync(STATE, { force: true });
}
console.log(process.exitCode ? 'VERIFY FAILED' : 'VERIFY OK');
