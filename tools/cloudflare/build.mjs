#!/usr/bin/env node
/**
 * Build entrypoint that picks the right build for the current platform.
 *
 * Cloudflare Workers Builds runs the repository's `npm run build` and then a
 * separate deploy command. `next build` alone only produces `.next/`, so the
 * deploy step fails with "Could not find compiled Open Next config" — the
 * Worker needs `.open-next/`. Rather than depend on someone remembering to set
 * a non-default build command in the dashboard, detect the Cloudflare build
 * environment here and run the OpenNext build (which runs `next build`
 * internally) instead.
 *
 * Everywhere else — local, Docker, Vercel — this is a plain `next build`.
 */

import { spawnSync } from 'node:child_process';

// WORKERS_CI is set by Workers Builds; CF_PAGES covers the Pages builder.
// CF_FORCE_OPENNEXT_BUILD is an explicit manual override.
const isCloudflareBuild = Boolean(
  process.env.WORKERS_CI || process.env.CF_PAGES || process.env.CF_FORCE_OPENNEXT_BUILD,
);

const [command, args] = isCloudflareBuild
  ? ['npx', ['opennextjs-cloudflare', 'build']]
  : ['npx', ['next', 'build', '--webpack']];

console.log(
  isCloudflareBuild
    ? '[build] Cloudflare build environment detected — running the OpenNext build'
    : '[build] running the standard Next.js build',
);

if (isCloudflareBuild) {
  // Surface misconfigured build variables before the long build, not after.
  const check = spawnSync('node', ['tools/cloudflare/check-build-env.mjs'], { stdio: 'inherit' });
  if (check.status !== 0) process.exit(check.status ?? 1);
}

const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
