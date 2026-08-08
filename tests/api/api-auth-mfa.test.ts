/**
 * Route-level API auth + MFA enforcement.
 *
 * These cases used to be enforced by the root proxy/middleware. API routes were
 * excluded from middleware auth resolution because building a fresh Supabase
 * client per request meant parallel API calls each raced to use the same
 * rotating refresh token — observed in production as ~100 refresh_token grants
 * in a 5-second window with 99 rate-limited (429), which made getUser() return
 * no user and bounced authenticated users back to /login.
 *
 * The 401 was always duplicated at the route level, but the MFA assurance-level
 * gate existed ONLY in the middleware. It now lives in requireAuth /
 * requireAuthWithRateLimit. This file is the evidence that moving it preserved
 * the original semantics exactly:
 *
 *   resolved + nextLevel 'aal2' while currentLevel 'aal1'  -> 403 MFA_REQUIRED
 *   unresolved assurance level (timeout / throw)           -> 503 (fail-closed)
 *   no user                                                -> 401
 *   aal2, or MFA not enrolled                              -> handler runs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getAalMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    auth: {
      getUser: supabaseMocks.getUserMock,
      mfa: { getAuthenticatorAssuranceLevel: supabaseMocks.getAalMock },
    },
  })),
}));

// Keep rate limiting out of the way — it is covered by its own tests and would
// otherwise reach a real limiter here.
vi.mock('@/lib/services/rateLimitService', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, limit: 100, resetIn: 60 })),
  mutationLimiter: vi.fn(async () => ({ allowed: true, remaining: 99, limit: 100, resetIn: 60 })),
}));

// CSRF/origin validation is exercised separately; treat it as passing so these
// tests isolate the auth + MFA decision.
vi.mock('@/lib/security/csrf', () => ({
  validateOrigin: vi.fn(() => ({ valid: true })),
  shouldSkipCSRF: vi.fn(() => true),
  validateCSRF: vi.fn(() => ({ valid: true })),
}));

const AUTHED_USER = { id: 'user-1', email_confirmed_at: '2026-01-01T00:00:00Z' };

function getRequest(url = 'http://localhost/api/events') {
  return new Request(url, { method: 'GET' });
}

describe('route-level API auth and MFA enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.getUserMock.mockResolvedValue({ data: { user: AUTHED_USER }, error: null });
    // Default: MFA satisfied.
    supabaseMocks.getAalMock.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requireAuth', () => {
    it('rejects an unauthenticated caller with 401', async () => {
      supabaseMocks.getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });

      const { requireAuth } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn();

      const res = await requireAuth(getRequest(), handler);

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it('rejects an MFA-enrolled aal1 caller with 403 MFA_REQUIRED', async () => {
      supabaseMocks.getAalMock.mockResolvedValueOnce({
        data: { currentLevel: 'aal1', nextLevel: 'aal2' },
        error: null,
      });

      const { requireAuth } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn();

      const res = await requireAuth(getRequest(), handler);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error.message).toBe('MFA required');
      // The gate must run before the handler — no data access at aal1.
      expect(handler).not.toHaveBeenCalled();
    });

    it('accepts an aal2 caller and runs the handler', async () => {
      const { requireAuth } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn(async () => new Response('ok') as never);

      await requireAuth(getRequest(), handler);

      expect(handler).toHaveBeenCalledWith(AUTHED_USER.id);
    });

    it('accepts a caller with no MFA enrolled (nextLevel aal1)', async () => {
      supabaseMocks.getAalMock.mockResolvedValueOnce({
        data: { currentLevel: 'aal1', nextLevel: 'aal1' },
        error: null,
      });

      const { requireAuth } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn(async () => new Response('ok') as never);

      await requireAuth(getRequest(), handler);

      expect(handler).toHaveBeenCalledWith(AUTHED_USER.id);
    });

    it('fails closed with 503 when the assurance level cannot be resolved', async () => {
      // Never settles -> the internal deadline wins, mirroring the proxy's old
      // `mfaResolution === 'unknown'` branch.
      supabaseMocks.getAalMock.mockImplementationOnce(() => new Promise(() => {}));

      const { requireAuth } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn();

      const res = await requireAuth(getRequest(), handler);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error.message).toBe('Auth temporarily unavailable');
      expect(handler).not.toHaveBeenCalled();
    }, 10_000);

    it('fails closed with 503 when the assurance-level check throws', async () => {
      supabaseMocks.getAalMock.mockRejectedValueOnce(new Error('upstream down'));

      const { requireAuth } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn();

      const res = await requireAuth(getRequest(), handler);

      expect(res.status).toBe(503);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not clear the session when a refresh-token error surfaces', async () => {
      // A losing sibling refresh must degrade to 401 for THIS request only —
      // never a destructive sign-out that would invalidate a valid cookie.
      supabaseMocks.getUserMock.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid Refresh Token: Refresh Token Not Found', code: 'refresh_token_not_found' },
      });

      const { requireAuth } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn();

      const res = await requireAuth(getRequest(), handler);

      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('requireAuthWithRateLimit', () => {
    it('rejects an unauthenticated caller with 401', async () => {
      supabaseMocks.getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });

      const { requireAuthWithRateLimit } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn();

      const res = await requireAuthWithRateLimit(getRequest(), handler);

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it('rejects an MFA-enrolled aal1 caller with 403 MFA_REQUIRED', async () => {
      supabaseMocks.getAalMock.mockResolvedValueOnce({
        data: { currentLevel: 'aal1', nextLevel: 'aal2' },
        error: null,
      });

      const { requireAuthWithRateLimit } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn();

      const res = await requireAuthWithRateLimit(getRequest(), handler);

      expect(res.status).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    });

    it('accepts an aal2 caller and runs the handler', async () => {
      const { requireAuthWithRateLimit } = await import('@/app/api/_lib/middleware');
      const handler = vi.fn(async () => new Response('ok') as never);

      await requireAuthWithRateLimit(getRequest(), handler);

      expect(handler).toHaveBeenCalledWith(AUTHED_USER.id);
    });
  });

  describe('parallel API calls (refresh-storm regression)', () => {
    it('resolves auth once per request and never destroys the session', async () => {
      const { requireAuth } = await import('@/app/api/_lib/middleware');

      const paths = [
        '/api/events',
        '/api/deadlines',
        '/api/todos',
        '/api/units',
        '/api/notifications',
        '/api/profiles',
        '/api/user-preferences',
        '/api/gamification',
      ];

      const responses = await Promise.all(
        paths.map((p) =>
          requireAuth(getRequest(`http://localhost${p}`), async () => new Response('ok') as never),
        ),
      );

      // Exactly one auth resolution per request — no duplicate middleware pass
      // stacking a second getUser() (and therefore a second refresh) on top.
      expect(supabaseMocks.getUserMock).toHaveBeenCalledTimes(paths.length);
      // None of them emitted a cookie mutation, so a losing refresh cannot
      // clear a session established by a sibling request.
      for (const res of responses) {
        expect(res.headers.get('set-cookie')).toBeNull();
      }
    });
  });
});
