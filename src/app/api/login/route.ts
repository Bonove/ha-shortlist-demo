import { NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken, secretsMatch } from '@/lib/gate';

export const runtime = 'nodejs';

/**
 * A relative Location, which RFC 7231 allows and every browser resolves
 * against the address bar.
 *
 * Behind a reverse proxy `request.url` is the internal origin the proxy dialled
 * — on Render that is http://localhost:10000 — so building an absolute URL from
 * it sends the browser somewhere that does not exist. Staying relative means
 * there is no host to get wrong.
 */
const redirectTo = (location: string) =>
  new NextResponse(null, { status: 303, headers: { location } });

/**
 * A slow, per-address throttle on guesses.
 *
 * The source is public and the gate is one shared password, so the only thing
 * standing between a scanner and the OpenAI bill is how fast it can try. Ten
 * attempts per address per ten minutes turns a feasible brute force into an
 * infeasible one without a dependency or a store.
 *
 * ponytail: in-memory, so it resets on deploy and is per-instance. Good enough
 * for one small instance; move it to a shared store if this ever scales out.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(address: string): boolean {
  const now = Date.now();
  const seen = attempts.get(address);
  if (!seen || now > seen.resetAt) {
    attempts.set(address, { count: 1, resetAt: now + WINDOW_MS });
    if (attempts.size > 5000) attempts.clear(); // crude bound; misses cost nothing
    return false;
  }
  seen.count += 1;
  return seen.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.json({ error: 'No password is configured.' }, { status: 503 });

  // Render terminates TLS upstream, so the client address arrives in a header.
  const address = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  if (tooManyAttempts(address)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const form = await request.formData();
  const given = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/');

  if (!secretsMatch(given, password)) {
    // The message is deliberately vague about which half was wrong.
    return redirectTo(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  // Only ever redirect within this app, never to a URL an attacker supplied.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const response = redirectTo(target);
  response.cookies.set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
