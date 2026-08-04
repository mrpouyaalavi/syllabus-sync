/**
 * CSRF Protection Middleware
 *
 * SECURITY: This module provides CSRF protection for mutation endpoints.
 * While Supabase uses SameSite=Lax cookies, explicit CSRF tokens add defense-in-depth.
 *
 * Implementation:
 * - Double-submit cookie pattern
 * - Origin/Referer validation
 * - Custom header requirement for API calls
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomHex, sha256Hex } from './edge-crypto';
import { getTrustedExternalOrigins } from './trusted-origins';

// ============================================================================
// CONSTANTS
// ============================================================================

const CSRF_COOKIE_NAME = '__Host-csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_MAX_AGE = 60 * 60 * 24; // 24 hours

// Methods that require CSRF protection
const PROTECTED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Paths that are exempt from CSRF (webhooks, etc.)
const EXEMPT_PATHS = ['/api/webhooks/', '/api/cron/'];

// ============================================================================
// TOKEN GENERATION
// ============================================================================

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCSRFToken(): string {
  return randomHex(CSRF_TOKEN_LENGTH);
}

/**
 * Hash a CSRF token for comparison (prevents timing attacks)
 */
function hashToken(token: string): string {
  return sha256Hex(token);
}

/**
 * Securely compare two tokens (constant-time comparison)
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const aHash = hashToken(a);
  const bHash = hashToken(b);

  let result = 0;
  for (let i = 0; i < aHash.length; i++) {
    result |= aHash.charCodeAt(i) ^ bHash.charCodeAt(i);
  }

  return result === 0;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate CSRF token from request
 */
export function validateCSRFToken(request: NextRequest): {
  valid: boolean;
  reason?: string;
} {
  // Skip validation for safe methods
  if (!PROTECTED_METHODS.includes(request.method)) {
    return { valid: true };
  }

  // Skip validation for exempt paths
  const pathname = request.nextUrl.pathname;
  if (EXEMPT_PATHS.some((path) => pathname.startsWith(path))) {
    return { valid: true };
  }

  // Get token from cookie
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!cookieToken) {
    return { valid: false, reason: 'Missing CSRF cookie' };
  }

  // Get token from header
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (!headerToken) {
    return { valid: false, reason: 'Missing CSRF header' };
  }

  // Compare tokens
  if (!secureCompare(cookieToken, headerToken)) {
    return { valid: false, reason: 'CSRF token mismatch' };
  }

  return { valid: true };
}

/**
 * Validate Origin/Referer header
 */
export function validateOrigin(request: NextRequest): {
  valid: boolean;
  reason?: string;
} {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // For non-mutation requests, skip validation
  if (!PROTECTED_METHODS.includes(request.method)) {
    return { valid: true };
  }

  // No origin + no referer = non-browser (curl, Postman, service worker) → allow
  if (!origin && !referer) {
    console.warn('CSRF: Request without origin/referer headers', {
      method: request.method,
      path: request.nextUrl.pathname,
    });
    return { valid: true };
  }

  const host = request.headers.get('host');
  const allowedOrigins = getAllowedOrigins();

  // Check origin header — same-host check first (handles all deploy aliases)
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return { valid: true };
      if (allowedOrigins.includes(originUrl.origin)) return { valid: true };
      return { valid: false, reason: `Invalid origin: ${origin}` };
    } catch {
      return { valid: false, reason: 'Malformed origin header' };
    }
  }

  // Check referer header as fallback
  if (referer && !origin) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) return { valid: true };
      if (allowedOrigins.includes(refererUrl.origin)) return { valid: true };
      return { valid: false, reason: `Invalid referer: ${referer}` };
    } catch {
      return { valid: false, reason: 'Malformed referer header' };
    }
  }

  return { valid: true };
}

/**
 * Get list of allowed origins
 */
function getAllowedOrigins(): string[] {
  const origins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
  ];

  const addUrl = (raw: string | undefined) => {
    if (!raw) return;
    try {
      origins.push(new URL(raw).origin);
    } catch {
      /* ignore invalid URL */
    }
  };

  addUrl(process.env.NEXT_PUBLIC_APP_URL);

  // Vercel injects three URL vars per deployment; all must be trusted
  if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  // Explicitly-configured sibling apps (e.g. Sylla). No wildcards.
  origins.push(...getTrustedExternalOrigins());

  return origins;
}

// ============================================================================
// MIDDLEWARE HELPER
// ============================================================================

/**
 * CSRF protection middleware wrapper
 * Use this in API routes that need CSRF protection
 */
export function withCSRFProtection<T>(
  handler: (request: NextRequest) => Promise<T>,
): (request: NextRequest) => Promise<T | NextResponse> {
  return async (request: NextRequest) => {
    // Validate origin
    const originResult = validateOrigin(request);
    if (!originResult.valid) {
      console.warn('CSRF origin validation failed:', originResult.reason);
      return NextResponse.json(
        { error: { code: 'CSRF_ERROR', message: 'Invalid request origin' } },
        { status: 403 },
      );
    }

    // SECURITY: Full CSRF token validation (double-submit cookie pattern)
    // This provides defense-in-depth on top of Supabase's SameSite=Lax cookies
    // SECURITY FIX: CSRF can ONLY be disabled in development, never in production
    // This prevents attackers from disabling CSRF protection via environment variables
    const isRealProduction =
      process.env.VERCEL_ENV === 'production' ||
      (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV);

    // NOTE: For Vitest integration tests, we allow disabling CSRF validation
    // in the test environment specifically.
    const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

    const csrfEnabled =
      isRealProduction || (process.env.CSRF_VALIDATION_ENABLED !== 'false' && !isTest);

    if (csrfEnabled) {
      const csrfResult = validateCSRFToken(request);
      if (!csrfResult.valid) {
        console.warn('CSRF token validation failed:', csrfResult.reason);
        return NextResponse.json(
          { error: { code: 'CSRF_ERROR', message: 'Invalid CSRF token' } },
          { status: 403 },
        );
      }
    }

    return handler(request);
  };
}

// ============================================================================
// ORIGIN-BASED CSRF (used by root middleware.ts)
// ============================================================================

/**
 * Routes that must never be CSRF-checked by the middleware origin validator.
 * These receive legitimate cross-origin or server-to-server traffic.
 */
const CSRF_EXEMPT_PREFIXES = [
  '/api/auth/callback', // Supabase OAuth callback
  '/api/auth/confirm', // Supabase email confirm
  '/api/webhooks', // Inbound webhooks (Stripe, etc.)
  '/api/maps', // Google Maps proxy
  '/api/health', // Health checks
  '/api/cron/', // Cron jobs
];

/** HTTP methods that cannot carry state-changing intent */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Trusted external origins that may legitimately POST to our endpoints.
 * Built lazily from environment variables.
 */
function getTrustedOrigins(): Set<string> {
  const origins = new Set<string>();

  if (process.env.NEXT_PUBLIC_SITE_URL) {
    origins.add(process.env.NEXT_PUBLIC_SITE_URL);
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      origins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
    } catch {
      /* ignore invalid URL */
    }
  }

  origins.add('https://maps.googleapis.com');

  if (process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF) {
    origins.add(`https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF}.supabase.co`);
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      origins.add(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin);
    } catch {
      /* ignore invalid URL */
    }
  }
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) origins.add(`https://${process.env.VERCEL_BRANCH_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  // Explicitly-configured sibling apps (e.g. Sylla). No wildcards.
  for (const origin of getTrustedExternalOrigins()) {
    origins.add(origin);
  }

  return origins;
}

/**
 * Determine whether a request should skip CSRF origin checking entirely.
 * Safe methods and exempt paths bypass the check.
 */
export function shouldSkipCSRF(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const path = req.nextUrl.pathname;
  if (CSRF_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return true;
  return false;
}

/**
 * Validate a request's origin/referer against the host header.
 * Uses strict `new URL(origin).host === host` comparison (not substring/includes).
 *
 * Returns `{ valid: true }` for server-to-server requests (no origin AND no referer).
 */
export function validateCSRF(req: NextRequest): { valid: boolean; reason?: string } {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('host');

  // No origin + no referer = non-browser (server-to-server / SW) → allow
  if (!origin && !referer) {
    return { valid: true, reason: 'no-origin-server-request' };
  }

  const trustedOrigins = getTrustedOrigins();

  // Check origin strictly (not substring/includes!)
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return { valid: true };
      if (trustedOrigins.has(origin)) return { valid: true };
      return { valid: false, reason: `origin-mismatch: ${origin}` };
    } catch {
      return { valid: false, reason: 'malformed-origin' };
    }
  }

  // Fallback: check referer
  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost === host) return { valid: true };
      return { valid: false, reason: `referer-mismatch: ${referer}` };
    } catch {
      return { valid: false, reason: 'malformed-referer' };
    }
  }

  return { valid: false, reason: 'no-valid-origin' };
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Set CSRF cookie on response
 */
export function setCSRFCookie(response: NextResponse, token?: string): void {
  const csrfToken = token || generateCSRFToken();

  response.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false, // Must be readable by JS for double-submit
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CSRF_TOKEN_MAX_AGE,
    path: '/',
  });
}
