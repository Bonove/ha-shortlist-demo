import { exportBundle } from '@/lib/policy/bundle';
import { getSnapshot } from '@/lib/policy/snapshots';
import { BadRequest, errorResponse } from '@/lib/policy/http';

export const runtime = 'nodejs';

export function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('snapshotId');
    if (!id) throw new BadRequest('"snapshotId" query parameter is required.');
    const bundle = exportBundle(getSnapshot(id));
    return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="policy-${bundle.snapshot.id}.json"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
