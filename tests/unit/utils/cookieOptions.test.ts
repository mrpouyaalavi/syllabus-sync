import { afterEach, describe, expect, it } from 'vitest';
import {
  getAuthCookieDomain,
  getSharedCookieOptions,
  withSharedCookieDomain,
} from '@/lib/supabase/cookie-options';

describe('lib/supabase/cookie-options', () => {
  const ORIGINAL_ENV = { ...process.env };

  function setEnv(updates: Record<string, string>) {
    // `process.env.NODE_ENV` is typed as readonly in TS; replace the env object instead.
    process.env = { ...process.env, ...updates } as NodeJS.ProcessEnv;
  }

  function deleteEnv(key: string) {
    const next = { ...process.env };
    delete next[key];
    process.env = next as NodeJS.ProcessEnv;
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns undefined when NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is not set', () => {
    deleteEnv('NEXT_PUBLIC_AUTH_COOKIE_DOMAIN');
    setEnv({ NODE_ENV: 'production' });

    expect(getAuthCookieDomain()).toBeUndefined();
    expect(getSharedCookieOptions()).toBeUndefined();
  });

  it('returns undefined outside production even when the domain is configured (local dev)', () => {
    setEnv({ NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: '.syllabus-sync.app', NODE_ENV: 'development' });

    expect(getAuthCookieDomain()).toBeUndefined();
    expect(getSharedCookieOptions()).toBeUndefined();
    // Local dev cookie options should pass through untouched.
    const options = { maxAge: 3600, sameSite: 'lax' as const };
    expect(withSharedCookieDomain(options)).toEqual(options);
  });

  it('returns the shared domain and cookie options in production', () => {
    setEnv({ NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: '.syllabus-sync.app', NODE_ENV: 'production' });

    expect(getAuthCookieDomain()).toBe('.syllabus-sync.app');
    expect(getSharedCookieOptions()).toEqual({
      domain: '.syllabus-sync.app',
      path: '/',
      sameSite: 'lax',
      secure: true,
    });
  });

  it('merges the shared domain into existing options without dropping supabase-provided fields', () => {
    setEnv({ NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: '.syllabus-sync.app', NODE_ENV: 'production' });

    const supabaseOptions = {
      maxAge: 3600,
      expires: new Date('2030-01-01'),
      sameSite: 'lax' as const,
      secure: true,
      httpOnly: true,
    };

    expect(withSharedCookieDomain(supabaseOptions)).toEqual({
      ...supabaseOptions,
      path: '/',
      domain: '.syllabus-sync.app',
    });
  });

  it('preserves an explicit path from supabase instead of forcing "/"', () => {
    setEnv({ NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: '.syllabus-sync.app', NODE_ENV: 'production' });

    expect(withSharedCookieDomain({ path: '/custom' })).toEqual({
      path: '/custom',
      domain: '.syllabus-sync.app',
    });
  });
});
