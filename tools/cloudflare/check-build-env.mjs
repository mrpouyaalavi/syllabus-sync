#!/usr/bin/env node
/**
 * Fails the Cloudflare build when public build-time configuration is missing.
 *
 * `NEXT_PUBLIC_*` values are inlined by Next.js during `next build`. A Worker
 * runtime variable of the same name is read far too late and has no effect on
 * the bundle. If NEXT_PUBLIC_APP_URL is absent at build time, lib/config.ts
 * falls back to http://localhost:3000, which then flows into `metadataBase`,
 * the Open Graph image URL and the JSON-LD organisation logo — producing a
 * deploy that succeeds while serving localhost metadata and stale branding.
 *
 * Failing loudly here is the point: a red build is recoverable, a silently
 * mis-branded production deploy is not.
 *
 * Set these as BUILD environment variables in Workers Builds (not as Worker
 * runtime variables). Skip with CF_SKIP_ENV_CHECK=1 for local experiments.
 */

const REQUIRED = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

// Not fatal, but each one silently disables a feature if missing at build time.
const RECOMMENDED = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_AUTH_COOKIE_DOMAIN',
  'NEXT_PUBLIC_TRUSTED_ORIGINS',
  'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
  'NEXT_PUBLIC_GOOGLE_MAP_ID',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_SYLLA_URL',
];

if (process.env.CF_SKIP_ENV_CHECK === '1') {
  console.log('[cf:check-env] skipped via CF_SKIP_ENV_CHECK=1');
  process.exit(0);
}

const missing = REQUIRED.filter((k) => !process.env[k]);
const absentRecommended = RECOMMENDED.filter((k) => !process.env[k]);
const problems = [];

if (missing.length) {
  problems.push(`missing required build variables: ${missing.join(', ')}`);
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL;
// Only enforce the public-URL shape when building for deployment. Local
// `cf:build` runs against .env.local, where localhost is correct.
const enforcingProductionUrl = process.env.CF_EXPECT_PUBLIC_URL === '1';

if (appUrl && enforcingProductionUrl) {
  if (!appUrl.startsWith('https://')) {
    problems.push(`NEXT_PUBLIC_APP_URL must be https:// (received "${appUrl}")`);
  }
  if (/localhost|127\.0\.0\.1/.test(appUrl)) {
    problems.push(`NEXT_PUBLIC_APP_URL must not point at localhost (received "${appUrl}")`);
  }
  if (/vercel\.app|mq\.edu\.au/.test(appUrl)) {
    problems.push(`NEXT_PUBLIC_APP_URL must be the app's own domain (received "${appUrl}")`);
  }
}

if (problems.length) {
  console.error('\n[cf:check-env] Cloudflare build environment is not ready:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\nSet these as BUILD environment variables in the Workers Builds settings.\n' +
      'Worker runtime variables are NOT visible to `next build`.\n',
  );
  process.exit(1);
}

console.log(`[cf:check-env] ok — NEXT_PUBLIC_APP_URL=${appUrl}`);
if (absentRecommended.length) {
  console.warn(`[cf:check-env] not set (feature will be disabled): ${absentRecommended.join(', ')}`);
}
