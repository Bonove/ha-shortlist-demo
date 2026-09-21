import { deleteDraft, listDrafts, saveDraft } from '@/lib/policy/drafts';
import { getSnapshot } from '@/lib/policy/snapshots';
import { BadRequest, errorResponse, readFiles, readJson, readString } from '@/lib/policy/http';

export const runtime = 'nodejs';

export function GET() {
  try {
    return Response.json(listDrafts());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const basedOn = readString(body, 'basedOn');
    getSnapshot(basedOn); // a draft must branch from a snapshot that exists
    const id = body.id === undefined ? undefined : readString(body, 'id');
    return Response.json(saveDraft({ id, name: readString(body, 'name'), basedOn, files: readFiles(body) }));
  } catch (error) {
    return errorResponse(error);
  }
}

export function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new BadRequest('"id" query parameter is required.');
    deleteDraft(id);
    return Response.json({ deleted: id });
  } catch (error) {
    return errorResponse(error);
  }
}
