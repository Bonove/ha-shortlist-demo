import { loadIsolated } from '@/lib/lemma/engine';
import { errorResponse, readFiles, readJson } from '@/lib/policy/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const files = readFiles(await readJson(request));
    // Isolated: an invalid draft must not reach the cached active engine.
    const { validation } = loadIsolated(files);
    return Response.json(validation);
  } catch (error) {
    return errorResponse(error);
  }
}
