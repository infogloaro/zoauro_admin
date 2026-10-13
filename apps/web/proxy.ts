import { NextResponse, type NextRequest } from 'next/server';

// Passes the request path to the protected layouts (a layout is not given the URL) so a signed-out visitor can be sent
// to /login?next=<path>. Upstream only (request headers, never response headers). Authorization is NOT done here: the
// layouts check the session on the server and the API checks every request (proxy coverage can silently change).

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-zo-path', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/', '/super-admin/:path*', '/zone/:path*', '/account/:path*', '/coming-soon/:path*'],
};
