import type { SnapshotEvaluation } from '@/lib/contracts';
import { SPEC_NAME } from '@/lib/contracts';
import { getComparisonScenario } from '@/lib/harness/comparison';
import { listingInput, toAssessment } from '@/lib/lemma/assess';
import { evaluateIsolated, loadIsolated } from '@/lib/lemma/engine';
import { hashBundle } from '@/lib/policy/hash';
import { errorResponse, readFiles, readJson } from '@/lib/policy/http';

export const runtime = 'nodejs';

/**
 * Evaluate a draft against the frozen comparison scenario. Everything happens
 * in a throwaway engine and nothing is activated, so previewing a draft cannot
 * change what the tenant side is running.
 */
export async function POST(request: Request) {
  try {
    const files = readFiles(await readJson(request));
    const { engine, validation } = loadIsolated(files);
    if (!validation.valid) return Response.json({ validation });

    const scenario = await getComparisonScenario();
    const identity = { id: 'draft', sourceHash: hashBundle(files) };
    const evaluation: SnapshotEvaluation = {
      snapshotId: identity.id,
      sourceHash: identity.sourceHash,
      inputsHash: scenario.inputsHash,
      assessments: scenario.listings.map((listing) =>
        toAssessment({
          evaluation: evaluateIsolated(engine, listingInput(scenario.tenant, listing), {
            spec: SPEC_NAME,
            explain: true,
          }),
          snapshot: identity,
          listing,
          tenant: scenario.tenant,
        }),
      ),
    };
    return Response.json({ validation, evaluation });
  } catch (error) {
    return errorResponse(error);
  }
}
