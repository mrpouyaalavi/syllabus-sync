import type { CookieOptions, CookieOptionsWithName } from '@supabase/ssr';

/**
 * Shared cookie-domain configuration for Supabase auth cookies.
 *
 * Root cause of "session not shared across subdomains": Supabase auth cookies
 * were being set without an explicit `domain`, so browsers default to a
 * host-only cookie (e.g. `www.syllabus-sync.app`). A host-only cookie is
 * never sent to sibling subdomains like `sylla.syllabus-sync.app`, so the
 * session appeared to "not exist" there.
 *
 * Setting `domain: ".syllabus-sync.app"` on every Supabase-issued cookie
 * (set *and* delete) makes the cookie valid for the apex domain and all of
 * its subdomains, so the session is shared everywhere.
 *
 * `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` should only ever be set in the production
 * environment. Even if it leaks into a local `.env` file, we still refuse to
 * apply it outside of `NODE_ENV === 'production'` so local development
 * (http://localhost:3000) keeps working with host-only cookies.
 */
export function getAuthCookieDomain(): string | undefined {
  const configuredDomain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN?.trim();

  if (!configuredDomain) {
    return undefined;
  }

  // Never apply a cross-subdomain cookie domain outside of production —
  // this keeps localhost / preview / test environments on host-only cookies.
  if (process.env.NODE_ENV !== 'production') {
    return undefined;
  }

  return configuredDomain;
}

/**
 * Cookie options to hand directly to `createBrowserClient` / `createServerClient`
 * via the `cookieOptions` param (supported by @supabase/ssr).
 *
 * @supabase/ssr merges these into *every* cookie it sets or removes
 * (see `DEFAULT_COOKIE_OPTIONS` merge in `createStorageFromOptions`), so this
 * is enough to cover session creation, refresh, and sign-out — without us
 * having to touch individual cookie names.
 *
 * Returns `undefined` when no shared domain is configured (local dev), so
 * callers can spread it in without overriding any Supabase defaults.
 */
export function getSharedCookieOptions(): CookieOptionsWithName | undefined {
  const domain = getAuthCookieDomain();

  if (!domain) {
    return undefined;
  }

  return {
    domain,
    path: '/',
    sameSite: 'lax',
    secure: true,
  };
}

/**
 * Merges the shared production cookie domain into a single cookie's options
 * as an extra safety net for callers that manually forward Supabase's
 * `setAll` options to `cookies().set(...)` (Next.js server actions/route
 * handlers, proxy/middleware).
 *
 * Supabase-provided options (maxAge, expires, sameSite, secure, httpOnly,
 * etc.) are always preserved — we only add/override `domain`, and only when
 * a production shared domain is configured. `path` defaults to "/" to match
 * the domain-wide cookie, but any explicit path from Supabase wins.
 */
export function withSharedCookieDomain(options: CookieOptions = {}): CookieOptions {
  const domain = getAuthCookieDomain();

  if (!domain) {
    return options;
  }

  return {
    path: '/',
    ...options,
    domain,
  };
}
