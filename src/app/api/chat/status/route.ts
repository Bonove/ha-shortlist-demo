import { MODEL, getLastError, isConfigured } from '@/lib/ai/chat';

export const runtime = 'nodejs';

export async function GET() {
  // configured reflects only the presence of the key; the value never leaves here.
  const configured = isConfigured();
  return Response.json({ configured, model: configured ? MODEL : null, lastError: getLastError() });
}
