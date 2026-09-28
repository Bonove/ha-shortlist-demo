import { NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken, secretsMatch } from '@/lib/gate';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.json({ error: 'No password is configured.' }, { status: 503 });

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
