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
  const isResetPasswordRoute = path.startsWith('/reset-password');
  const isAuthCallbackRoute = path.startsWith('/auth/callback');
  const isAuthConfirmRoute = path.startsWith('/auth/confirm');

  // API routes deliberately do NOT resolve auth here.
  //
  // This middleware builds a fresh Supabase server client per request (there is
  // no cross-request client or lock, and adding a shared one would be unsafe —
  // it would leak sessions between users). Supabase rotates the refresh token
  // on every use, so when a page load fires many API calls in parallel, each
  // one independently presented the *same* refresh token here: one won, the
  // rest got 429/400. Production Supabase auth logs showed ~100 refresh_token
  // grants inside a 5-second window, 99 rate-limited — which then made
  // getUser() return no user and bounced authenticated users back to /login.
  //
  // Every non-public API already enforces its own auth inside the route handler
  // (requireAuth / requireAuthWithRateLimit / inline getUser), so the auth check
  // middleware performed here was defence-in-depth, not the only gate — audited
  // across all 65 routes before this change. The one thing that lived *only*
  // here was the MFA assurance-level gate; it moved into the shared route-level
  // helper (app/api/_lib/middleware.ts) with identical semantics.
  //
  // Page routes still resolve auth here: they need the redirect behaviour, and
  // a navigation is a single request rather than a parallel burst.
  const shouldResolveUser =
    !isRootPath &&
    !isResetPasswordRoute &&
    !isAuthCallbackRoute &&
    !isAuthConfirmRoute &&
    !isApiRoute &&
    (isProtectedRoute || isAuthRoute);

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
    // Moved here from next.config.ts `headers()`. That block used a catch-all
    // `source` ('/(.*)'), which the OpenNext router cannot parse: it matches
    // using Next's compiled regex but then calls path-to-regexp v8 `match()` on
    // the raw source string, and v8 rejects every catch-all form Next accepts.
    // The result was a 500 on every dynamic route. Setting them here covers all
    // rendered responses; static assets are covered by public/_headers.
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('X-DNS-Prefetch-Control', 'on');
    headers.set('X-Download-Options', 'noopen');
    headers.set('X-Permitted-Cross-Domain-Policies', 'none');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
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
          // Do NOT call signOut() here. This middleware creates a brand-new
          // Supabase client on every single request with no lock shared
          // across concurrent requests (e.g. the several API calls a page
          // fires on mount). Supabase rotates the refresh token on each use,
          // so when two requests race to refresh the SAME cookie-stored
          // token, the loser sees exactly this "refresh token not
          // found/invalid" error — even though a sibling request already
          // established a valid new session moments earlier.
          //
          // signOut({scope:'local'}) here would clear the session cookie on
          // THIS response, which — if this happens to be the response to the
          // actual page navigation — destroys the session the user just
          // successfully established, immediately bouncing them back to
          // /login right after "Welcome back". Confirmed against production
          // Supabase auth logs: a burst of concurrent refresh_token grants,
          // mostly rate-limited (429), with one landing exactly here as an
          // "invalid refresh token" error.
          //
          // Treat it like any other unresolved case instead: this request
          // proceeds with user=null. If the token is genuinely dead (not a
          // race), every subsequent request's getUser() will keep failing
          // too, and the existing "resolved, no user -> redirect to /login"
          // logic below already handles that correctly, without this
          // middleware needing to proactively destroy a cookie that might
          // still be valid.
          if (shouldLogTransientProxyAuthError()) {
            console.warn(
              'Proxy auth status: refresh token rejected (possibly a concurrent-refresh race); request continuing without forcing sign-out',
            );
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

  // Page routes only — the API arm of this condition moved to
  // enforceMfaAssuranceLevel() in app/api/_lib/middleware.ts.
  let requiresMfaUpgrade = false;
  if (user && (isProtectedRoute || isAuthRoute)) {
    const MFA_AAL_DEADLINE_MS = process.env.NODE_ENV === 'development' ? 4000 : 2500;
    try {
      const aalPromise = supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), MFA_AAL_DEADLINE_MS),
      );

      const result = await Promise.race([aalPromise, timeoutPromise]);

      if (result && 'data' in result) {
        const aal = result.data;
        requiresMfaUpgrade = aal?.nextLevel === 'aal2' && aal?.currentLevel === 'aal1';
      }
      // An unresolved result leaves requiresMfaUpgrade false, so a page render
      // proceeds. That matches the pre-existing page behaviour: only the API
      // path ever failed closed on an unknown assurance level, and that rule is
      // preserved in enforceMfaAssuranceLevel().
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

  // NOTE: the API auth/MFA response blocks that used to live here (401
  // Unauthorized, 403 MFA_REQUIRED, 503 AUTH_UNAVAILABLE) have been removed.
  // `shouldResolveUser` now excludes API routes, so `user` is always null for
  // them and those branches were unreachable — leaving them would have made
  // every authenticated API call 401 at the edge. Their behaviour is preserved
  // at the route level:
  //   - 401  -> requireAuth / requireAuthWithRateLimit / inline getUser()
  //   - 403 MFA_REQUIRED and 503 AUTH_UNAVAILABLE -> enforceMfaAssuranceLevel()
  //     in app/api/_lib/middleware.ts, same thresholds, same fail-closed rule.
  return response;
}
