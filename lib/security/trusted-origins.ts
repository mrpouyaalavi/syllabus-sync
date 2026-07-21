/**
 * Explicit cross-origin allowlist for sibling apps in the Syllabus Sync
 * ecosystem (e.g. Sylla at https://sylla.syllabus-sync.app).
 *
 * WHY THIS EXISTS
 * ---------------
 * Two places need to trust a *small, explicit* set of external origins:
 *   1. CSRF origin/referer validation (`lib/security/csrf.ts`) — so a sibling
 *      app on another subdomain can legitimately talk to our endpoints.
 *   2. Post-login redirect validation (`isValidRedirect` in
 *      `lib/utils/security.ts`) — so a signed-out Sylla CTA can bounce the user
 *      to our login page and we can safely return them to Sylla afterwards.
 *
 * SECURITY MODEL
 * --------------
 * - Origins are read ONLY from the `NEXT_PUBLIC_TRUSTED_ORIGINS` env var
 *   (comma-separated). Nothing is trusted implicitly and there is NO wildcard.
 * - Each entry is parsed with the URL constructor and normalized to its
 *   canonical `origin` (scheme + host + port). Malformed entries are dropped.
 * - Only `http:`/`https:` schemes are accepted.
 *
 * This module is intentionally framework-free (no next/server imports) so it can
 * be used from both server code (CSRF) and client code (redirect validation).
 */

/**
 * Parse a comma-separated origin list into a normalized, de-duplicated array of
 * origins. Invalid or non-http(s) entries are silently discarded.
 */
export function parseTrustedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];

  const seen = new Set<string>();

  for (const part of raw.split(',')) {
    const candidate = part.trim();
    if (!candidate) continue;

    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      seen.add(url.origin);
    } catch {
      // Ignore malformed entries — never trust something we can't parse.
    }
  }

  return [...seen];
}

/**
 * The configured trusted external origins for this deployment.
 * Empty by default (local dev / single-app deployments).
 */
export function getTrustedExternalOrigins(): string[] {
  return parseTrustedOrigins(process.env.NEXT_PUBLIC_TRUSTED_ORIGINS);
}

/**
 * True when `origin` (an already-normalized origin string, e.g.
 * "https://sylla.syllabus-sync.app") is in the configured allowlist.
 */
export function isTrustedExternalOrigin(origin: string): boolean {
  return getTrustedExternalOrigins().includes(origin);
}
