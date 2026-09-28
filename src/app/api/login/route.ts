import { NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken, secretsMatch } from '@/lib/gate';

export const runtime = 'nodejs';

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
    // Relative redirect back to the form; the message is deliberately vague.
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, request.url), 303);
  }

  // Only ever redirect within this app, never to a URL an attacker supplied.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const response = NextResponse.redirect(new URL(target, request.url), 303);
  response.cookies.set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
