import { afterEach, describe, expect, it } from 'vitest';
import { isValidRedirect } from '@/lib/utils/security';

describe('isValidRedirect', () => {
  const ORIGINAL_ENV = { ...process.env };

  function setEnv(updates: Record<string, string>) {
    process.env = { ...process.env, ...updates } as NodeJS.ProcessEnv;
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('accepts whitelisted internal paths', () => {
    expect(isValidRedirect('/home')).toBe(true);
    expect(isValidRedirect('/calendar')).toBe(true);
    expect(isValidRedirect('/settings/security')).toBe(true);
  });

  it('rejects null, unknown internal paths, and protocol-relative URLs', () => {
    expect(isValidRedirect(null)).toBe(false);
    expect(isValidRedirect('/not-a-real-area')).toBe(false);
    expect(isValidRedirect('//evil.com')).toBe(false);
  });

  it('rejects external origins that are NOT in the allowlist (no open redirect)', () => {
    setEnv({ NEXT_PUBLIC_TRUSTED_ORIGINS: 'https://sylla.syllabus-sync.app' });
    expect(isValidRedirect('https://evil.example.com/phish')).toBe(false);
    expect(isValidRedirect('https://sylla.syllabus-sync.app.evil.com')).toBe(false);
  });

  it('accepts any path on an explicitly allowlisted external origin', () => {
    setEnv({ NEXT_PUBLIC_TRUSTED_ORIGINS: 'https://sylla.syllabus-sync.app' });
    expect(isValidRedirect('https://sylla.syllabus-sync.app')).toBe(true);
    expect(isValidRedirect('https://sylla.syllabus-sync.app/study/plan?id=1')).toBe(true);
  });

  it('rejects external origins when no allowlist is configured', () => {
    // NEXT_PUBLIC_TRUSTED_ORIGINS intentionally unset here.
    expect(isValidRedirect('https://sylla.syllabus-sync.app')).toBe(false);
  });
});
