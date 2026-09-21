import { getSnapshot } from '@/lib/policy/snapshots';
import { errorResponse } from '@/lib/policy/http';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(getSnapshot(decodeURIComponent(id)));
  } catch (error) {
    return errorResponse(error);
  }
}
