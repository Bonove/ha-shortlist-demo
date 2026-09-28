import { randomUUID } from 'node:crypto';
import type {
  ClaimCategory,
  ContractType,
  JourneyFacts,
  JourneyState,
  MomentId,
  MomentOutcome,
} from '@/lib/contracts';
import {
  type RunnableMomentId,
  RUNNABLE_MOMENTS,
  evaluateMoment,
  momentById,
  momentInput,
} from '@/lib/journey/moments';
import { getActiveSnapshot } from '@/lib/policy/snapshots';
import { readDoc, transact } from '@/lib/store/db';
import { appendEvent } from '@/lib/harness/events';

/**
 * The single enforcement point for the journey moments, as evaluate.ts is for
 * listings: nothing else in the app decides what a contract, a renewal or a
 * deposit settlement comes to. The verdict comes from `evaluateMoment`, which
 * runs the real engine; this module adds what only the harness can know —
 * provenance, persistence, staleness and the fact validation at the boundary.
 */

// Next bundles each route handler separately, so the flag lives on globalThis
// for the same reason it does in evaluate.ts: /api/status reads it from a
// different bundle than the one that set it.
const engineFlag = globalThis as { __haEngineOk?: boolean };

/** The journey as stored: the facts, and whatever has been run against them. */
export const readJourney = (): Promise<JourneyState> => readDoc((d) => d.session.journey);

// ponytail: in-process sequence numbers, exactly as in evaluate.ts. One server
// process owns the store, so a counter is enough to stop a slow earlier run
// overwriting a newer result.
let issued = 0;
const applied = new Map<MomentId, number>();

export async function runMoment(moment: RunnableMomentId): Promise<MomentOutcome> {
  const definition = momentById(moment)!;
  const snapshot = getActiveSnapshot();
  const { facts, evaluationDate } = await readDoc((d) => ({
    facts: d.session.journey.facts,
    evaluationDate: d.session.evaluationDate,
  }));

  const seq = ++issued;
  let outcome: MomentOutcome;
  try {
    outcome = evaluateMoment({
      moment,
      snapshot,
      facts,
      effective: evaluationDate ?? undefined,
    });
    engineFlag.__haEngineOk = true;
  } catch (error) {
    // An engine failure is shown as a veto, never smoothed over into a zero or
    // a "no". A moment nobody could answer is not a moment that answered no.
    engineFlag.__haEngineOk = false;
    const message = error instanceof Error ? error.message : String(error);
    const at = new Date().toISOString();
    outcome = {
      evaluationId: randomUUID(),
      moment,
      spec: definition.spec,
      decision: {
        rule: definition.decisionRule,
        label: definition.decisionLabel,
        passed: null,
        vetoed: true,
        vetoReason: message,
      },
      lines: [],
      summary: `The policy engine could not evaluate this moment: ${message}`,
      inputs: momentInput(moment, facts),
      raw: { error: message },
      snapshotId: snapshot.id,
      sourceHash: snapshot.sourceHash,
      evaluatedAt: at,
      effective: at,
      factsRevision: facts.revision,
    };
  }

  await transact((doc) => {
    if ((applied.get(moment) ?? 0) > seq) return; // a newer run already landed
    applied.set(moment, seq);
    doc.session.journey.outcomes[moment] = outcome;
    appendEvent(
      doc.session,
      'evaluation.ran',
      `Evaluated ${definition.missionTitle} against ${snapshot.label}`,
      {
        moment,
        spec: definition.spec,
        snapshotId: snapshot.id,
        sourceHash: snapshot.sourceHash,
        decision: outcome.decision.vetoed ? 'vetoed' : outcome.decision.passed,
      },
    );
  });
  return outcome;
}

export async function runAllMoments(): Promise<MomentOutcome[]> {
  const outcomes: MomentOutcome[] = [];
  for (const definition of RUNNABLE_MOMENTS) outcomes.push(await runMoment(definition.id));
  return outcomes;
}

/* ------------------------------------------------------------------- facts */

const CONTRACT_TYPES: ContractType[] = ['regulated', 'liberalised', 'student_housing'];
const CLAIM_CATEGORIES: ClaimCategory[] = [
  'none',
  'normal_wear',
  'accidental_damage',
  'cleaning',
  'missing_item',
  'redecoration',
];
const MONTH_FIELDS = new Set(['contractNoticePeriodMonths', 'noticeGivenMonths']);

/**
 * Every other numeric fact is a euro amount, so the ranges are read off the
 * field name rather than kept in a table that would drift from the contracts.
 */
function checked<T extends object>(moment: RunnableMomentId, base: T, patch: Record<string, unknown>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in base)) throw new Error(`"${key}" is not a fact of the ${moment} moment.`);
    if (key === 'contractType' && !CONTRACT_TYPES.includes(value as ContractType)) {
      throw new Error(`"contractType" must be one of ${CONTRACT_TYPES.join(', ')}.`);
    } else if (key === 'claimCategory' && !CLAIM_CATEGORIES.includes(value as ClaimCategory)) {
      throw new Error(`"claimCategory" must be one of ${CLAIM_CATEGORIES.join(', ')}.`);
    } else if (typeof (base as Record<string, unknown>)[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`"${key}" must be true or false.`);
    } else if (typeof (base as Record<string, unknown>)[key] === 'number') {
      const max = MONTH_FIELDS.has(key) ? 36 : 50000;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
        throw new Error(`"${key}" must be a number between 0 and ${max}.`);
      }
    }
    out[key] = value;
  }
  return out as T;
}

/** Merge a partial fact patch for one moment. Throws on anything out of range. */
export function updateJourneyFacts(
  moment: RunnableMomentId,
  patch: Record<string, unknown>,
): Promise<JourneyFacts> {
  return transact((doc) => {
    const journey = doc.session.journey;
    journey.facts = {
      ...journey.facts,
      [moment]: checked(moment, journey.facts[moment], patch),
      revision: journey.facts.revision + 1,
    };
    // The stored outcome was produced from the old facts, so it is now a lie
    // rather than merely old: drop it instead of showing it beside new inputs.
    delete journey.outcomes[moment];
    appendEvent(doc.session, 'scenario.changed', `${momentById(moment)!.missionTitle} facts changed`, {
      moment,
      patch,
      revision: journey.facts.revision,
    });
    return journey.facts;
  });
}

/** True when the world has moved on since this outcome was produced. */
export function isMomentStale(outcome: MomentOutcome): Promise<boolean> {
  const active = getActiveSnapshot();
  return readDoc(
    (d) =>
      outcome.factsRevision !== d.session.journey.facts.revision ||
      outcome.snapshotId !== active.id ||
      outcome.sourceHash !== active.sourceHash,
  );
}
