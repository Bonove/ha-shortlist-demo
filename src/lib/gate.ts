/**
 * A shared password in front of the whole prototype.
 *
 * This exists for one reason: a Render web service is public, and /api/chat
 * spends real OpenAI credit on every call. An open LLM endpoint on a guessable
 * subdomain is somebody else's bill.
 *
 * It is a demo gate, not an identity system: one password, one cookie, no
 * users. Web Crypto only, so the same code runs in the edge middleware and in
 * the Node route handler.
 */

export const GATE_COOKIE = 'ha_demo';

/** The cookie carries a derivation of the password, never the password. */
export async function gateToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`ha-shortlist-demo:${password}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant time, so a wrong cookie cannot be guessed a character at a time. */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
