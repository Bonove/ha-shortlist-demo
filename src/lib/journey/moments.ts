/**
 * The journey spine: what each moment asks, which spec answers it, and which
 * lines of that answer a person needs to see.
 *
 * All three runnable moments go through one evaluator on purpose. They look
 * like different problems — a contract, a rent increase, a deposit — and they
 * are the same kind of decision: facts in, an outcome with the rule that
 * produced it out. Anything that made them diverge here would be hiding that.
 *
 * The shortlist is listed too, because it is the first moment of the same
 * journey, but it keeps its own machinery in lemma/assess.ts: it evaluates
 * three listings rather than one set of facts.
 */

import { randomUUID } from 'node:crypto';
import type {
  JourneyFacts,
  MomentId,
  MomentLine,
  MomentLineKind,
  MomentOutcome,
  PolicySnapshot,
} from '@/lib/contracts';
import { type LemmaEvaluation, type LemmaRuleResult, runSpec } from '@/lib/lemma/engine';
import { formatEuro } from '@/lib/lemma/assess';

/** Everything except the shortlist, which has its own evaluator. */
export type RunnableMomentId = Exclude<MomentId, 'shortlist'>;

export interface MomentLineSpec {
  rule: string;
  label: string;
  kind: MomentLineKind;
}

export interface MomentDefinition {
  id: MomentId;
  /** Service mission number, as the mission cards number them. */
  mission: string;
  missionTitle: string;
  phase: string;
  /** The question this moment exists to answer, in a person's words. */
  question: string;
  /** Lemma spec name inside the published bundle. */
  spec: string;
  /** The headline rule. */
  decisionRule: string;
  decisionLabel: string;
  lines: MomentLineSpec[];
}

export const MOMENTS: MomentDefinition[] = [
  {
    id: 'shortlist',
    mission: '00',
    missionTitle: 'From search overload to a trusted shortlist',
    phase: 'Booking',
    question: 'Which of these homes fits what Alex can actually carry?',
    spec: 'shortlist_policy',
    decisionRule: 'offer_fits',
    decisionLabel: 'This home fits the stated requirements',
    lines: [],
  },
  {
    id: 'contract',
    mission: '02',
    missionTitle: 'From booking first, contract later to one clear commitment',
    phase: 'Booking',
    question: 'May this contract be signed as it is offered?',
    spec: 'contract_check',
    decisionRule: 'contract_may_be_signed',
    decisionLabel: 'This contract may be signed as offered',
    lines: [
      { rule: 'contract_monthly_cost', label: 'What the contract costs each month', kind: 'money' },
      { rule: 'undisclosed_monthly_cost', label: 'On top of the advertised rent', kind: 'money' },
      { rule: 'monthly_cost_as_advertised', label: 'Monthly cost matches the advert', kind: 'decision' },
      { rule: 'deposit_as_advertised', label: 'Deposit matches the advert', kind: 'decision' },
      { rule: 'maximum_deposit', label: 'Most that may be asked as a deposit', kind: 'money' },
      { rule: 'deposit_within_cap', label: 'Deposit within the cap', kind: 'decision' },
      { rule: 'notice_period_acceptable', label: 'Notice period within the limit', kind: 'decision' },
    ],
  },
  {
    id: 'renewal',
    mission: '06',
    missionTitle: 'Renewal becomes a proactive decision moment',
    phase: 'Staying',
    question: 'May this renewal offer be made, and at what rent?',
    spec: 'renewal_policy',
    decisionRule: 'renewal_offer_permitted',
    decisionLabel: 'This renewal offer may be made',
    lines: [
      { rule: 'maximum_increase', label: 'Cap on the increase', kind: 'ratio' },
      { rule: 'maximum_renewal_rent', label: 'Most that may be asked', kind: 'money' },
      { rule: 'offer_within_cap', label: 'Offer within the cap', kind: 'decision' },
      { rule: 'notice_is_timely', label: 'Offered in time', kind: 'decision' },
    ],
  },
  {
    id: 'deposit',
    mission: '07',
    missionTitle: 'From move-out to the next trusted move-in',
    phase: 'Moving out',
    question: 'What may be withheld from the deposit, and what goes back?',
    spec: 'deposit_settlement',
    decisionRule: 'claim_upheld_in_full',
    decisionLabel: "The landlord's claim is upheld in full",
    lines: [
      { rule: 'total_claimed', label: 'Claimed by the landlord', kind: 'money' },
      { rule: 'chargeable_claim', label: 'Chargeable under the policy', kind: 'money' },
      { rule: 'evidenced_claim', label: 'Supported by evidence on both sides', kind: 'money' },
      { rule: 'total_deduction', label: 'Total deduction', kind: 'money' },
      { rule: 'deduction_payable', label: 'Withheld from the deposit', kind: 'money' },
      { rule: 'refund_to_tenant', label: 'Returned to the tenant', kind: 'money' },
    ],
  },
];

export const RUNNABLE_MOMENTS = MOMENTS.filter((m) => m.id !== 'shortlist') as (MomentDefinition & {
  id: RunnableMomentId;
})[];

export function momentById(id: string): MomentDefinition | undefined {
  return MOMENTS.find((m) => m.id === id);
}

export const isRunnableMoment = (id: string): id is RunnableMomentId =>
  RUNNABLE_MOMENTS.some((m) => m.id === id);

/* ------------------------------------------------------------------ inputs */

/**
 * Facts as the engine wants them. Amounts carry their unit in the value, never
 * in the name, because that is how the specs declare them.
 */
export function momentInput(moment: RunnableMomentId, facts: JourneyFacts): Record<string, unknown> {
  if (moment === 'contract') {
    const c = facts.contract;
    return {
      advertised_monthly_rent: `${c.advertisedMonthlyRent} eur`,
      contract_monthly_rent: `${c.contractMonthlyRent} eur`,
      contract_service_charge: `${c.contractServiceCharge} eur`,
      advertised_deposit: `${c.advertisedDeposit} eur`,
      contract_deposit: `${c.contractDeposit} eur`,
      contract_notice_period: `${c.contractNoticePeriodMonths} month`,
    };
  }
  if (moment === 'renewal') {
    const r = facts.renewal;
    return {
      current_monthly_rent: `${r.currentMonthlyRent} eur`,
      proposed_monthly_rent: `${r.proposedMonthlyRent} eur`,
      contract_type: r.contractType,
      notice_given: `${r.noticeGivenMonths} month`,
    };
  }
  const d = facts.deposit;
  return {
    deposit_held: `${d.depositHeld} eur`,
    rent_arrears: `${d.rentArrears} eur`,
    claimed_amount: `${d.claimedAmount} eur`,
    claim_category: d.claimCategory,
    claim_evidenced: d.claimEvidenced,
  };
}

/* ----------------------------------------------------------------- reading */

const euro = (n: number | null) => formatEuro(n, 'an unknown amount');

function toLine(spec: MomentLineSpec, result: LemmaRuleResult | undefined): MomentLine {
  return {
    rule: spec.rule,
    label: spec.label,
    kind: spec.kind,
    display: result?.display ?? null,
    value: result && !result.vetoed ? (result.numericEur ?? null) : null,
    passed: result && !result.vetoed && result.boolean !== undefined ? result.boolean : null,
    vetoed: result?.vetoed ?? false,
    vetoReason: result?.vetoReason,
    missingData: result?.missingData,
  };
}

/** A euro value straight off the engine, or null when the rule had none. */
const amount = (e: LemmaEvaluation, rule: string): number | null => {
  const r = e.results[rule];
  return r && !r.vetoed ? (r.numericEur ?? null) : null;
};

const failed = (e: LemmaEvaluation, rule: string) => e.results[rule]?.boolean === false;

/** The reason a dependency gave, when the headline rule vetoed without one. */
function firstVetoReason(evaluation: LemmaEvaluation): string | undefined {
  return Object.values(evaluation.results).find((r) => r.vetoed && r.vetoReason)?.vetoReason;
}

/**
 * Plain language, assembled only from values the engine returned. Nothing here
 * recomputes anything — if a sentence needs a number, it reads it off the run.
 */
function summariseMoment(
  definition: MomentDefinition,
  evaluation: LemmaEvaluation,
  facts: JourneyFacts,
): string {
  const moment = definition.id as RunnableMomentId;

  // Only the headline rule decides whether this moment has an answer. A veto
  // deeper in the tree may never reach it: with no evidence nothing is
  // chargeable whatever the claim category, so an unpriced category vetoes a
  // rule the outcome never consults. Reporting that as "no answer" would turn
  // a real refusal into a shrug.
  const decision = evaluation.results[definition.decisionRule];
  if (decision?.vetoed) {
    const reason = decision.vetoReason ?? firstVetoReason(evaluation) ?? 'the policy has no rule for this case';
    return `No answer is available: ${reason}. The policy does not guess.`;
  }

  if (moment === 'contract') {
    const cost = amount(evaluation, 'contract_monthly_cost');
    const extra = amount(evaluation, 'undisclosed_monthly_cost');
    const head =
      extra && extra > 0
        ? `The contract costs ${euro(cost)} a month, ${euro(extra)} more than the listing advertised.`
        : `The contract costs ${euro(cost)} a month, which is what the listing advertised.`;
    const problems: string[] = [];
    if (failed(evaluation, 'monthly_cost_as_advertised')) problems.push('the monthly cost is above the advertised rent');
    if (failed(evaluation, 'deposit_as_advertised')) problems.push('the deposit is above the advertised one');
    if (failed(evaluation, 'deposit_within_cap'))
      problems.push(`the deposit is above the ${euro(amount(evaluation, 'maximum_deposit'))} cap`);
    if (failed(evaluation, 'notice_period_acceptable'))
      problems.push(
        `the notice period of ${facts.contract.contractNoticePeriodMonths} months is longer than the policy allows`,
      );
    return problems.length
      ? `${head} It may not be signed as offered: ${problems.join('; ')}.`
      : `${head} It may be signed as offered.`;
  }

  if (moment === 'renewal') {
    const cap = evaluation.results.maximum_increase?.display ?? 'an unknown cap';
    const max = amount(evaluation, 'maximum_renewal_rent');
    const head =
      `At ${euro(facts.renewal.currentMonthlyRent)} now on a ${facts.renewal.contractType} contract, the increase is` +
      ` capped at ${cap}, so the most that may be asked is ${euro(max)}.`;
    const problems: string[] = [];
    if (failed(evaluation, 'offer_within_cap'))
      problems.push(`the offer of ${euro(facts.renewal.proposedMonthlyRent)} is above that`);
    if (failed(evaluation, 'notice_is_timely'))
      problems.push(`${facts.renewal.noticeGivenMonths} months is not enough notice`);
    return problems.length
      ? `${head} The offer may not be made: ${problems.join('; and ')}.`
      : `${head} The offer of ${euro(facts.renewal.proposedMonthlyRent)} may be made.`;
  }

  const claimed = amount(evaluation, 'total_claimed');
  const payable = amount(evaluation, 'deduction_payable');
  const refund = amount(evaluation, 'refund_to_tenant');
  const chargeable = amount(evaluation, 'chargeable_claim');
  const evidenced = amount(evaluation, 'evidenced_claim');

  let why = '';
  if (chargeable === 0 && facts.deposit.claimedAmount > 0) {
    why = ' Normal wear is not chargeable under this policy.';
  } else if (evidenced === 0 && (chargeable ?? 0) > 0) {
    why = ' Nothing is chargeable without evidence from both the move-in and the move-out record.';
  }
  return (
    `The landlord claims ${euro(claimed)}.${why} ${euro(payable)} may be withheld and ${euro(refund)}` +
    ` goes back to the tenant.`
  );
}

/* -------------------------------------------------------------- evaluation */

/**
 * Run one moment against a snapshot. Throws `LemmaEngineError` rather than
 * returning a partial result — a failed run must be visible, never a zero.
 */
export function evaluateMoment(args: {
  moment: RunnableMomentId;
  snapshot: PolicySnapshot;
  facts: JourneyFacts;
  /** ISO date to evaluate at. Undefined means now. */
  effective?: string;
}): MomentOutcome {
  const definition = momentById(args.moment)!;
  const inputs = momentInput(args.moment, args.facts);
  const evaluation = runSpec(args.snapshot.files, inputs, {
    spec: definition.spec,
    effective: args.effective,
    explain: true,
  });

  const decision = evaluation.results[definition.decisionRule];
  return {
    evaluationId: randomUUID(),
    moment: args.moment,
    spec: definition.spec,
    decision: {
      rule: definition.decisionRule,
      label: definition.decisionLabel,
      passed: decision && !decision.vetoed && decision.boolean !== undefined ? decision.boolean : null,
      vetoed: decision?.vetoed ?? false,
      vetoReason: decision?.vetoReason,
    },
    lines: definition.lines.map((l) => toLine(l, evaluation.results[l.rule])),
    summary: summariseMoment(definition, evaluation, args.facts),
    inputs,
    raw: evaluation.raw,
    explanation: decision?.explanation,
    snapshotId: args.snapshot.id,
    sourceHash: args.snapshot.sourceHash,
    evaluatedAt: new Date().toISOString(),
    effective: evaluation.effective,
    specEffectiveFrom: evaluation.specEffectiveFrom,
    factsRevision: args.facts.revision,
  };
}
