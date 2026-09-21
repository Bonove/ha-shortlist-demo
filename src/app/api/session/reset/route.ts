import { NextResponse } from 'next/server';
import { resetDoc } from '@/lib/store/db';
import { currentSession } from '@/lib/harness/evaluate';

export const runtime = 'nodejs';

export async function POST() {
  await resetDoc();
  return NextResponse.json({ session: await currentSession() });
}
