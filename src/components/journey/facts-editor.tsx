'use client';

import { useEffect, useState } from 'react';
import type { ClaimCategory, ContractType, JourneyFacts } from '@/lib/contracts';
import { seedJourney } from '@/lib/domain/journey';
import type { RunnableMomentId } from '@/lib/journey/moments';
import '@/components/tenant/tenant.css';

/**
 * Held as strings so a half-typed number is still a legal state. The keys are
 * the contract field names, because they are what goes back to the server.
 */
type Draft = {
  contractServiceCharge: string;
  contractNoticePeriodMonths: string;
  contractDeposit: string;
  proposedMonthlyRent: string;
  contractType: ContractType;
  noticeGivenMonths: string;
  claimedAmount: string;
  claimCategory: ClaimCategory;
  claimEvidenced: boolean;
  rentArrears: string;
};

/** The free-text keys only — the selects are string unions and are handled apart. */
type NumericField = {
  [K in keyof Draft]: string extends Draft[K] ? K : never;
}[keyof Draft];

type Spec = {
  label: string;
  hint: string;
  min: number;
  max: number;
  /** Months are counted, not measured, so they take no decimals. */
  integer?: boolean;
  error: string;
};

const SPECS: Record<NumericField, Spec> = {
  contractServiceCharge: {
    label: 'Service charge the contract adds (€)',
    hint: 'Set it to 0 and the monthly cost matches the advert, so the contract becomes signable on that count.',
    min: 0,
    max: 2000,
    error: 'Service charge must be between €0 and €2,000.',
  },
  contractNoticePeriodMonths: {
    label: 'Notice period (months)',
    hint: 'The policy allows 1 month. At 2 the notice check fails on its own.',
    min: 0,
    max: 36,
    integer: true,
    error: 'Notice period must be a whole number of months between 0 and 36.',
  },
  contractDeposit: {
    label: 'Contract deposit (€)',
    hint: 'Checked twice: against the advertised deposit and against the policy cap.',
    min: 0,
    max: 50000,
    error: 'Contract deposit must be between €0 and €50,000.',
  },
  proposedMonthlyRent: {
    label: 'Proposed monthly rent (€)',
    hint: 'The cap is around €1,145 on a liberalised contract. Below it the offer is permitted.',
    min: 0,
    max: 10000,
    error: 'Proposed rent must be between €0 and €10,000.',
  },
  noticeGivenMonths: {
    label: 'Notice given (months)',
    hint: 'The policy wants at least 2. Below that the offer fails on timing alone.',
    min: 0,
    max: 36,
    integer: true,
    error: 'Notice given must be a whole number of months between 0 and 36.',
  },
  claimedAmount: {
    label: 'Amount claimed (€)',
    hint: 'What the landlord asks for. It is never the deduction until the policy has been through it.',
    min: 0,
    max: 20000,
    error: 'Amount claimed must be between €0 and €20,000.',
  },
  rentArrears: {
    label: 'Rent arrears (€)',
    hint: 'Arrears are withheld separately from the claim, so this moves the refund without touching the claim.',
    min: 0,
    max: 20000,
    error: 'Rent arrears must be between €0 and €20,000.',
  },
};

/** Which fields each moment exposes — and therefore validates and sends. */
const FIELDS: Record<RunnableMomentId, NumericField[]> = {
  contract: ['contractServiceCharge', 'contractNoticePeriodMonths', 'contractDeposit'],
  renewal: ['proposedMonthlyRent', 'noticeGivenMonths'],
  deposit: ['claimedAmount', 'rentArrears'],
};

const CONTRACT_TYPES: { value: ContractType; label: string }[] = [
  { value: 'regulated', label: 'Regulated (social sector)' },
  { value: 'liberalised', label: 'Liberalised (free sector)' },
  { value: 'student_housing', label: 'Student housing' },
];

const CLAIM_CATEGORIES: { value: ClaimCategory; label: string }[] = [
  { value: 'none', label: 'No claim' },
  { value: 'normal_wear', label: 'Normal wear and tear' },
  { value: 'accidental_damage', label: 'Accidental damage' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'missing_item', label: 'Missing item' },
  { value: 'redecoration', label: 'Redecoration' },
];

function toDraft(facts: JourneyFacts): Draft {
  return {
    contractServiceCharge: String(facts.contract.contractServiceCharge),
    contractNoticePeriodMonths: String(facts.contract.contractNoticePeriodMonths),
    contractDeposit: String(facts.contract.contractDeposit),
    proposedMonthlyRent: String(facts.renewal.proposedMonthlyRent),
    contractType: facts.renewal.contractType,
    noticeGivenMonths: String(facts.renewal.noticeGivenMonths),
    claimedAmount: String(facts.deposit.claimedAmount),
    claimCategory: facts.deposit.claimCategory,
    claimEvidenced: facts.deposit.claimEvidenced,
    rentArrears: String(facts.deposit.rentArrears),
  };
}

function validate(moment: RunnableMomentId, draft: Draft): Partial<Record<NumericField, string>> {
  const errors: Partial<Record<NumericField, string>> = {};
  for (const key of FIELDS[moment]) {
    const spec = SPECS[key];
    const n = Number(draft[key]);
    const bad =
      !draft[key].trim() ||
      !Number.isFinite(n) ||
      n < spec.min ||
      n > spec.max ||
      (spec.integer === true && !Number.isInteger(n));
    if (bad) errors[key] = spec.error;
  }
  return errors;
}

/** Only the fields this moment's controls own, so a save never disturbs another moment. */
function payload(moment: RunnableMomentId, draft: Draft): Record<string, string | number | boolean> {
  const numbers = Object.fromEntries(FIELDS[moment].map((k) => [k, Number(draft[k])]));
  if (moment === 'contract') return numbers;
  if (moment === 'renewal') return { ...numbers, contractType: draft.contractType };
  return { ...numbers, claimCategory: draft.claimCategory, claimEvidenced: draft.claimEvidenced };
}

/** The server owns the range rules; its wording is the one worth showing. */
async function errorFrom(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body !== null && typeof body === 'object') {
      const { error, message } = body as { error?: unknown; message?: unknown };
      if (typeof error === 'string') return error;
      if (typeof message === 'string') return message;
    }
  } catch {
    /* a response without a JSON body still has its status to report */
  }
  return `POST /api/journey returned ${res.status}`;
}

/**
 * The presenter's hand on one fact at a time.
 *
 * Nothing here decides anything. Each control changes one input the spec
 * already reads, and the answer that comes back is the engine's — which is
 * only worth watching if the change is deliberate, so edits are held locally
 * until they are saved rather than firing on every keystroke.
 */
export function FactsEditor({
  moment,
  facts,
  onChanged,
}: {
  moment: RunnableMomentId;
  facts: JourneyFacts;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(facts));
  const [saved, setSaved] = useState<Draft>(() => toDraft(facts));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Facts can move underneath us — another moment's save bumps the revision
  // for everyone — so the confirmed values win over an untouched draft.
  useEffect(() => {
    const next = toDraft(facts);
    setDraft(next);
    setSaved(next);
  }, [facts]);

  const errors = validate(moment, draft);
  const invalid = Object.keys(errors).length > 0;
  const dirty = FIELDS[moment].some((k) => draft[k] !== saved[k]) || changedChoices(moment, draft, saved);

  async function post(next: Draft) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/journey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moment, facts: payload(moment, next) }),
      });
      if (!res.ok) throw new Error(await errorFrom(res));
      setSaved(next);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    const next = toDraft(seedJourney());
    setDraft(next);
    void post(next);
  }

  function num(key: NumericField) {
    const spec = SPECS[key];
    return (
      <div className="field">
        <label htmlFor={`facts-${key}`}>{spec.label}</label>
        <input
          id={`facts-${key}`}
          className="input"
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.integer === true ? 1 : 'any'}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          aria-invalid={Boolean(errors[key])}
          disabled={busy}
        />
        {errors[key] ? (
          <span className="notice notice-error">{errors[key]}</span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            {spec.hint}
          </span>
        )}
      </div>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>Change one fact</h3>
        <span className="pill pill-neutral">revision {facts.revision}</span>
        <div className="spacer" />
        <div className="row">
          <button className="btn btn-sm btn-ghost" onClick={reset} disabled={busy}>
            Reset to the starting facts
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => void post(draft)} disabled={busy || invalid || !dirty}>
            {busy ? <span className="spin" /> : null}
            {busy ? 'Re-running the policy…' : 'Save and re-run'}
          </button>
        </div>
      </div>

      <div className="card-pad col" style={{ gap: 16 }}>
        {moment === 'contract' && (
          <div className="grid-3">
            {num('contractServiceCharge')}
            {num('contractNoticePeriodMonths')}
            {num('contractDeposit')}
          </div>
        )}

        {moment === 'renewal' && (
          <div className="grid-3">
            {num('proposedMonthlyRent')}
            <div className="field">
              <label htmlFor="facts-contractType">Contract type</label>
              <select
                id="facts-contractType"
                className="select"
                value={draft.contractType}
                onChange={(e) => setDraft({ ...draft, contractType: e.target.value as ContractType })}
                disabled={busy}
              >
                {CONTRACT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                The policy sets no cap for student housing, so the engine declines to answer rather than guess.
              </span>
            </div>
            {num('noticeGivenMonths')}
          </div>
        )}

        {moment === 'deposit' && (
          <>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="facts-claimCategory">Claim category</label>
                <select
                  id="facts-claimCategory"
                  className="select"
                  value={draft.claimCategory}
                  onChange={(e) => setDraft({ ...draft, claimCategory: e.target.value as ClaimCategory })}
                  disabled={busy}
                >
                  {CLAIM_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="muted" style={{ fontSize: 12 }}>
                  Normal wear is not chargeable; redecoration is not priced in the policy at all, so the engine returns
                  no answer rather than a number.
                </span>
              </div>
              {num('claimedAmount')}
              {num('rentArrears')}
            </div>
            <div className="field">
              <label className="row" style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--foreground)' }}>
                <input
                  type="checkbox"
                  checked={draft.claimEvidenced}
                  onChange={(e) => setDraft({ ...draft, claimEvidenced: e.target.checked })}
                  disabled={busy}
                />
                Evidence on both sides (move-in and move-out record)
              </label>
              <span className="muted" style={{ fontSize: 12 }}>
                Tick it and the deduction goes from nothing to the full chargeable claim.
              </span>
            </div>
          </>
        )}

        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Saving sends only this moment&rsquo;s facts and re-runs the published spec against them. Nothing on this page
          computes an outcome.
        </p>

        {error && <div className="notice notice-error">Could not save: {error}</div>}
      </div>
    </section>
  );
}

/** The selects and the checkbox are not numeric fields, so dirtiness asks about them separately. */
function changedChoices(moment: RunnableMomentId, draft: Draft, saved: Draft): boolean {
  if (moment === 'renewal') return draft.contractType !== saved.contractType;
  if (moment === 'deposit')
    return draft.claimCategory !== saved.claimCategory || draft.claimEvidenced !== saved.claimEvidenced;
  return false;
}
