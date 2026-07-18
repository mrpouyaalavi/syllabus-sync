import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { generateNonce, buildNonceCSP } from '@/lib/security/csp';
import { setCSRFCookie, shouldSkipCSRF, validateCSRF } from '@/lib/security/csrf';
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/supabase/fetch';
import { getSharedCookieOptions, withSharedCookieDomain } from '@/lib/supabase/cookie-options';

let lastTransientProxyAuthLogAt = 0;
const TRANSIENT_PROXY_LOG_INTERVAL_MS = 60_000;

function isTransientProxyAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    err.name === 'AbortError' ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('network')
  );
}

function shouldLogTransientProxyAuthError(): boolean {
  const now = Date.now();
  if (now - lastTransientProxyAuthLogAt < TRANSIENT_PROXY_LOG_INTERVAL_MS) {
    return false;
  }
  lastTransientProxyAuthLogAt = now;
  return true;
}

function isRefreshTokenMissingError(error: { message?: string; code?: string | null }): boolean {
  const message = (error.message || '').toLowerCase();
  const code = (error.code || '').toLowerCase();
  return (
    code === 'refresh_token_not_found' ||
    message.includes('refresh token not found') ||
    message.includes('invalid refresh token')
  );
}

function isPublicApiPath(path: string): boolean {
  return (
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/health') ||
    path.startsWith('/api/maps/') ||
    path.startsWith('/api/weather') ||
    path.startsWith('/api/cron/') ||
    path.startsWith('/api/security/rate-limit/cleanup') ||
    path.startsWith('/api/csp-report') ||
    path.startsWith('/api/webauthn/authenticate/')
  );
}

/**
 * Next.js 16 Proxy — security headers, session refresh, and route protection.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const staticFileExtensions = [
    '.webmanifest',
    '.json',
    '.ico',
    '.png',
    '.jpg',
    '.jpeg',
    '.svg',
    '.css',
    '.js',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.map',
    '.txt',
    '.xml',
  ];
  const isStaticFile = staticFileExtensions.some((ext) => path.endsWith(ext));

  if (isStaticFile) {
    return NextResponse.next();
  }

  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const protectedRoutes = ['/home', '/calendar', '/feed', '/map', '/settings', '/manage-profiles'];
  const authRoutes = ['/login', '/signup', '/reset-password'];
  const publicRoutes = ['/terms', '/privacy', '/verify', '/onboarding'];

  const isProtectedRoute = protectedRoutes.some((route) => path.startsWith(route));
  const isAuthRoute = authRoutes.some((route) => path.startsWith(route));
  const isRootPath = path === '/';
  const isApiRoute = path.startsWith('/api/');
  const isPublicApi = isPublicApiPath(path);
  const isResetPasswordRoute = path.startsWith('/reset-password');
  const isAuthCallbackRoute = path.startsWith('/auth/callback');
  const isAuthConfirmRoute = path.startsWith('/auth/confirm');

  const shouldResolveUser =
    !isRootPath &&
    !isResetPasswordRoute &&
    !isAuthCallbackRoute &&
    !isAuthConfirmRoute &&
    (isProtectedRoute || isAuthRoute || (isApiRoute && !isPublicApi));

  if (path === '/@vite/client') {
    return new NextResponse('', {
      status: 204,
      headers: {
        'Content-Type': 'application/javascript',
      },
    });
  }

  if (!shouldSkipCSRF(request)) {
    const csrfResult = validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    }
  }

  const cspHeader = buildNonceCSP(nonce);

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const setSecurityHeaders = (headers: Headers) => {
    headers.set('Content-Security-Policy', cspHeader);
    headers.set('x-nonce', nonce);
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
    );
  };

  setSecurityHeaders(response.headers);

  if (!isApiRoute && !request.cookies.get('__Host-csrf')?.value) {
    setCSRFCookie(response);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const hasValidUrl =
    supabaseUrl && supabaseUrl.includes('supabase.co') && !supabaseUrl.includes('your-project-id');
  const hasValidKey =
    supabaseAnonKey &&
    (supabaseAnonKey.startsWith('eyJ') || supabaseAnonKey.startsWith('sb_')) &&
    !supabaseAnonKey.includes('PASTE') &&
    !supabaseAnonKey.includes('your');

  if (!hasValidUrl || !hasValidKey) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '⚠️ Supabase not configured. Running in demo mode.\n' +
          'To enable auth, update .env.local with your Supabase credentials.',
      );
    }
    if (isProtectedRoute) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('redirectTo', path);
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  if (!shouldResolveUser) {
    return response;
  }

  const sharedCookieOptions = getSharedCookieOptions();

  const supabase = createServerClient(supabaseUrl!, supabaseAnonKey!, {
    ...(sharedCookieOptions ? { cookieOptions: sharedCookieOptions } : {}),
    global: {
      fetch: fetchWithTimeout,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        setSecurityHeaders(response.headers);
        cookiesToSet.forEach(({ name, value, options }) => {
          // Belt-and-braces: `cookieOptions` above already merges the shared
          // domain into every cookie @supabase/ssr sets or removes here
          // (session refresh on every request, sign-out). Re-applying it
          // explicitly keeps the proxy correct even if that merge is bypassed.
          response.cookies.set(name, value, withSharedCookieDomain(options));
        });
      },
    },
  });

  const PROXY_AUTH_DEADLINE_MS = process.env.NODE_ENV === 'development' ? 12_000 : 6_000;

  let user = null;
  let authResolution: 'resolved' | 'unknown' = 'unknown';
  try {
    const authPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), PROXY_AUTH_DEADLINE_MS),
    );

    const result = await Promise.race([authPromise, timeoutPromise]);

    if (result && 'data' in result) {
      authResolution = 'resolved';
      const {
        data: { user: authUser },
        error,
      } = result;

      if (authUser) {
        user = authUser;
      } else if (error) {
        const isRefreshTokenError = isRefreshTokenMissingError(error);

        if (!isRefreshTokenError) {
          if (isTransientProxyAuthError(new Error(error.message))) {
            if (shouldLogTransientProxyAuthError()) {
              console.warn('Proxy auth status: transient network/auth issue; request continuing');
            }
          } else {
            console.warn('Proxy auth status:', error.message);
          }
        } else {
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            // Ignore signout errors during refresh failure
          }
        }
      }
    } else {
      if (shouldLogTransientProxyAuthError()) {
        console.warn(`Proxy auth: timed out after ${PROXY_AUTH_DEADLINE_MS}ms; request continuing`);
      }
    }
  } catch (err) {
    const isRefreshError = err instanceof Error && err.message.includes('Refresh Token Not Found');
    const isTransient = isTransientProxyAuthError(err);

    if (isTransient) {
      if (shouldLogTransientProxyAuthError()) {
        console.warn('Proxy auth status: transient upstream failure; request continuing');
      }
    } else if (!isRefreshError) {
      logger.error('Proxy auth exception:', err);
    }
  }

  // Email verification gate — redirect unverified users to /verify
  if (user && isProtectedRoute && authResolution === 'resolved') {
    const emailConfirmed = user.email_confirmed_at;
    if (!emailConfirmed) {
      const redirectUrl = new URL('/verify', request.url);
      redirectUrl.searchParams.set('reason', 'unverified');
      const verifyResponse = NextResponse.redirect(redirectUrl);
      setSecurityHeaders(verifyResponse.headers);
      return verifyResponse;
    }
  }

  let requiresMfaUpgrade = false;
  let mfaResolution: 'resolved' | 'unknown' = 'unknown';
  if (user && (isProtectedRoute || isAuthRoute || (isApiRoute && !isPublicApi))) {
    const MFA_AAL_DEADLINE_MS = process.env.NODE_ENV === 'development' ? 4000 : 2500;
    try {
      const aalPromise = supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), MFA_AAL_DEADLINE_MS),
      );

      const result = await Promise.race([aalPromise, timeoutPromise]);

      if (result && 'data' in result) {
        mfaResolution = 'resolved';
        const aal = result.data;
        requiresMfaUpgrade = aal?.nextLevel === 'aal2' && aal?.currentLevel === 'aal1';
      }
    } catch (err) {
      logger.warn('Proxy MFA AAL check failed; MFA status unknown', {
        path,
        err,
      });
    }
  }

  if (isAuthRoute && user) {
    if (path.startsWith('/reset-password')) {
      return response;
    }

    if (requiresMfaUpgrade) {
      if (!path.startsWith('/login')) {
        const redirectUrl = new URL('/login', request.url);
        redirectUrl.searchParams.set('mfa', '1');
        return NextResponse.redirect(redirectUrl);
      }
    } else {
      return NextResponse.redirect(new URL('/home', request.url));
    }
  }

  if (isProtectedRoute && !user && !publicRoutes.some((route) => path.startsWith(route))) {
    if (authResolution === 'unknown') {
      return response;
    }
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirectTo', path);
    return NextResponse.redirect(redirectUrl);
  }

  if (isProtectedRoute && user && requiresMfaUpgrade) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('mfa', '1');
    redirectUrl.searchParams.set('redirectTo', path);
    return NextResponse.redirect(redirectUrl);
  }

  if (isApiRoute && !isPublicApi && user && mfaResolution === 'unknown') {
    const unavailableResponse = NextResponse.json(
      { error: 'Auth temporarily unavailable', code: 'AUTH_UNAVAILABLE' },
      { status: 503 },
    );
    setSecurityHeaders(unavailableResponse.headers);
    return unavailableResponse;
  }

  if (isApiRoute && !isPublicApi && user && requiresMfaUpgrade) {
    const forbiddenResponse = NextResponse.json(
      { error: 'MFA required', code: 'MFA_REQUIRED' },
      { status: 403 },
    );
    setSecurityHeaders(forbiddenResponse.headers);
    return forbiddenResponse;
  }

  if (isApiRoute && !isPublicApi && !user && authResolution === 'unknown') {
    const unavailableResponse = NextResponse.json(
      { error: 'Auth temporarily unavailable', code: 'AUTH_UNAVAILABLE' },
      { status: 503 },
    );
    setSecurityHeaders(unavailableResponse.headers);
    return unavailableResponse;
  }

  if (isApiRoute && !isPublicApi && !user) {
    const unauthorizedResponse = NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
    setSecurityHeaders(unauthorizedResponse.headers);
    return unauthorizedResponse;
  }

  return response;
}
