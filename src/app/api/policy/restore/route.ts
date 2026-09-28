import { restore } from '@/lib/policy/snapshots';
import { BadRequest, errorResponse, readJson, readString } from '@/lib/policy/http';
import { evaluateListings } from '@/lib/harness/evaluate';
import { markMessagesOutdated } from '@/lib/ai/chat';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const target = readString(await readJson(request), 'target');
    if (target !== 'previous' && target !== 'S0') throw new BadRequest('"target" must be "previous" or "S0".');
    const pointer = restore(target);
    // Same as activation: the figures on screen must follow the policy.
    await evaluateListings();
    await markMessagesOutdated(pointer.activeId);
    return Response.json(pointer);
  } catch (error) {
    return errorResponse(error);
  }
}
