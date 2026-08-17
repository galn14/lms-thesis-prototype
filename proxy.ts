import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PUBLIC_STATIC_FILES = new Set([
  '/favicon.ico',
  '/file.svg',
  '/globe.svg',
  '/next.svg',
  '/st_louis-2.png',
  '/vercel.svg',
  '/window.svg',
]);

const PUBLIC_STATIC_PREFIXES = ['/_next/', '/images/', '/icons/', '/prototype-assets/'];

function isPublicStaticPath(pathname: string) {
  return (
    PUBLIC_STATIC_FILES.has(pathname) ||
    PUBLIC_STATIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
  );
}

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/api/cron/reset') {
    return NextResponse.next();
  }

  if (
    pathname === '/api/auth' ||
    pathname.startsWith('/api/auth/') ||
    isPublicStaticPath(pathname)
  ) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const publicRoutes = ['/login', '/auth'];
  const isPublicRoute = publicRoutes.some(route => matchesRoute(pathname, route));

  if (token) {
    const now = Date.now() / 1000;

    if (token.exp && (token.exp as number) < now) {
      console.warn('[Proxy] Token expired. Clearing session.');

      const response = NextResponse.redirect(new URL('/login', request.url));

      response.cookies.delete('next-auth.session-token');
      response.cookies.delete('__Secure-next-auth.session-token');
      response.cookies.delete('next-auth.csrf-token');
      response.cookies.delete('__Secure-next-auth.csrf-token');

      return response;
    }

    if (isPublicRoute) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    return NextResponse.next();
  }

  if (!isPublicRoute) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/:path*'],
};
