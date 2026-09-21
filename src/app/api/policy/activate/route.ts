import { activate } from '@/lib/policy/snapshots';
import { errorResponse, readJson, readString } from '@/lib/policy/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    return Response.json(activate(readString(body, 'snapshotId')));
  } catch (error) {
    return errorResponse(error);
  }
}
