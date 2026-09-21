'use client';

import { useState } from 'react';
import type { SessionState, TenantProfile } from '@/lib/contracts';
import { money, months } from './listing-card';
import './tenant.css';

type Draft = {
  intendedStayMonths: string;
  maxMonthlyRent: string;
  maxInitialPayment: string;
  prefersShortCommute: boolean;
};

const LIMITS: Record<keyof Omit<Draft, 'prefersShortCommute'>, { min: number; max: number; label: string }> = {
  intendedStayMonths: { min: 1, max: 36, label: 'Stay must be a whole number of months between 1 and 36.' },
  maxMonthlyRent: { min: 100, max: 10000, label: 'Maximum monthly rent must be between €100 and €10,000.' },
  maxInitialPayment: { min: 100, max: 50000, label: 'Maximum initial payment must be between €100 and €50,000.' },
};

function validate(draft: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const n = Number(draft[key]);
    const { min, max, label } = LIMITS[key];
    if (!draft[key].trim() || !Number.isInteger(n) || n < min || n > max) errors[key] = label;
  }
  return errors;
}

/**
 * Alex's confirmed requirements. These are a statement of what the tenant
 * wants, not an assessment of the tenant — every change re-runs the policy
 * through the harness rather than being applied here.
 */
export function RequirementsCard({
  tenant,
  onSaved,
}: {
  tenant: TenantProfile;
  onSaved: (session: SessionState) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = draft ? validate(draft) : {};
  const invalid = Object.keys(errors).length > 0;

  function open() {
    setError(null);
    setDraft({
      intendedStayMonths: String(tenant.intendedStayMonths),
      maxMonthlyRent: String(tenant.maxMonthlyRent),
      maxInitialPayment: String(tenant.maxInitialPayment),
      prefersShortCommute: tenant.prefersShortCommute,
    });
  }

  async function save() {
    if (!draft || invalid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/scenario', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant: {
            intendedStayMonths: Number(draft.intendedStayMonths),
            maxMonthlyRent: Number(draft.maxMonthlyRent),
            maxInitialPayment: Number(draft.maxInitialPayment),
            prefersShortCommute: draft.prefersShortCommute,
          },
        }),
      });
      if (!res.ok) throw new Error(`POST /api/scenario returned ${res.status}`);
      const data = (await res.json()) as { session: SessionState };
      onSaved(data.session);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tenant.name}’s stated requirements</h2>
        <span className="pill pill-neutral">confirmed with the tenant</span>
        <div className="spacer" />
        {draft ? (
          <div className="row">
            <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy || invalid}>
              {busy ? <span className="spin" /> : null}
              {busy ? 'Re-running the policy…' : 'Save and re-evaluate'}
            </button>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={open}>
            Edit requirements
          </button>
        )}
      </div>

      <div className="card-pad col" style={{ gap: 14 }}>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          What {tenant.name} has told us they need in {tenant.city}. Every result below is measured against these
          stated requirements — they are never a judgement about {tenant.name}.
        </p>

        {draft ? (
          <>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="req-stay">Stay (months)</label>
                <input
                  id="req-stay"
                  className="input"
                  type="number"
                  min={1}
                  max={36}
                  value={draft.intendedStayMonths}
                  onChange={(e) => setDraft({ ...draft, intendedStayMonths: e.target.value })}
                  aria-invalid={Boolean(errors.intendedStayMonths)}
                />
                {errors.intendedStayMonths && <span className="notice notice-error">{errors.intendedStayMonths}</span>}
              </div>
              <div className="field">
                <label htmlFor="req-rent">Maximum monthly rent (€)</label>
                <input
                  id="req-rent"
                  className="input"
                  type="number"
                  min={100}
                  max={10000}
                  value={draft.maxMonthlyRent}
                  onChange={(e) => setDraft({ ...draft, maxMonthlyRent: e.target.value })}
                  aria-invalid={Boolean(errors.maxMonthlyRent)}
                />
                {errors.maxMonthlyRent && <span className="notice notice-error">{errors.maxMonthlyRent}</span>}
              </div>
              <div className="field">
                <label htmlFor="req-initial">Maximum initial payment (€)</label>
                <input
                  id="req-initial"
                  className="input"
                  type="number"
                  min={100}
                  max={50000}
                  value={draft.maxInitialPayment}
                  onChange={(e) => setDraft({ ...draft, maxInitialPayment: e.target.value })}
                  aria-invalid={Boolean(errors.maxInitialPayment)}
                />
                {errors.maxInitialPayment && <span className="notice notice-error">{errors.maxInitialPayment}</span>}
              </div>
            </div>
            <label className="row" style={{ fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={draft.prefersShortCommute}
                onChange={(e) => setDraft({ ...draft, prefersShortCommute: e.target.checked })}
              />
              Prefers a short commute to the university
            </label>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Initial payment is the first month’s rent plus the deposit plus the booking fee. Saving re-runs the
              active policy against every listing.
            </p>
          </>
        ) : (
          <div className="kv">
            <div>
              <span className="k">Stay</span>
              <span className="v">{months(tenant.intendedStayMonths)}</span>
            </div>
            <div>
              <span className="k">Maximum monthly rent</span>
              <span className="v">{money(tenant.maxMonthlyRent)}</span>
            </div>
            <div>
              <span className="k">Maximum initial payment</span>
              <span className="v">{money(tenant.maxInitialPayment)}</span>
            </div>
            <div>
              <span className="k">Commute</span>
              <span className="v">{tenant.prefersShortCommute ? 'Prefers a short commute' : 'No commute preference'}</span>
            </div>
          </div>
        )}

        {error && <div className="notice notice-error">Could not save: {error}</div>}
      </div>
    </section>
  );
}
