import { NextResponse, type NextRequest } from 'next/server';
import { GATE_COOKIE, gateToken, secretsMatch } from '@/lib/gate';

/**
 * Everything is behind the shared password except the sign-in page itself.
 *
 * With no DEMO_PASSWORD set, local development runs open — but production
 * refuses to serve rather than falling open, because a missing variable is
 * exactly how a public deployment ends up unprotected.
 */
export async function middleware(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    return new NextResponse(
      'DEMO_PASSWORD is not set on this server, so the prototype will not serve. Set it and redeploy.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const path = request.nextUrl.pathname;
  if (path === '/login' || path === '/api/login') return NextResponse.next();

  const cookie = request.cookies.get(GATE_COOKIE)?.value;
  if (cookie && secretsMatch(cookie, await gateToken(password))) return NextResponse.next();

  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  // A rewrite, not a redirect. Behind a reverse proxy the request's own origin
  // is the internal one Render dialled (http://localhost:10000), so any
  // absolute redirect built from it sends the browser nowhere. A rewrite is
  // resolved server-side, so that origin never reaches the browser — and the
  // visitor keeps the address they asked for.
  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
  return NextResponse.rewrite(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
