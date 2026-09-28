/**
 * The assistant's entire capability surface.
 *
 * The safety property of this demo is structural, not textual: there is no tool
 * that edits policy, publishes policy or sets a fit status, so no prompt — from
 * the user or from anywhere else — can make the assistant do those things. A
 * system prompt can be argued with; a missing function cannot.
 */

import type OpenAI from 'openai';
import type { Assessment, MomentOutcome, TenantProfile } from '@/lib/contracts';
import { readSession, updateSession } from '@/lib/store/db';
import { evaluateListings } from '@/lib/harness/evaluate';
import { runMoment } from '@/lib/harness/journey';
import { isRunnableMoment, momentById, type RunnableMomentId } from '@/lib/journey/moments';
import { getActiveSnapshot } from '@/lib/policy/snapshots';

/** Ranges the demo will accept. Outside these we ask rather than guess. */
const NUMERIC: Record<string, { min: number; max: number; label: string }> = {
  intendedStayMonths: { min: 1, max: 36, label: 'Stay length, in whole months' },
  maxMonthlyRent: { min: 100, max: 10000, label: 'Maximum monthly rent, in whole euro' },
  maxInitialPayment: { min: 0, max: 50000, label: 'Maximum initial payment, in whole euro' },
};

const noInput = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

/** The shortlist is absent on purpose: it has its own tools above. */
const momentParameter = {
  type: 'object',
  properties: {
    moment: {
      type: 'string',
      enum: ['contract', 'renewal', 'deposit'],
      description: 'Which decision moment of the tenancy to run.',
    },
  },
  required: ['moment'],
  additionalProperties: false,
};

export const TOOL_DEFINITIONS: OpenAI.Responses.Tool[] = [
  {
    type: 'function',
    strict: false,
    name: 'get_tenant_profile',
    description:
      'Read the tenant requirements that have been confirmed so far: city, intended stay, maximum monthly rent, maximum initial payment and commute preference.',
    parameters: noInput,
  },
  {
    type: 'function',
    strict: false,
    name: 'update_tenant_profile',
    description:
      'Update one or more confirmed tenant requirements. Only send a field the tenant has actually stated. Values outside the accepted range are rejected with an explanation you should relay.',
    parameters: {
      type: 'object',
      properties: {
        intendedStayMonths: { type: 'integer', description: 'Intended stay in whole months, 1 to 36.' },
        maxMonthlyRent: { type: 'integer', description: 'Maximum monthly rent in whole euro, 100 to 10000.' },
        maxInitialPayment: {
          type: 'integer',
          description: 'Maximum first payment (first month, deposit and booking fee) in whole euro, 0 to 50000.',
        },
        prefersShortCommute: { type: 'boolean', description: 'Whether a short commute matters to the tenant.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    strict: false,
    name: 'find_listings',
    description:
      'List the demonstration listings with the facts their advertisers state. These are advertised facts only and never a verdict: to say anything about cost or fit you must call evaluate_listings.',
    parameters: noInput,
  },
  {
    type: 'function',
    strict: false,
    name: 'evaluate_listings',
    description:
      'Run the published policy over the listings using the real rules engine and return the authoritative assessments. This is the only source of costs, deposits and fit verdicts.',
    parameters: {
      type: 'object',
      properties: {
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Listing references such as ["A","B"]. Omit to evaluate every listing.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    strict: false,
    name: 'explain_assessment',
    description:
      'Explain one stored assessment: every check, the cost breakdown, any missing inputs, and which policy snapshot produced it.',
    parameters: {
      type: 'object',
      properties: { reference: { type: 'string', description: 'Listing reference, e.g. "A".' } },
      required: ['reference'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    strict: false,
    name: 'get_active_policy',
    description:
      'Read the policy snapshot currently in force: its id, label, description, source hash and publication metadata.',
    parameters: noInput,
  },
  {
    type: 'function',
    strict: false,
    name: 'get_journey_facts',
    description:
      "Read the facts of Alex's tenancy that the later moments are decided on: the contract as offered, the renewal being proposed and the landlord's deposit claim. These are facts, never a verdict: to say whether anything is permitted, or what it costs, you must call evaluate_moment.",
    parameters: noInput,
  },
  {
    type: 'function',
    strict: false,
    name: 'evaluate_moment',
    description:
      "Run one moment of the tenancy through the published policy using the real rules engine: the contract check, the renewal offer or the deposit settlement. This is the only source of the figures and the verdict for that moment. A moment can also come back with no answer, which means the policy does not cover the case and is not the same as a no.",
    parameters: momentParameter,
  },
  {
    type: 'function',
    strict: false,
    name: 'explain_moment',
    description:
      'Explain one stored moment outcome: every rule the engine returned, the plain-language summary, the facts it ran on, and which policy snapshot and dated spec version produced it.',
    parameters: momentParameter,
  },
];

/** `raw` is the whole engine response; it is provenance, not conversation. */
const forModel = (a: Assessment) => ({
  listingReference: a.listingReference,
  status: a.status,
  summary: a.summary,
  checks: a.checks,
  costs: a.costs,
  missingInputs: a.missingInputs,
  snapshotId: a.snapshotId,
  sourceHash: a.sourceHash,
  evaluatedAt: a.evaluatedAt,
});

/** Same discipline for a moment: `raw` is provenance, not conversation. */
const momentForModel = (o: MomentOutcome) => ({
  moment: o.moment,
  spec: o.spec,
  decision: o.decision,
  lines: o.lines,
  summary: o.summary,
  inputs: o.inputs,
  snapshotId: o.snapshotId,
  sourceHash: o.sourceHash,
  evaluatedAt: o.evaluatedAt,
  effective: o.effective,
  specEffectiveFrom: o.specEffectiveFrom,
});

/** Rejects an unknown moment with words the model can act on, not a throw. */
function requireMoment(input: Record<string, unknown>): RunnableMomentId | { error: string } {
  const moment = typeof input.moment === 'string' ? input.moment : '';
  if (!isRunnableMoment(moment)) {
    return {
      error: `"${moment}" is not a moment this tool can run. Use "contract", "renewal" or "deposit". The shortlist is evaluated with evaluate_listings instead.`,
    };
  }
  return moment;
}

const handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
  async get_tenant_profile() {
    return (await readSession()).tenant;
  },

  async update_tenant_profile(input) {
    const rejected: string[] = [];
    const patch: Partial<TenantProfile> = {};

    for (const [field, rule] of Object.entries(NUMERIC)) {
      const value = input[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        rejected.push(
          `${rule.label}: received ${JSON.stringify(value)}, which is not a whole number. Ask the tenant for a number.`,
        );
      } else if (value < rule.min || value > rule.max) {
        rejected.push(
          `${rule.label}: ${value} is outside the accepted range ${rule.min}–${rule.max}. Ask the tenant to confirm a value in that range.`,
        );
      } else {
        (patch as Record<string, unknown>)[field] = value;
      }
    }
    if (typeof input.prefersShortCommute === 'boolean') patch.prefersShortCommute = input.prefersShortCommute;

    if (rejected.length) return { applied: false, error: rejected.join(' ') };
    if (!Object.keys(patch).length) {
      return {
        applied: false,
        error:
          'Nothing to update. Send at least one of intendedStayMonths, maxMonthlyRent, maxInitialPayment or prefersShortCommute.',
      };
    }

    // The revision bump is what makes existing assessments provably stale.
    const session = await updateSession((s) => {
      Object.assign(s.tenant, patch);
      s.tenant.revision += 1;
    });
    return {
      applied: true,
      changed: Object.keys(patch),
      profile: session.tenant,
      note: 'Requirements changed. Earlier assessments are now out of date — call evaluate_listings again.',
    };
  },

  async find_listings() {
    const { listings } = await readSession();
    return {
      note: 'Advertised facts only. No cost or fit conclusion may be drawn from these without evaluate_listings.',
      listings: listings.map((l) => ({
        reference: l.reference,
        name: l.name,
        neighbourhood: l.neighbourhood,
        monthlyRent: l.monthlyRent,
        requestedDepositMonths:
          l.requestedDepositMonths ?? 'not stated by the advertiser — an unknown deposit is not zero',
        minimumStayMonths: l.minimumStayMonths,
        travelMinutesToUniversity: l.travelMinutesToUniversity,
        availableForRequestedDates: l.availableForRequestedDates,
      })),
    };
  },

  async evaluate_listings(input) {
    const refs = Array.isArray(input.references)
      ? input.references.filter((r): r is string => typeof r === 'string')
      : undefined;
    const assessments = await evaluateListings(refs?.length ? refs : undefined);
    const snapshot = await getActiveSnapshot();
    return {
      snapshot: { id: snapshot.id, label: snapshot.label, sourceHash: snapshot.sourceHash },
      assessments: assessments.map(forModel),
    };
  },

  async explain_assessment(input) {
    const reference = typeof input.reference === 'string' ? input.reference : '';
    const [session, snapshot] = await Promise.all([readSession(), getActiveSnapshot()]);
    const assessment = session.assessments[reference];
    if (!assessment) {
      return {
        error: `No stored assessment for listing "${reference}". Call evaluate_listings first; do not describe its cost or fit until you have.`,
      };
    }
    return {
      ...forModel(assessment),
      policy: {
        snapshotId: assessment.snapshotId,
        sourceHash: assessment.sourceHash,
        label: snapshot.label,
        description: snapshot.description,
        stillActive: assessment.snapshotId === snapshot.id,
      },
      provenance: {
        tenantRevision: assessment.tenantRevision,
        listingRevision: assessment.listingRevision,
        effective: assessment.effective,
      },
    };
  },

  async get_active_policy() {
    const s = await getActiveSnapshot();
    return {
      id: s.id,
      label: s.label,
      description: s.description,
      sourceHash: s.sourceHash,
      provenance: s.provenance,
      capturedAt: s.capturedAt,
      publication: s.publication ?? null,
      note: 'The application runs from this stored published snapshot. It cannot change policy.',
    };
  },

  async get_journey_facts() {
    const { journey } = await readSession();
    return {
      note: "The facts of Alex's tenancy as they currently stand. They are what the engine is given, not what it concluded: no figure here is a permitted amount and no field here is a verdict.",
      facts: journey.facts,
    };
  },

  async evaluate_moment(input) {
    const moment = requireMoment(input);
    if (typeof moment !== 'string') return moment;
    const outcome = await runMoment(moment);
    const snapshot = await getActiveSnapshot();
    return {
      snapshot: { id: snapshot.id, label: snapshot.label, sourceHash: snapshot.sourceHash },
      outcome: momentForModel(outcome),
    };
  },

  async explain_moment(input) {
    const moment = requireMoment(input);
    if (typeof moment !== 'string') return moment;
    const [session, snapshot] = await Promise.all([readSession(), getActiveSnapshot()]);
    const outcome = session.journey.outcomes[moment];
    if (!outcome) {
      return {
        error: `No stored outcome for the ${moment} moment. Call evaluate_moment first; do not describe any figure or say whether it is permitted until you have.`,
      };
    }
    const definition = momentById(moment)!;
    return {
      ...momentForModel(outcome),
      question: definition.question,
      policy: {
        snapshotId: outcome.snapshotId,
        sourceHash: outcome.sourceHash,
        label: snapshot.label,
        description: snapshot.description,
        stillActive: outcome.snapshotId === snapshot.id,
      },
      provenance: {
        factsRevision: outcome.factsRevision,
        effective: outcome.effective,
        specEffectiveFrom: outcome.specEffectiveFrom,
      },
      // Stale means the world moved after the run, so the figures below are a
      // record of what the policy said, not what it says.
      stillCurrent:
        outcome.snapshotId === snapshot.id &&
        outcome.sourceHash === snapshot.sourceHash &&
        outcome.factsRevision === session.journey.facts.revision,
    };
  },
};

export async function runTool(name: string, input: unknown): Promise<unknown> {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool "${name}".`);
  return handler((input ?? {}) as Record<string, unknown>);
}
