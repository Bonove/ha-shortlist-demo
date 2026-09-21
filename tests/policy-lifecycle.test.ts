/**
 * The lifecycle guarantees a presenter is betting on: a bad edit cannot become
 * the running policy, a restore really restores the numbers, a comparison is
 * measured against frozen inputs, and an application is checked against the
 * policy that is live right now.
 *
 * These tests move real policy and session state on disk, so the two state
 * files are saved before and put back afterwards.
 */

import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Assessment, PolicySnapshot } from '@/lib/contracts';
import { SPEC_PATH } from '@/lib/contracts';
import { compareSnapshots, refreezeScenario } from '@/lib/harness/comparison';
import { evaluateListings } from '@/lib/harness/evaluate';
import { exportBundle } from '@/lib/policy/bundle';
import { hashBundle } from '@/lib/policy/hash';
import { activate, getActiveSnapshot, getSnapshot, readState, restore } from '@/lib/policy/snapshots';
import { readSession, resetDoc, updateSession } from '@/lib/store/db';
import { POST as applicationRoute } from '@/app/api/application/route';
import { POST as importRoute } from '@/app/api/policy/import/route';
import { POST as validateRoute } from '@/app/api/policy/validate/route';

const ROOT = process.cwd();
const STATE_FILES = [join(ROOT, 'data', 'policy-state.json'), join(ROOT, 'data', 'session.json')];

beforeAll(() => {
  for (const file of STATE_FILES) if (existsSync(file)) copyFileSync(file, `${file}.testbackup`);
});

afterAll(async () => {
  await resetDoc();
  for (const file of STATE_FILES) {
    if (existsSync(`${file}.testbackup`)) {
      copyFileSync(`${file}.testbackup`, file);
      rmSync(`${file}.testbackup`);
    }
  }
});

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Identity of whatever is live right now. */
const live = () => {
  const active = getActiveSnapshot();
  return { id: active.id, sourceHash: active.sourceHash };
};

/** What the tenant is quoted for every home under the active snapshot. */
async function activeRow(): Promise<Record<string, { initialPayment: number | null; status: string }>> {
  const assessments = await evaluateListings();
  return Object.fromEntries(
    assessments.map((a: Assessment) => [a.listingReference, { initialPayment: a.costs.initialPayment, status: a.status }]),
  );
}

const ROW_S0 = {
  A: { initialPayment: 3450, status: 'does-not-fit' },
  B: { initialPayment: 2450, status: 'fits' },
  C: { initialPayment: 2250, status: 'does-not-fit' },
};
const ROW_S3 = {
  A: { initialPayment: 2300, status: 'fits' },
  B: { initialPayment: 2400, status: 'fits' },
  C: { initialPayment: 2200, status: 'fits' },
};

const BROKEN_SOURCE = ['spec shortlist_policy 2026-01-01', 'uses lemma units', '', 'rule offer_fits:', '  monthly_rent +'].join('\n');

describe('7. invalid source cannot replace the active snapshot', () => {
  it('rejects deliberately broken Lemma with real diagnostics, and leaves the active snapshot untouched', async () => {
    activate('S0');
    const before = live();

    const response = await validateRoute(post('/api/policy/validate', { files: [{ path: SPEC_PATH, code: BROKEN_SOURCE }] }));
    const validation = (await response.json()) as { valid: boolean; diagnostics: { kind: string; message: string; line?: number; path?: string }[] };

    expect(validation.valid, 'broken source must not validate').toBe(false);
    expect(validation.diagnostics.length).toBeGreaterThan(0);
    // A real diagnostic from the engine: a kind, a message and a position.
    expect(validation.diagnostics[0].kind).toBe('parsing');
    expect(validation.diagnostics[0].message).toMatch(/expression/i);
    expect(validation.diagnostics[0].line).toBeGreaterThan(0);
    expect(validation.diagnostics[0].path).toBe(SPEC_PATH);

    expect(live(), 'a failed validation must not move the active pointer').toEqual(before);
  });

  it('still accepts the published source, so the validator is not simply refusing everything', async () => {
    const response = await validateRoute(post('/api/policy/validate', { files: getSnapshot('S2').files }));
    expect(await response.json()).toEqual({ valid: true, diagnostics: [] });
  });
});

describe('8. a failed import leaves the active version intact', () => {
  const importing = async (bundle: unknown) => {
    const before = live();
    const imported = readState().importedSnapshots.length;
    const response = await importRoute(post('/api/policy/import', { bundle }));
    const body = (await response.json()) as { error?: string; diagnostics?: unknown[] };
    expect(live(), 'a rejected bundle must not change what is running').toEqual(before);
    expect(readState().importedSnapshots.length, 'a rejected bundle must not be stored').toBe(imported);
    return { status: response.status, body };
  };

  beforeAll(() => {
    activate('S0');
  });

  it('refuses a bundle whose hash does not match its contents', async () => {
    const bundle = exportBundle(getSnapshot('S0'));
    // Same claimed sourceHash, different source text.
    bundle.snapshot = {
      ...bundle.snapshot,
      files: [{ path: SPEC_PATH, code: bundle.snapshot.files[0].code.replace('\n  150 eur', '\n  900 eur') }],
    };
    const { status, body } = await importing(bundle);
    expect(status).toBe(400);
    expect(body.error).toMatch(/hash mismatch/i);
  });

  it('refuses an incomplete bundle with no source text', async () => {
    const bundle = exportBundle(getSnapshot('S0'));
    bundle.snapshot = { ...bundle.snapshot, files: [{ path: SPEC_PATH, code: '' }] };
    const { status, body } = await importing(bundle);
    expect(status).toBe(400);
    expect(body.error).toMatch(/missing or empty/i);
  });

  it('refuses a bundle with no files at all', async () => {
    const bundle = exportBundle(getSnapshot('S0'));
    bundle.snapshot = { ...bundle.snapshot, files: [] };
    const { status, body } = await importing(bundle);
    expect(status).toBe(400);
    expect(body.error).toMatch(/missing an id or any source files/i);
  });

  it('refuses a bundle whose source will not load into the engine', async () => {
    const bundle = exportBundle(getSnapshot('S0'));
    const files = [{ path: SPEC_PATH, code: BROKEN_SOURCE }];
    bundle.snapshot = { ...bundle.snapshot, files, sourceHash: hashBundle(files) };
    const { status, body } = await importing(bundle);
    expect(status).toBe(400);
    expect(body.error).toMatch(/does not load into the engine/i);
    expect(body.diagnostics?.length).toBeGreaterThan(0);
  });
});

describe('9. restoring a snapshot restores its results', () => {
  beforeAll(async () => {
    await resetDoc();
    activate('S0');
  });

  it('S0 is the baseline row', async () => {
    expect(await activeRow()).toEqual(ROW_S0);
  });

  it('activating S3 changes every quoted number', async () => {
    activate('S3');
    expect(getActiveSnapshot().id).toBe('S3');
    expect(await activeRow()).toEqual(ROW_S3);
  });

  it('restoring to the previous snapshot brings the S0 numbers back', async () => {
    const { activeId } = restore('previous');
    expect(activeId).toBe('S0');
    expect(await activeRow()).toEqual(ROW_S0);
  });

  it('restoring to S0 from S3 brings the S0 numbers back', async () => {
    activate('S3');
    expect(await activeRow()).toEqual(ROW_S3);
    const { activeId } = restore('S0');
    expect(activeId).toBe('S0');
    expect(await activeRow()).toEqual(ROW_S0);
    expect(getActiveSnapshot().sourceHash).toBe(getSnapshot('S0').sourceHash);
  });
});

describe('10. a policy comparison is measured against frozen inputs', () => {
  const stepFor = (steps: Awaited<ReturnType<typeof compareSnapshots>>, id: string) => {
    const step = steps.find((s) => s.snapshotId === id);
    if (!step) throw new Error(`no comparison step for ${id}`);
    return step;
  };
  const statusOf = (steps: Awaited<ReturnType<typeof compareSnapshots>>, id: string, reference: string) =>
    stepFor(steps, id).assessments.find((a) => a.listingReference === reference)?.status;

  it('keeps using the frozen inputs after the tenant changes, until an explicit refreeze', async () => {
    await resetDoc();
    const frozen = await refreezeScenario();
    const before = await compareSnapshots();
    expect(stepFor(before, 'S0').inputsHash).toBe(frozen.inputsHash);
    expect(statusOf(before, 'S0', 'B')).toBe('fits');

    // The tenant lowers her monthly budget below B's rent. The comparison table
    // was frozen before that, so it must not quietly change underneath it.
    await updateSession((session) => {
      session.tenant.maxMonthlyRent = 900;
      session.tenant.revision += 1;
    });

    const after = await compareSnapshots();
    expect(stepFor(after, 'S0').inputsHash, 'the comparison must still cite the frozen inputs').toBe(
      frozen.inputsHash,
    );
    expect(statusOf(after, 'S0', 'B'), 'frozen inputs mean a frozen verdict').toBe('fits');

    const refrozen = await refreezeScenario();
    expect(refrozen.inputsHash, 'an explicit refreeze must produce a new input set').not.toBe(frozen.inputsHash);

    const rerun = await compareSnapshots();
    expect(stepFor(rerun, 'S0').inputsHash).toBe(refrozen.inputsHash);
    expect(statusOf(rerun, 'S0', 'B'), '€1,150 is above the new €900 limit').toBe('does-not-fit');
  });

  it('evaluates every snapshot on its own source rather than deriving one from the last', async () => {
    await resetDoc();
    await refreezeScenario();
    const steps = await compareSnapshots();
    for (const id of ['S0', 'S1', 'S2', 'S3']) {
      expect(stepFor(steps, id).sourceHash, `${id} must be measured on ${id}'s own source`).toBe(
        getSnapshot(id).sourceHash,
      );
      for (const assessment of stepFor(steps, id).assessments) expect(assessment.snapshotId).toBe(id);
    }
    // Same frozen inputs, different sources, different answers.
    expect(statusOf(steps, 'S0', 'C')).toBe('does-not-fit');
    expect(statusOf(steps, 'S3', 'C')).toBe('fits');
  });
});

describe('11. a newer publication does not silently change the running policy', () => {
  it('an imported snapshot sits there until somebody activates it', async () => {
    activate('S0');
    const before = live();

    // A later publication arrives: same spec, a higher booking fee.
    const files = [
      {
        path: SPEC_PATH,
        code: getSnapshot('S0').files[0].code.replace('\n  150 eur', '\n  175 eur'),
      },
    ];
    const bundle = exportBundle(getSnapshot('S0'));
    bundle.snapshot = {
      ...bundle.snapshot,
      id: 'S4-later-publication',
      files,
      sourceHash: hashBundle(files),
    } as PolicySnapshot;

    const response = await importRoute(post('/api/policy/import', { bundle }));
    expect(response.status).toBe(200);
    const { snapshot } = (await response.json()) as { snapshot: PolicySnapshot };
    expect(snapshot.id).toBe('S4-later-publication');
    // Nobody re-read LemmaBase, so it says so.
    expect(snapshot.provenance).toBe('import-metadata');

    expect(live(), 'importing a newer snapshot must not change the running policy').toEqual(before);
    expect(await activeRow()).toEqual(ROW_S0);

    // Only an explicit activation switches the runtime over.
    activate(snapshot.id);
    expect(live().id).toBe('S4-later-publication');
    expect(live().sourceHash).not.toBe(before.sourceHash);
    const row = await activeRow();
    expect(row.B.initialPayment, '€1,150 rent + €1,150 deposit + €175 fee').toBe(2475);

    restore('S0');
    expect(live()).toEqual(before);
  });
});

describe('12. an application is checked against the policy and data that are live now', () => {
  beforeAll(async () => {
    await resetDoc();
    activate('S0');
  });

  it("refuses a home that does not fit, and records nothing", async () => {
    const response = await applicationRoute(post('/api/application', { listingReference: 'A' }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; assessment: Assessment };
    expect(body.error).toMatch(/does not fit/i);
    // The refusal carries the fresh assessment it was based on, not the client's.
    expect(body.assessment.status).toBe('does-not-fit');
    expect(body.assessment.costs.initialPayment).toBe(3450);
    expect(body.assessment.snapshotId).toBe('S0');
    expect((await readSession()).applications).toHaveLength(0);
  });

  it('records a demonstration application for a home that does fit, tied to the source that said so', async () => {
    const response = await applicationRoute(post('/api/application', { listingReference: 'B' }));
    expect(response.status).toBe(200);
    const { application } = (await response.json()) as { application: { snapshotId: string; sourceHash: string; evaluationId: string } };
    expect(application.snapshotId).toBe('S0');
    expect(application.sourceHash).toBe(getSnapshot('S0').sourceHash);
    expect(application.evaluationId).toBeTruthy();
    expect((await readSession()).applications).toHaveLength(1);
  });

  it('re-evaluates rather than trusting an earlier answer: B stops fitting and is refused', async () => {
    await updateSession((session) => {
      const b = session.listings.find((l) => l.reference === 'B');
      if (!b) throw new Error('listing B missing');
      b.monthlyRent = 1400; // now above the €1,200 monthly limit
      b.revision += 1;
    });

    const response = await applicationRoute(post('/api/application', { listingReference: 'B' }));
    expect(response.status, 'the fresh evaluation must decide, not the one from a moment ago').toBe(409);
    const body = (await response.json()) as { assessment: Assessment };
    expect(body.assessment.status).toBe('does-not-fit');
    expect(body.assessment.checks.find((c) => c.rule === 'fits_monthly_budget')?.passed).toBe(false);
    expect((await readSession()).applications, 'the refused attempt must not be recorded').toHaveLength(1);
  });

  it('refuses an application for a home that cannot be assessed at all', async () => {
    await updateSession((session) => {
      const c = session.listings.find((l) => l.reference === 'C');
      if (!c) throw new Error('listing C missing');
      c.requestedDepositMonths = null; // the advertiser has not stated a deposit
      c.revision += 1;
    });
    const response = await applicationRoute(post('/api/application', { listingReference: 'C' }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; assessment: Assessment };
    expect(body.assessment.status).toBe('needs-information');
    expect(body.error).toMatch(/needs-information/);
  });
});

/** The state files must survive the suite. */
it('the policy state file is still valid JSON with an active pointer', () => {
  const state = JSON.parse(readFileSync(STATE_FILES[0], 'utf8')) as { activeId: string };
  expect(state.activeId).toBeTruthy();
});
