'use client';

import type { Assessment, Listing, TenantProfile } from '@/lib/contracts';
import { STATUS_META, displayStatus, money, months } from './listing-card';
import './tenant.css';

type Cell = { text: string | null; missing?: boolean };

/** Side-by-side read of the same rows for every home we looked at. */
export function ComparePanel({
  listings,
  assessments,
  tenant,
  onWhy,
}: {
  listings: Listing[];
  assessments: Record<string, Assessment>;
  tenant: TenantProfile;
  onWhy: (reference: string) => void;
}) {
  if (listings.length === 0) return null;

  const rows: { label: string; cell: (l: Listing, a: Assessment | undefined) => Cell }[] = [
    { label: 'Monthly rent', cell: (l) => ({ text: money(l.monthlyRent) }) },
    {
      label: 'Requested deposit',
      cell: (l) => ({
        text: l.requestedDepositMonths == null ? null : `${months(l.requestedDepositMonths)} of rent`,
        missing: l.requestedDepositMonths == null,
      }),
    },
    {
      label: 'Deposit after policy',
      cell: (_l, a) => ({ text: money(a?.costs.effectiveDeposit ?? null), missing: a?.costs.effectiveDeposit == null }),
    },
    { label: 'Booking fee', cell: (_l, a) => ({ text: money(a?.costs.bookingFee ?? null), missing: a?.costs.bookingFee == null }) },
    {
      label: 'Initial payment',
      cell: (_l, a) => ({ text: money(a?.costs.initialPayment ?? null), missing: a?.costs.initialPayment == null }),
    },
    { label: 'Listing minimum stay', cell: (l) => ({ text: months(l.minimumStayMonths) }) },
    {
      label: 'Minimum stay applied',
      cell: (_l, a) => ({
        text: months(a?.costs.effectiveMinimumStayMonths ?? null),
        missing: a?.costs.effectiveMinimumStayMonths == null,
      }),
    },
    { label: 'Travel to university', cell: (l) => ({ text: `${l.travelMinutesToUniversity} min` }) },
    {
      label: 'Available for the dates',
      cell: (l) => ({ text: l.availableForRequestedDates ? 'yes' : 'no' }),
    },
  ];

  return (
    <div className="card">
      <div className="card-head">
        <h3>Side by side</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Against {months(tenant.intendedStayMonths)}, max {money(tenant.maxMonthlyRent)} a month and max{' '}
          {money(tenant.maxInitialPayment)} up front
        </span>
      </div>
      <div className="compare-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 190 }}>&nbsp;</th>
              {listings.map((l) => (
                <th key={l.reference} className="col-head num">
                  {l.reference} · {l.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rowlabel">Fit</td>
              {listings.map((l) => {
                const meta = STATUS_META[displayStatus(assessments[l.reference])];
                return (
                  <td key={l.reference} className="num">
                    <span className={`pill ${meta.pill}`}>{meta.label}</span>
                  </td>
                );
              })}
            </tr>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="rowlabel">{r.label}</td>
                {listings.map((l) => {
                  const c = r.cell(l, assessments[l.reference]);
                  return (
                    <td
                      key={l.reference}
                      className="num"
                      style={c.text == null || c.missing ? { color: 'oklch(0.52 0.13 70)' } : undefined}
                    >
                      {c.text ?? 'not stated'}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="rowlabel">&nbsp;</td>
              {listings.map((l) => (
                <td key={l.reference} className="num">
                  <button className="btn btn-sm" onClick={() => onWhy(l.reference)} disabled={!assessments[l.reference]}>
                    Why this result?
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
