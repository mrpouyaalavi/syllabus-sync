import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const supabaseMocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  signOutMock: vi.fn(),
  getAalMock: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: supabaseMocks.getUserMock,
      signOut: supabaseMocks.signOutMock,
      mfa: {
        getAuthenticatorAssuranceLevel: supabaseMocks.getAalMock,
      },
    },
  })),
}));

describe('proxy mfa enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJ.test';

    supabaseMocks.getUserMock.mockResolvedValue({
      data: { user: { id: 'user-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
      error: null,
    });

    supabaseMocks.getAalMock.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
  });

  it('redirects protected routes to /login?mfa=1 when aal2 upgrade is required', async () => {
    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/calendar');
    const res = await proxy(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    const location = res.headers.get('location');
    expect(location).toContain('/login');
    expect(location).toContain('mfa=1');
    expect(location).toContain('redirectTo=%2Fcalendar');
  });

  it('allows /login to render when aal2 upgrade is required (no redirect to /home)', async () => {
    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/login?mfa=1');
    const res = await proxy(req);

    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects authenticated users away from /login when no mfa upgrade is required', async () => {
    supabaseMocks.getAalMock.mockResolvedValueOnce({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });

    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/login');
    const res = await proxy(req);

    expect(res.headers.get('location')).toContain('/home');
  });

  it('returns 403 for non-public API routes when aal2 upgrade is required', async () => {
    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/api/user/export');
    const res = await proxy(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('MFA_REQUIRED');
  });

  it('returns 503 for non-public API routes when auth status is unknown', async () => {
    vi.useFakeTimers();
    supabaseMocks.getUserMock.mockImplementationOnce(() => new Promise(() => {}) as any);

    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/api/user/export');
    const pending = proxy(req);
    await vi.advanceTimersByTimeAsync(6000);
    const res = await pending;
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe('AUTH_UNAVAILABLE');
    vi.useRealTimers();
  });

  it('allows /api/webauthn/authenticate/* through without auth (pre-login passkey flow)', async () => {
    // Simulate unauthenticated user (no session)
    supabaseMocks.getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const { proxy } = await import('@/lib/proxy');

    const optionsReq = new NextRequest('http://localhost/api/webauthn/authenticate/options', {
      method: 'POST',
    });
    const optionsRes = await proxy(optionsReq);
    // Should NOT be 401/403 — the route is public
    expect(optionsRes.status).not.toBe(401);
    expect(optionsRes.status).not.toBe(403);

    const verifyReq = new NextRequest('http://localhost/api/webauthn/authenticate/verify', {
      method: 'POST',
    });
    const verifyRes = await proxy(verifyReq);
    expect(verifyRes.status).not.toBe(401);
    expect(verifyRes.status).not.toBe(403);
  });

  it('blocks /api/webauthn/register/* without auth (requires session)', async () => {
    supabaseMocks.getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/api/webauthn/register/options', {
      method: 'POST',
    });
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it('does not force local signout for non-refresh 400 auth errors', async () => {
    supabaseMocks.getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: {
        message: 'Bad Request',
        status: 400,
        code: 'unexpected_error',
      },
    });

    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/calendar');
    const res = await proxy(req);

    expect(supabaseMocks.signOutMock).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('/login');
  });

  // Regression test for a production incident: this middleware creates a new
  // Supabase client per request with no lock shared across concurrent
  // requests. When several requests race to refresh the same cookie-stored
  // refresh token (e.g. the parallel API calls a page fires on mount right
  // after login), the loser sees "refresh token not found" even though a
  // sibling request already established a valid session. Previously the
  // middleware called signOut({scope:'local'}) here, clearing the session
  // cookie on this response and — if this was the response to the actual
  // page navigation — destroying the session the user just logged into,
  // bouncing them back to /login immediately after "Welcome back". Confirmed
  // against production Supabase auth logs: a burst of concurrent
  // refresh_token grants, mostly rate-limited, with one landing here.
  it('does not force local signout for refresh-token errors (concurrent-refresh race safety)', async () => {
    supabaseMocks.getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: {
        message: 'Invalid Refresh Token: Refresh Token Not Found',
        status: 400,
        code: 'refresh_token_not_found',
      },
    });

    const { proxy } = await import('@/lib/proxy');

    const req = new NextRequest('http://localhost/home');
    const res = await proxy(req);

    expect(supabaseMocks.signOutMock).not.toHaveBeenCalled();
    // Still redirected — this request genuinely has no confirmed user — but
    // via the normal "resolved, no user" path, not a middleware-forced
    // sign-out that would clear a possibly-still-valid session cookie.
    expect(res.headers.get('location')).toContain('/login');
  });
});
