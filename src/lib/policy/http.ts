/** Request/response plumbing shared by the /api/policy routes. */

import type { PolicySourceFile, ValidationDiagnostic } from '@/lib/contracts';
import { LemmaEngineError } from '@/lib/lemma/engine';
import { BundleError } from '@/lib/policy/bundle';

export class BadRequest extends Error {}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('expected a JSON object');
    return body as Record<string, unknown>;
  } catch {
    throw new BadRequest('Request body must be a JSON object.');
  }
}

/** Validate a `files` field as a complete source bundle. */
export function readFiles(body: Record<string, unknown>): PolicySourceFile[] {
  const files = body.files;
  if (!Array.isArray(files) || files.length === 0) throw new BadRequest('"files" must be a non-empty array.');
  return files.map((f, i) => {
    const file = f as Partial<PolicySourceFile>;
    if (typeof file?.path !== 'string' || file.path.trim() === '') {
      throw new BadRequest(`files[${i}].path must be a non-empty string.`);
    }
    if (typeof file?.code !== 'string' || file.code.trim() === '') {
      throw new BadRequest(`files[${i}].code must be non-empty source text.`);
    }
    return { path: file.path, code: file.code };
  });
}

export function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') throw new BadRequest(`"${key}" must be a non-empty string.`);
  return value;
}

/** Map any thrown error onto a JSON response. 400 for bad input, 500 otherwise. */
export function errorResponse(error: unknown): Response {
  const diagnostics: ValidationDiagnostic[] | undefined =
    error instanceof BundleError || error instanceof LemmaEngineError ? error.diagnostics : undefined;
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  // 400 covers unknown ids too: Next replaces a 404 from a route handler with
  // its own HTML not-found page, which a JSON client cannot read.
  const status =
    error instanceof BadRequest || error instanceof BundleError || /^Unknown (snapshot|draft)/.test(message)
      ? 400
      : error instanceof LemmaEngineError
        ? 422
        : 500;
  if (status >= 500) console.error('[policy]', error);
  return Response.json({ error: message, diagnostics }, { status });
}
