import { NextResponse } from 'next/server';
import { getActiveSnapshot } from '@/lib/policy/snapshots';
import { listingInput } from '@/lib/lemma/assess';
import { assessListing } from '@/lib/lemma/assess';
import { readDoc } from '@/lib/store/db';
import { evaluateLive, hasCredentials, readLivePolicy } from '@/lib/policy/lemmabase';

export const runtime = 'nodejs';

/** Is a live connection even possible, and what is the repository serving? */
export async function GET() {
  if (!hasCredentials()) {
    return NextResponse.json({ connected: false, reason: 'No LEMMABASE_API_KEY is configured on the server.' });
  }
  try {
    const live = await readLivePolicy();
    return NextResponse.json({ connected: true, ...live });
  } catch (error) {
    return NextResponse.json({ connected: false, reason: (error as Error).message });
  }
}

/**
 * Cross-check: run the frozen listings against the live published policy and
 * against the snapshot the harness is actually executing. Any difference is
 * drift — the repository has moved on and the runtime has deliberately not.
 */
export async function POST() {
  if (!hasCredentials()) {
    return NextResponse.json({ error: 'No LEMMABASE_API_KEY is configured on the server.' }, { status: 400 });
  }
  const snapshot = getActiveSnapshot();
  const { tenant, listings } = await readDoc((d) => ({
    tenant: d.session.tenant,
    listings: d.session.listings,
  }));

  try {
    const rows = await Promise.all(
      listings.map(async (listing) => {
        const local = assessListing({ snapshot, tenant, listing, explain: false });
        const live = await evaluateLive(listingInput(tenant, listing));
        const liveTotal = live.initialPayment ? Math.round(Number(live.initialPayment.split(' ')[0])) : null;
        return {
          reference: listing.reference,
          name: listing.name,
          local: { initialPayment: local.costs.initialPayment, fits: local.status === 'fits' },
          live: { initialPayment: liveTotal, fits: live.offerFits },
          differs: liveTotal !== local.costs.initialPayment || live.offerFits !== (local.status === 'fits'),
        };
      }),
    );
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      active: { id: snapshot.id, label: snapshot.label, sourceHash: snapshot.sourceHash },
      rows,
      drift: rows.some((r) => r.differs),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
