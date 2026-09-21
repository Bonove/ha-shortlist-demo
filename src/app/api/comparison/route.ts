import { NextResponse } from 'next/server';
import { compareSnapshots, getComparisonScenario, refreezeScenario } from '@/lib/harness/comparison';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  // Inspecting the comparison never activates anything; it only reads snapshots.
  const scenario = body?.refreeze ? await refreezeScenario() : await getComparisonScenario();
  return NextResponse.json({ scenario, steps: await compareSnapshots() });
}
