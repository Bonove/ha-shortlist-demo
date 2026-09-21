import { restore } from '@/lib/policy/snapshots';
import { BadRequest, errorResponse, readJson, readString } from '@/lib/policy/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const target = readString(await readJson(request), 'target');
    if (target !== 'previous' && target !== 'S0') throw new BadRequest('"target" must be "previous" or "S0".');
    return Response.json(restore(target));
  } catch (error) {
    return errorResponse(error);
  }
}
