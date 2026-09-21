import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { DemoApplication } from '@/lib/contracts';
import { evaluateListings } from '@/lib/harness/evaluate';
import { appendEvent } from '@/lib/harness/events';
import { transact } from '@/lib/store/db';

export const runtime = 'nodejs';

/**
 * Creates a local demonstration record. Nothing is booked, nothing is paid and
 * no message leaves this machine.
 *
 * The client's opinion of the assessment is never trusted: the listing is
 * re-evaluated here, against current data and the active snapshot, and a result
 * that does not fit is refused.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const reference: string | undefined = body?.listingReference;
  if (!reference) return NextResponse.json({ error: 'listingReference is required' }, { status: 400 });

  const [assessment] = await evaluateListings([reference]);
  if (!assessment) return NextResponse.json({ error: `Unknown listing ${reference}` }, { status: 404 });

  if (assessment.status !== 'fits') {
    await transact((doc) =>
      appendEvent(doc.session, 'error', `Application for ${reference} refused: ${assessment.status}`, {
        evaluationId: assessment.evaluationId,
      }),
    );
    return NextResponse.json(
      { error: `This home does not fit under the active policy (${assessment.status}).`, assessment },
      { status: 409 },
    );
  }

  const application: DemoApplication = {
    id: randomUUID(),
    listingReference: reference,
    createdAt: new Date().toISOString(),
    evaluationId: assessment.evaluationId,
    snapshotId: assessment.snapshotId,
    sourceHash: assessment.sourceHash,
  };
  await transact((doc) => {
    doc.session.applications.unshift(application);
    appendEvent(doc.session, 'application.created', `Demonstration application recorded for ${reference}`, {
      applicationId: application.id,
      evaluationId: assessment.evaluationId,
    });
  });
  return NextResponse.json({ application });
}
