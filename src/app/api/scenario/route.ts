import { NextResponse } from 'next/server';
import type { Listing, TenantProfile } from '@/lib/contracts';
import { currentSession, evaluateListings } from '@/lib/harness/evaluate';
import { appendEvent } from '@/lib/harness/events';
import { transact } from '@/lib/store/db';

export const runtime = 'nodejs';

/**
 * Applies only keys the seed object already has, of the type it already has.
 * `revision` and `reference` are ours to manage, never the caller's.
 * requestedDepositMonths is the one key that may be cleared to null, which is
 * the "advertiser has not stated a deposit" demonstration.
 */
function patched<T extends object>(base: T, patch: Record<string, unknown>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === 'revision' || key === 'reference' || !(key in base)) continue;
    if (key === 'requestedDepositMonths') {
      if (typeof value === 'number' || value === null) out[key] = value;
    } else if (typeof value === typeof (base as Record<string, unknown>)[key]) {
      out[key] = value;
    }
  }
  return out as T;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const tenantPatch: Partial<TenantProfile> | undefined = body?.tenant;
  const listingPatch: { reference: string; patch: Partial<Listing> } | undefined = body?.listing;
  // A presentation control, not a tenant requirement: it moves the clock the
  // policy is read at, and one published bundle can answer differently on
  // either side of a dated version boundary.
  const hasDate = body !== null && typeof body === 'object' && 'evaluationDate' in body;
  const rawDate: unknown = body?.evaluationDate;
  if (hasDate && rawDate !== null && !(typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate))) {
    return NextResponse.json({ error: '"evaluationDate" must be YYYY-MM-DD, or null for now.' }, { status: 400 });
  }

  const changed = await transact((doc) => {
    const notes: string[] = [];
    if (tenantPatch) {
      doc.session.tenant = { ...patched(doc.session.tenant, tenantPatch), revision: doc.session.tenant.revision + 1 };
      notes.push(`tenant profile (revision ${doc.session.tenant.revision})`);
      appendEvent(doc.session, 'profile.changed', 'Tenant profile changed', { patch: tenantPatch });
    }
    if (listingPatch?.reference) {
      const i = doc.session.listings.findIndex((l) => l.reference === listingPatch.reference);
      if (i >= 0) {
        const before = doc.session.listings[i];
        doc.session.listings[i] = { ...patched(before, listingPatch.patch), revision: before.revision + 1 };
        notes.push(`listing ${before.reference} (revision ${before.revision + 1})`);
        appendEvent(doc.session, 'scenario.changed', `Listing ${before.reference} changed`, {
          patch: listingPatch.patch,
        });
      }
    }
    if (hasDate) {
      doc.session.evaluationDate = (rawDate as string | null) ?? null;
      notes.push(doc.session.evaluationDate ? `evaluation date ${doc.session.evaluationDate}` : 'evaluation date reset to now');
      appendEvent(doc.session, 'scenario.changed', `Evaluating as of ${doc.session.evaluationDate ?? 'now'}`, {
        evaluationDate: doc.session.evaluationDate,
      });
    }
    // Every stored assessment is now stale: drop them rather than show old money.
    if (notes.length) doc.session.assessments = {};
    return notes;
  });

  const assessments = changed.length ? await evaluateListings() : [];
  return NextResponse.json({ session: await currentSession(), assessments });
}
