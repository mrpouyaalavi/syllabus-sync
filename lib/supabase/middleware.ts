import { logger } from '@/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { getSharedCookieOptions } from '@/lib/supabase/cookie-options';

/**
 * Creates a Supabase client for middleware usage
 * Uses cookies for session management
 */
export function createClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const sharedCookieOptions = getSharedCookieOptions();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    ...(sharedCookieOptions ? { cookieOptions: sharedCookieOptions } : {}),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      },
    },
  });
}

/**
 * Updates the session cookies in the response
 * Called when session is refreshed or created
 */
export async function updateSession(request: NextRequest, _response: NextResponse) {
  const supabase = createClient(request);

  // SECURITY: Use getUser() instead of getSession() to validate the JWT server-side.
  // getSession() only reads the cookie without validation, allowing tampered tokens to pass.
  const { error } = await supabase.auth.getUser();

  if (error) {
    // SILENT: Handle common refresh token failures without logging to console.
    const isRefreshTokenError =
      error.message?.includes('Refresh Token Not Found') ||
      error.code === 'refresh_token_not_found' ||
      error.status === 400;

    if (!isRefreshTokenError) {
      logger.error('Session update error:', error);
    }
    return;
  }

  // Session refresh is handled by the Supabase SSR client's setAll cookie handler.
  // No manual cookie setting needed — the client manages cookie lifecycle.
}

/**
 * Middleware authentication check
 * Returns user session or null if not authenticated
 */
export async function getAuthenticatedUser(request: NextRequest) {
  try {
    const supabase = createClient(request);
    // SECURITY: Use getUser() to validate the JWT server-side, not getSession()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    return user;
  } catch (error) {
    logger.error('Auth check error:', error);
    return null;
  }
}
