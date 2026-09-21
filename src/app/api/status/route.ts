import { NextResponse } from 'next/server';
import { getStatus } from '@/lib/harness/status';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(await getStatus());
}
