import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/harness/evaluate';
import { getStatus } from '@/lib/harness/status';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ session: await currentSession(), status: await getStatus() });
}
