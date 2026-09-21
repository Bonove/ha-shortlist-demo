import type { PolicySourceFile } from '@/lib/contracts';
import { diffBundles } from '@/lib/policy/diff';
import { draftAsSnapshot, getDraft } from '@/lib/policy/drafts';
import { getSnapshot } from '@/lib/policy/snapshots';
import { BadRequest, errorResponse } from '@/lib/policy/http';

export const runtime = 'nodejs';

/** `from`/`to` are snapshot ids, or `draft:<id>` for a saved draft. */
function resolve(ref: string): PolicySourceFile[] {
  if (ref.startsWith('draft:')) return draftAsSnapshot(getDraft(ref.slice('draft:'.length))).files;
  return getSnapshot(ref).files;
}

export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const from = params.get('from');
    const to = params.get('to');
    if (!from || !to) throw new BadRequest('"from" and "to" query parameters are required.');
    return Response.json({ lines: diffBundles(resolve(from), resolve(to)) });
  } catch (error) {
    return errorResponse(error);
  }
}
