import { activate } from '@/lib/policy/snapshots';
import { errorResponse, readJson, readString } from '@/lib/policy/http';
import { evaluateListings } from '@/lib/harness/evaluate';
import { markMessagesOutdated } from '@/lib/ai/chat';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const pointer = activate(readString(body, 'snapshotId'));
    // Changing the active policy without re-running it leaves the tenant view
    // showing figures from the previous snapshot. Refresh them here so no
    // caller has to remember, and mark earlier answers as superseded.
    await evaluateListings();
    await markMessagesOutdated(pointer.activeId);
    return Response.json(pointer);
  } catch (error) {
    return errorResponse(error);
  }
}
