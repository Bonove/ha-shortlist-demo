import { NextResponse } from 'next/server';
import type { MomentId } from '@/lib/contracts';
import { MOMENTS, isRunnableMoment } from '@/lib/journey/moments';
import { isMomentStale, readJourney, runAllMoments, runMoment, updateJourneyFacts } from '@/lib/harness/journey';
import { BadRequest, readJson, readString } from '@/lib/policy/http';

export const runtime = 'nodejs';

const known = MOMENTS.map((m) => m.id).join(', ');

export async function GET() {
  const { facts, outcomes } = await readJourney();
  const stale = {} as Record<MomentId, boolean>;
  for (const moment of MOMENTS) {
    const outcome = outcomes[moment.id];
    stale[moment.id] = outcome ? await isMomentStale(outcome) : false;
  }
  return NextResponse.json({ moments: MOMENTS, facts, outcomes, stale });
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const moment = readString(body, 'moment');

    if (moment === 'all') {
      const outcomes = await runAllMoments();
      return NextResponse.json({ facts: (await readJourney()).facts, outcomes });
    }
    if (!isRunnableMoment(moment)) {
      throw new BadRequest(`"${moment}" is not a runnable moment. Expected one of ${known}, or "all".`);
    }

    if (body.facts !== undefined) {
      if (!body.facts || typeof body.facts !== 'object' || Array.isArray(body.facts)) {
        throw new BadRequest('"facts" must be a JSON object.');
      }
      await updateJourneyFacts(moment, body.facts as Record<string, unknown>);
    }
    const outcome = body.run === false ? undefined : await runMoment(moment);
    const journey = await readJourney();
    return NextResponse.json({ facts: journey.facts, outcome: outcome ?? journey.outcomes[moment], stale: false });
  } catch (error) {
    // Everything that throws here is caused by the request: an unknown moment,
    // a malformed body, or a fact outside its range. 400 covers the unknown id
    // too, because Next replaces a 404 from a route handler with its own HTML
    // not-found page, which a JSON client cannot read.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected error.' },
      { status: 400 },
    );
  }
}
