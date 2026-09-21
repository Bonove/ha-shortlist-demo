import { listSnapshots, readState } from '@/lib/policy/snapshots';
import { errorResponse } from '@/lib/policy/http';

export const runtime = 'nodejs';

/** Bundle metadata without source text — the list view never needs the code. */
export function GET() {
  try {
    const { activeId, previousId } = readState();
    const snapshots = listSnapshots().map((s) => ({ ...s, files: s.files.map(({ path }) => ({ path })) }));
    return Response.json({ snapshots, activeId, previousId });
  } catch (error) {
    return errorResponse(error);
  }
}
