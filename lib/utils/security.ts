import type { PasswordStrength } from '@/lib/types';
import { APP_CONFIG } from '@/lib/config';
import { getTrustedExternalOrigins } from '@/lib/security/trusted-origins';
import zxcvbn from 'zxcvbn';

// Centralized whitelist - easier to manage
export const SAFE_REDIRECT_PATHS = [
  '/dashboard',
  '/home',
  '/calendar',
  '/feed',
  '/map',
  '/units',
  '/manage-profiles',
  '/settings',
  '/setup',
  '/onboarding',
] as const;

export function isValidRedirect(url: string | null): boolean {
  if (!url) return false;

  // 1. Check if it's a relative path (starts with / but not //)
  const isRelative = url.startsWith('/') && !url.startsWith('//');

  // 2. Allow base URL
  const isBaseUrl = url.startsWith(APP_CONFIG.url);

  // 3. Allow explicitly-trusted sibling apps (e.g. Sylla on another subdomain).
  //    These are absolute URLs whose origin must exactly match an operator-
  //    configured entry in NEXT_PUBLIC_TRUSTED_ORIGINS — never a wildcard, and
  //    never inferred from the URL itself. Any path on a trusted origin is
  //    allowed, since we trust the origin wholesale for the SSO hand-off.
  if (!isRelative && !isBaseUrl) {
    return isTrustedExternalRedirect(url);
  }

  // 4. Whitelist check for internal destinations (Strict Mode)
  // Remove query params for checking
  const path = url.split('?')[0].replace(APP_CONFIG.url, '');

  return SAFE_REDIRECT_PATHS.some((safePath) => path.startsWith(safePath));
}

/**
 * True when `url` is an absolute URL whose origin is in the configured
 * cross-origin allowlist (`NEXT_PUBLIC_TRUSTED_ORIGINS`). Protocol-relative
 * URLs (`//evil.com`) and anything unparseable are rejected.
 */
function isTrustedExternalRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return getTrustedExternalOrigins().includes(parsed.origin);
  } catch {
    return false;
  }
}

// Password strength calculation
// Hybrid approach: zxcvbn for logic, mapped to UI needs + backward compatibility
export function calculatePasswordStrength(password: string) {
  if (!password) {
    return {
      score: 0,
      label: 'Empty',
      color: 'bg-gray-200',
      strength: 'weak' as PasswordStrength,
      feedback: [] as string[],
    };
  }

  const result = zxcvbn(password);
  const score = result.score;

  // Map zxcvbn score (0-4) to UI colors/labels
  const styles = [
    { label: 'Risky', color: 'bg-red-500' }, // 0
    { label: 'Weak', color: 'bg-orange-500' }, // 1
    { label: 'Fair', color: 'bg-yellow-500' }, // 2
    { label: 'Good', color: 'bg-blue-500' }, // 3
    { label: 'Strong', color: 'bg-green-500' }, // 4
  ];

  // Backward compatibility for existing components
  let strength: PasswordStrength = 'weak';
  if (score === 2) strength = 'fair';
  if (score === 3) strength = 'good';
  if (score >= 4) strength = 'strong';

  return {
    score,
    ...styles[score],
    strength,
    feedback: result.feedback.warning ? [result.feedback.warning] : [],
  };
}
