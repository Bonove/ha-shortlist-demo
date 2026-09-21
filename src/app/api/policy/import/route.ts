import { importBundle } from '@/lib/policy/bundle';
import { BadRequest, errorResponse, readJson } from '@/lib/policy/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body.bundle) throw new BadRequest('"bundle" is required.');
    // importBundle writes nothing unless every check passes, so a rejected
    // bundle leaves the active snapshot exactly as it was.
    return Response.json({ snapshot: importBundle(body.bundle) });
  } catch (error) {
    return errorResponse(error);
  }
}
