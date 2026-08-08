import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { jsonUnauthorized, jsonError, ERROR_CODES } from './response';
import {
  checkRateLimit,
  type RateLimitConfig,
  mutationLimiter,
} from '@/lib/services/rateLimitService';
import { validateOrigin, shouldSkipCSRF, validateCSRF } from '@/lib/security/csrf';
import { logger } from '@/lib/logger';

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
let lastTransientAuthLogAt = 0;
const TRANSIENT_AUTH_LOG_INTERVAL_MS = 60_000;

function isTransientAuthNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    err.name === 'AbortError' ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('network')
  );
}

function shouldLogTransientAuthError(): boolean {
  const now = Date.now();
  if (now - lastTransientAuthLogAt < TRANSIENT_AUTH_LOG_INTERVAL_MS) {
    return false;
  }
  lastTransientAuthLogAt = now;
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

/** Matches the deadline the proxy previously used for this same check. */
const MFA_AAL_DEADLINE_MS = process.env.NODE_ENV === 'development' ? 4000 : 2500;

type MfaGateResult = { ok: true } | { ok: false; response: NextResponse };

/**
 * Assurance-level (MFA) gate for authenticated API routes.
 *
 * This check used to live in the root proxy/middleware, which was the *only*
 * place enforcing MFA for API requests. It moved here when API routes were
 * excluded from middleware auth resolution (see lib/proxy.ts): the middleware
 * was creating a fresh Supabase client and calling getUser() on every parallel
 * API request, and since Supabase rotates the refresh token on each use, a page
 * load firing many API calls at once produced a burst of competing refreshes —
 * observed in production as ~100 refresh_token grants in a 5s window, 99 of
 * them rate-limited (429).
 *
 * Semantics are preserved exactly as the proxy had them:
 *   - resolved + nextLevel 'aal2' while currentLevel is 'aal1' -> 403 MFA_REQUIRED
 *   - unresolved (timeout/throw)                               -> 503 AUTH_UNAVAILABLE
 * The unresolved case is deliberately fail-closed: if we cannot confirm the
 * assurance level we deny rather than risk letting an aal1 session through.
 *
 * Callers pass their existing client so this adds no extra client construction.
 */
async function enforceMfaAssuranceLevel(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<MfaGateResult> {
  let requiresMfaUpgrade = false;
  let resolution: 'resolved' | 'unknown' = 'unknown';

  try {
    const aalPromise = supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), MFA_AAL_DEADLINE_MS),
    );

    const result = await Promise.race([aalPromise, timeoutPromise]);

    if (result && 'data' in result) {
      resolution = 'resolved';
      const aal = result.data;
      requiresMfaUpgrade = aal?.nextLevel === 'aal2' && aal?.currentLevel === 'aal1';
    }
  } catch (err) {
    logger.warn('API MFA AAL check failed; MFA status unknown', { err });
  }

  if (resolution === 'unknown') {
    return {
      ok: false,
      response: jsonError('Auth temporarily unavailable', 503, ERROR_CODES.SERVICE_UNAVAILABLE),
    };
  }

  if (requiresMfaUpgrade) {
    return { ok: false, response: jsonError('MFA required', 403, ERROR_CODES.FORBIDDEN) };
  }

  return { ok: true };
}

/**
 * Require authentication for API routes
 * SECURITY: For mutation methods, also validates CSRF origin header
 */
export const requireAuth = async (
  request: Request,
  handler: (userId: string) => Promise<NextResponse>,
): Promise<NextResponse> => {
  try {
    // SECURITY: Validate origin for mutation methods (CSRF protection)
    if (MUTATION_METHODS.includes(request.method)) {
      const originResult = validateOrigin(request as unknown as NextRequest);
      if (!originResult.valid) {
        console.warn('CSRF origin validation failed:', originResult.reason);
        return jsonError('Invalid request origin', 403, ERROR_CODES.FORBIDDEN);
      }
    }

    const supabase = await createServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      // SILENT: Do not log refresh token failures as they are expected when sessions expire
      const isRefreshError = error ? isRefreshTokenMissingError(error) : false;

      if (error && !isRefreshError) {
        if (isTransientAuthNetworkError(new Error(error.message))) {
          if (shouldLogTransientAuthError()) {
            console.warn('API auth status: transient upstream issue; treating as unauthenticated');
          }
        } else {
          console.warn('API auth error:', error.message);
        }
      }
      return jsonUnauthorized('Valid authentication token required');
    }

    // Assurance-level gate — previously enforced by the root proxy, which no
    // longer resolves auth for API routes. Reuses the client above, so this
    // costs no extra client construction.
    const mfaGate = await enforceMfaAssuranceLevel(supabase);
    if (!mfaGate.ok) return mfaGate.response;

    return await handler(user.id);
  } catch (error) {
    logger.error(
      'Authentication middleware error:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return jsonError('Authentication failed', 500, ERROR_CODES.INTERNAL_ERROR);
  }
};

/**
 * Optional authentication - provides user ID if authenticated
 */
export const optionalAuth = async (
  request: Request,
  handler: (userId?: string) => Promise<NextResponse>,
): Promise<NextResponse> => {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      const isRefreshError = isRefreshTokenMissingError(error);

      if (!isRefreshError) {
        if (isTransientAuthNetworkError(new Error(error.message))) {
          if (shouldLogTransientAuthError()) {
            console.warn(
              'Optional auth status: transient upstream issue; continuing without user context',
            );
          }
        } else {
          console.warn('Optional auth status:', error.message);
        }
      }
    }

    return await handler(user?.id);
  } catch (error) {
    const isRefreshError =
      error instanceof Error && error.message.includes('Refresh Token Not Found');
    const isTransient = isTransientAuthNetworkError(
      error instanceof Error ? error : new Error(String(error)),
    );
    if (isTransient) {
      if (shouldLogTransientAuthError()) {
        console.warn(
          'Optional auth status: transient upstream failure; continuing unauthenticated',
        );
      }
    } else if (!isRefreshError) {
      logger.error(
        'Optional auth middleware error:',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
    // Continue without authentication
    return await handler(undefined);
  }
};

// ============================================================================
// AUTHENTICATED + RATE LIMITED MIDDLEWARE
// ============================================================================

/**
 * Require authentication AND apply rate limiting for mutation endpoints
 * SECURITY: Combines auth check, CSRF validation, and rate limiting
 *
 * @param request - The request object
 * @param handler - Handler function that receives userId
 * @param rateLimitKey - Optional custom key for rate limiting (defaults to pathname)
 */
export const requireAuthWithRateLimit = async (
  request: Request,
  handler: (userId: string) => Promise<NextResponse>,
  rateLimitKey?: string,
): Promise<NextResponse> => {
  // First authenticate
  try {
    // SECURITY: Validate origin for mutation methods (CSRF protection)
    if (MUTATION_METHODS.includes(request.method)) {
      const originResult = validateOrigin(request as unknown as NextRequest);
      if (!originResult.valid) {
        console.warn('CSRF origin validation failed:', originResult.reason);
        return jsonError('Invalid request origin', 403, ERROR_CODES.FORBIDDEN);
      }
    }

    const supabase = await createServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      // SILENT: Do not log refresh token failures as they are expected when sessions expire
      const isRefreshError = error ? isRefreshTokenMissingError(error) : false;

      if (error && !isRefreshError) {
        if (isTransientAuthNetworkError(new Error(error.message))) {
          if (shouldLogTransientAuthError()) {
            console.warn('API auth status: transient upstream issue; treating as unauthenticated');
          }
        } else {
          console.warn('API auth error:', error.message);
        }
      }
      return jsonUnauthorized('Valid authentication token required');
    }

    // Assurance-level gate — previously enforced by the root proxy, which no
    // longer resolves auth for API routes. Runs before rate limiting so an
    // MFA-required caller cannot consume another user's rate-limit budget.
    const mfaGate = await enforceMfaAssuranceLevel(supabase);
    if (!mfaGate.ok) return mfaGate.response;

    // Apply rate limiting using user ID for authenticated requests
    const key = rateLimitKey || new URL(request.url).pathname;
    const rateLimitResult = await mutationLimiter(`user:${user.id}:${key}`);

    if (!rateLimitResult.allowed) {
      return jsonError(
        `Rate limit exceeded. Try again in ${rateLimitResult.resetIn} seconds.`,
        429,
        ERROR_CODES.RATE_LIMITED,
        {
          resetIn: rateLimitResult.resetIn,
          limit: rateLimitResult.limit,
        },
      );
    }

    // Execute handler and add rate limit headers
    const response = await handler(user.id);

    // Add rate limit headers to response
    const newResponse = new NextResponse(response.body, response);
    newResponse.headers.set('X-RateLimit-Limit', rateLimitResult.limit.toString());
    newResponse.headers.set('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    newResponse.headers.set('X-RateLimit-Reset', rateLimitResult.resetIn.toString());

    return newResponse;
  } catch (error) {
    logger.error(
      'Auth/RateLimit middleware error:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return jsonError('Request processing failed', 500, ERROR_CODES.INTERNAL_ERROR);
  }
};

// ============================================================================
// RATE LIMITING MIDDLEWARE
// ============================================================================

/**
 * Validates IP address format to prevent injection
 */
function isValidIP(ip: string): boolean {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

/**
 * Extract client IP from request headers securely
 * SECURITY: Only trust verified proxy headers in production
 */
function getClientIP(request: NextRequest): string {
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, prefer verified proxy headers that cannot be spoofed
  if (isProduction) {
    // Vercel's verified header (highest trust)
    const vercelIp = request.headers.get('x-vercel-forwarded-for');
    if (vercelIp) {
      const firstIp = vercelIp.split(',')[0].trim();
      if (firstIp && isValidIP(firstIp)) return firstIp;
    }

    // Cloudflare's verified header
    const cfIp = request.headers.get('cf-connecting-ip');
    if (cfIp && isValidIP(cfIp)) return cfIp;
  }

  // In development or as fallback, use standard headers
  // SECURITY: Be careful with x-forwarded-for in production if not behind a trusted proxy
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp && isValidIP(firstIp)) return firstIp;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp && isValidIP(realIp)) return realIp;

  const clientIp = request.headers.get('x-client-ip');
  if (clientIp && isValidIP(clientIp)) return clientIp;

  return 'unknown';
}

/**
 * Apply rate limiting to API routes
 * SECURITY: Uses distributed store (Redis/KV) in production for serverless compatibility
 */
export const rateLimit = (
  config: RateLimitConfig = { windowMs: 15 * 60 * 1000, maxRequests: 100 },
) => {
  return async (
    request: NextRequest,
    handler: () => Promise<NextResponse>,
  ): Promise<NextResponse> => {
    const ip = getClientIP(request);
    const key = `${ip}:${request.nextUrl.pathname}`;

    // Check rate limit using distributed store
    const { allowed, remaining, resetIn, limit } = await checkRateLimit(key, {
      ...config,
      prefix: config.prefix || 'api',
    });

    if (!allowed) {
      return jsonError(
        `Rate limit exceeded. Try again in ${resetIn} seconds.`,
        429,
        ERROR_CODES.RATE_LIMITED,
        { resetIn, limit, windowMs: config.windowMs },
      );
    }

    try {
      const response = await handler();

      // Add rate limit headers to response
      const newResponse = new NextResponse(response.body, response);
      newResponse.headers.set('X-RateLimit-Limit', limit.toString());
      newResponse.headers.set('X-RateLimit-Remaining', remaining.toString());
      newResponse.headers.set('X-RateLimit-Reset', resetIn.toString());

      return newResponse;
    } catch (error) {
      throw error;
    }
  };
};

// ============================================================================
// CORS MIDDLEWARE
// ============================================================================

/**
 * CORS configuration
 */
interface CorsConfig {
  allowedOrigins?: string[];
  allowedMethods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * Apply CORS headers to API routes
 * SECURITY: This middleware enforces strict origin validation
 * - Never allows '*' with credentials=true (browser security violation)
 * - Validates origins against explicit allowlist
 */
export const cors = (config: CorsConfig = {}) => {
  // Parse CORS_ALLOWED_ORIGINS from environment variable if available
  // Format: comma-separated URLs, e.g., "http://localhost:3000,https://myapp.com"
  const defaultOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
    : [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3002',
      ];

  const {
    allowedOrigins = defaultOrigins,
    allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders = [],
    credentials = true,
    maxAge = 86400, // 24 hours
  } = config;

  // SECURITY: Disallow wildcard origin with credentials
  // This is a browser security requirement - warn developers
  const sanitizedOrigins = allowedOrigins.filter((origin) => {
    if (origin === '*' && credentials) {
      console.warn(
        'SECURITY WARNING: CORS wildcard (*) origin is not allowed with credentials=true. ' +
          'Removing wildcard from allowed origins.',
      );
      return false;
    }
    return true;
  });

  // SECURITY: If no valid origins remain after sanitization, use defaults
  const finalOrigins = sanitizedOrigins.length > 0 ? sanitizedOrigins : defaultOrigins;

  return async (
    request: NextRequest,
    handler: () => Promise<NextResponse>,
  ): Promise<NextResponse> => {
    const origin = request.headers.get('origin');

    // SECURITY: Validate origin against allowlist
    const isAllowedOrigin = !origin || finalOrigins.includes(origin);

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin) {
        return jsonError('Origin not allowed', 403, ERROR_CODES.FORBIDDEN);
      }

      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': origin || finalOrigins[0],
          'Access-Control-Allow-Methods': allowedMethods.join(', '),
          'Access-Control-Allow-Headers': allowedHeaders.join(', '),
          'Access-Control-Allow-Credentials': credentials.toString(),
          'Access-Control-Max-Age': maxAge.toString(),
        },
      });
    }

    const response = await handler();

    // Add CORS headers to actual response only if origin is allowed
    if (isAllowedOrigin && origin) {
      const corsHeaders: Record<string, string> = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': allowedMethods.join(', '),
        'Access-Control-Allow-Headers': allowedHeaders.join(', '),
        'Access-Control-Allow-Credentials': credentials.toString(),
      };

      if (exposedHeaders.length > 0) {
        corsHeaders['Access-Control-Expose-Headers'] = exposedHeaders.join(', ');
      }

      // Create new response with CORS headers
      const newResponse = new NextResponse(response.body, response);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newResponse.headers.set(key, value);
      });

      return newResponse;
    }

    return response;
  };
};

// ============================================================================
// VALIDATION MIDDLEWARE
// ============================================================================

// Default body size limit (100KB - reasonable for most API payloads)
const DEFAULT_MAX_BODY_SIZE = 100 * 1024; // 100KB

/**
 * Parse JSON body with size limit protection
 * SECURITY: Prevents unbounded JSON parsing DoS attacks
 */
export async function parseJsonBody<T = unknown>(
  request: Request,
  maxSize: number = DEFAULT_MAX_BODY_SIZE,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    // Check Content-Length header first (fast rejection)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      return {
        success: false,
        error: `Request body too large. Maximum size is ${Math.round(maxSize / 1024)}KB`,
      };
    }

    // Read body as text to check actual size
    const body = await request.text();

    if (body.length > maxSize) {
      return {
        success: false,
        error: `Request body too large. Maximum size is ${Math.round(maxSize / 1024)}KB`,
      };
    }

    // Parse JSON
    if (!body || body.trim() === '') {
      return { success: true, data: {} as T };
    }

    const data = JSON.parse(body) as T;
    return { success: true, data };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { success: false, error: 'Invalid JSON in request body' };
    }
    return { success: false, error: 'Failed to parse request body' };
  }
}

/**
 * Request validation middleware
 */
export const validateRequest = <T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: unknown;
    };
  },
  maxBodySize: number = DEFAULT_MAX_BODY_SIZE,
) => {
  return async (
    request: Request,
    handler: (validatedData: T) => Promise<NextResponse>,
  ): Promise<NextResponse> => {
    try {
      // SECURITY: Parse with size limit
      const bodyResult = await parseJsonBody(request, maxBodySize);
      if (!bodyResult.success) {
        return jsonError(bodyResult.error, 413, ERROR_CODES.VALIDATION_ERROR);
      }

      const result = schema.safeParse(bodyResult.data);

      if (!result.success) {
        const zodError = result.error as { errors?: unknown[] };
        // Log validation errors server-side for debugging
        logger.error('Validation failed:', JSON.stringify(zodError.errors ?? [], null, 2));
        logger.error('Request body was:', JSON.stringify(bodyResult.data, null, 2));
        return jsonError('Request validation failed', 400, ERROR_CODES.VALIDATION_ERROR, {
          errors: zodError.errors ?? [],
        });
      }

      return await handler(result.data!);
    } catch (error) {
      logger.error('Validation middleware error:', error);
      return jsonError('Request processing failed', 400, ERROR_CODES.BAD_REQUEST);
    }
  };
};

// ============================================================================
// LOGGING MIDDLEWARE
// ============================================================================

/**
 * Request logging middleware
 */
export const logRequest = (level: 'warn' | 'error' = 'warn') => {
  return async (
    request: NextRequest,
    handler: () => Promise<NextResponse>,
  ): Promise<NextResponse> => {
    const startTime = Date.now();
    const method = request.method;
    const url = request.nextUrl.pathname;
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    const ip =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      request.headers.get('x-client-ip') ||
      'Unknown';

    // eslint-disable-next-line no-console
    console[level](`[${method}] ${url} - IP: ${ip} - User-Agent: ${userAgent}`);

    try {
      const response = await handler();
      const duration = Date.now() - startTime;

      // eslint-disable-next-line no-console
      console[level](`[${method}] ${url} - ${response.status} - ${duration}ms`);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[${method}] ${url} - ERROR - ${duration}ms:`, error);
      throw error;
    }
  };
};

// ============================================================================
// PER-ROUTE API GUARD
// ============================================================================

/**
 * Per-route API guard that combines CSRF validation, optional auth, and
 * a generic error wrapper that never leaks internals.
 *
 * Usage:
 *   export async function POST(req: NextRequest) {
 *     return withApiGuard(req, async (r) => {
 *       // handler
 *     }, { requireAuth: true });
 *   }
 */
export async function withApiGuard(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>,
  options: { requireAuth?: boolean; skipCSRF?: boolean } = {},
): Promise<NextResponse> {
  // CSRF origin/referer check
  if (!options.skipCSRF && !shouldSkipCSRF(req)) {
    const csrf = validateCSRF(req);
    if (!csrf.valid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Auth check
  if (options.requireAuth) {
    try {
      const supabase = await createServerClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        return jsonUnauthorized('Valid authentication token required');
      }
    } catch (error) {
      logger.error(
        'withApiGuard auth error:',
        error instanceof Error ? error.message : 'Unknown error',
      );
      return jsonError('Authentication failed', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  // Generic error wrapper — never leak internals
  try {
    return await handler(req);
  } catch (err) {
    logger.error('[API Error]', req.nextUrl.pathname, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
