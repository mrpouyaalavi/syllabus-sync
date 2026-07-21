import { afterEach, describe, expect, it } from 'vitest';
import {
  getTrustedExternalOrigins,
  isTrustedExternalOrigin,
  parseTrustedOrigins,
} from '@/lib/security/trusted-origins';

describe('lib/security/trusted-origins', () => {
  const ORIGINAL_ENV = { ...process.env };

  function setEnv(updates: Record<string, string>) {
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

  it('returns an empty list for empty/undefined input', () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
    expect(parseTrustedOrigins(null)).toEqual([]);
    expect(parseTrustedOrigins('')).toEqual([]);
    expect(parseTrustedOrigins('   ')).toEqual([]);
  });

  it('normalizes entries to their canonical origin and de-duplicates', () => {
    expect(
      parseTrustedOrigins(
        'https://sylla.syllabus-sync.app/path?x=1, https://www.syllabus-sync.app , https://sylla.syllabus-sync.app',
      ),
    ).toEqual(['https://sylla.syllabus-sync.app', 'https://www.syllabus-sync.app']);
  });

  it('drops malformed and non-http(s) entries without throwing', () => {
    expect(
      parseTrustedOrigins(
        'not a url, ftp://example.com, javascript:alert(1), https://ok.example.com',
      ),
    ).toEqual(['https://ok.example.com']);
  });

  it('reads the allowlist from NEXT_PUBLIC_TRUSTED_ORIGINS', () => {
    setEnv({
      NEXT_PUBLIC_TRUSTED_ORIGINS:
        'https://sylla.syllabus-sync.app,https://syllabus-sync.app,https://www.syllabus-sync.app',
    });

    expect(getTrustedExternalOrigins()).toEqual([
      'https://sylla.syllabus-sync.app',
      'https://syllabus-sync.app',
      'https://www.syllabus-sync.app',
    ]);
    expect(isTrustedExternalOrigin('https://sylla.syllabus-sync.app')).toBe(true);
    expect(isTrustedExternalOrigin('https://evil.example.com')).toBe(false);
  });

  it('returns an empty allowlist when the env var is unset', () => {
    deleteEnv('NEXT_PUBLIC_TRUSTED_ORIGINS');
    expect(getTrustedExternalOrigins()).toEqual([]);
    expect(isTrustedExternalOrigin('https://sylla.syllabus-sync.app')).toBe(false);
  });
});
