import { NextResponse } from 'next/server';
import { evaluateListings } from '@/lib/harness/evaluate';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const references: string[] | undefined = body?.listingReferences;
  return NextResponse.json({ assessments: await evaluateListings(references) });
}
