/**
 * Regression coverage for the production login redirect loop.
 *
 * The bug: `loginAction` is a server action, so sign-in happens with the SERVER
 * Supabase client and the session comes back as Set-Cookie on the action's
 * response. LoginClient nonetheless waited for the BROWSER client to emit
 * `SIGNED_IN` — an event that can never fire, because the browser client never
 * signed in — and backed that with a blind `setTimeout(..., 2000)` fallback
 * that navigated regardless of whether a session existed. When it didn't,
 * /home's guard immediately bounced the user to /login?redirectTo=%2Fhome:
 * the loop users reported, always preceded by a "Welcome back" toast that
 * proved nothing.
 *
 * These tests pin the two properties that matter and would each have caught it:
 *   1. no blind timer / SIGNED_IN dependency remains in the login path
 *   2. navigation happens only after the server confirms the session round-trips
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rawSource = readFileSync(path.join(process.cwd(), 'app/login/LoginClient.tsx'), 'utf-8');

/**
 * Strip comments before asserting. The fix documents the old broken approach in
 * prose (why SIGNED_IN can't fire, what the 2s timer did), so a naive substring
 * search would match the explanation rather than live code.
 */
const loginClientSource = rawSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('login redirect (post-sign-in navigation)', () => {
  it('does not wait for a browser SIGNED_IN event after a server-side sign-in', () => {
    // The password sign-in path must not depend on onAuthStateChange: the
    // browser client never performs that sign-in, so the event never arrives.
    const passwordFlow = loginClientSource.slice(
      loginClientSource.indexOf('const onSubmit'),
      loginClientSource.indexOf('const handleResendVerification'),
    );

    expect(passwordFlow).not.toContain('onAuthStateChange');
    expect(passwordFlow).not.toContain('SIGNED_IN');
  });

  it('does not use a blind timer to trigger the post-login redirect', () => {
    const passwordFlow = loginClientSource.slice(
      loginClientSource.indexOf('const onSubmit'),
      loginClientSource.indexOf('const handleResendVerification'),
    );

    // The original bug was `setTimeout(() => { window.location.href = ... }, 2000)`.
    // Assert no timer schedules a navigation in this flow at all.
    expect(passwordFlow).not.toMatch(/setTimeout\([\s\S]*?window\.location/);
    expect(passwordFlow).not.toContain('2000');
  });

  it('confirms the session before navigating, and only then shows success', () => {
    const passwordFlow = loginClientSource.slice(
      loginClientSource.indexOf('const onSubmit'),
      loginClientSource.indexOf('const handleResendVerification'),
    );

    const confirmAt = passwordFlow.indexOf('confirmSessionEstablished');
    const successAt = passwordFlow.indexOf('welcomeBack');
    const navigateAt = passwordFlow.indexOf('window.location.href');

    expect(confirmAt).toBeGreaterThan(-1);
    // "Welcome back" must not be claimed before persistence is proven.
    expect(confirmAt).toBeLessThan(successAt);
    // And navigation must come after both.
    expect(successAt).toBeLessThan(navigateAt);
  });

  it('stays on the login page with a real error when persistence fails', () => {
    const passwordFlow = loginClientSource.slice(
      loginClientSource.indexOf('const onSubmit'),
      loginClientSource.indexOf('const handleResendVerification'),
    );

    // On the failure branch: surface an error and return, rather than
    // redirecting into a guard that will reject the user.
    expect(passwordFlow).toContain('loginErrorSessionNotPersisted');
    expect(passwordFlow).toMatch(/if \(!sessionConfirmed\)[\s\S]*?return;/);
  });

  it('verifies the session against a server endpoint, not browser-local state', () => {
    // The check must be server-side: browser-local storage can hold a session
    // the server cannot read back, which is exactly the failure mode here.
    expect(loginClientSource).toContain('API_ROUTES.AUTH.USER');
    expect(loginClientSource).toMatch(/credentials:\s*'include'/);
    expect(loginClientSource).toMatch(/cache:\s*'no-store'/);
  });

  it('treats a 200 with a null user as "not established"', () => {
    // /api/auth/user returns 200 + { user: null } when unauthenticated, so an
    // ok status alone is not proof — the user object is what counts.
    const helper = loginClientSource.slice(
      loginClientSource.indexOf('async function confirmSessionEstablished'),
      loginClientSource.indexOf('export default function LoginClient'),
    );

    expect(helper).toMatch(/payload\?\.data\?\.user/);
    expect(helper).toContain('return false');
  });
});
