#!/usr/bin/env node
/**
 * Predeploy guard: fails fast, with a project-specific explanation, if the
 * Cloudflare deploy step is about to run without a completed OpenNext build.
 *
 * `wrangler deploy` unconditionally auto-delegates to `opennextjs-cloudflare
 * deploy` whenever `next.config.ts` + `open-next.config.ts` + an installed
 * `@opennextjs/cloudflare` are all present (see wrangler's own
 * `isOpenNextProject()` — this repo always matches). That delegate then looks
 * for `.open-next/.build/open-next.config.edge.mjs` (see
 * `retrieveCompiledConfig()` in `@opennextjs/cloudflare`) and exits with
 * "Could not find compiled Open Next config, did you run the build command?"
 * if it's missing — accurate, but generic. That file is produced only by
 * `opennextjs-cloudflare build` (i.e. `npm run cf:build`), never by a plain
 * `next build`.
 *
 * This exists because Cloudflare Workers Builds runs a separate Build command
 * and Deploy command as two independent pipeline steps. If the dashboard's
 * Build command is ever set to `npm run build` (plain Next build only)
 * instead of `npm run cf:build`, the Deploy step reaches this exact failure —
 * this script catches it immediately, before wrangler even starts, with a
 * message that names the fix.
 *
 * Wire this in front of the Cloudflare dashboard's Deploy command:
 *   node tools/cloudflare/verify-open-next-output.mjs && npx wrangler deploy
 *
 * Local/standard builds are unaffected: nothing calls this script except the
 * Cloudflare deploy path.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

const COMPILED_CONFIG = path.join('.open-next', '.build', 'open-next.config.edge.mjs');
const WORKER_ENTRY = path.join('.open-next', 'worker.js');

const missing = [COMPILED_CONFIG, WORKER_ENTRY].filter((p) => !existsSync(p));

if (missing.length) {
  console.error(
    '\n[cf:verify-output] Cloudflare deployment requires `npm run cf:build` before deploy.\n',
  );
  console.error(`  Missing: ${missing.join(', ')}\n`);
  console.error(
    '  This means the Cloudflare Build command produced a plain `next build`\n' +
      '  (only .next/) instead of the OpenNext Cloudflare build (.next/ AND\n' +
      '  .open-next/). `wrangler deploy` auto-detects this as an OpenNext\n' +
      "  project and will fail with a generic \"Could not find compiled Open\n" +
      '  Next config\" error — this check exists to explain why up front.\n\n' +
      '  Fix: set the Cloudflare Workers Builds "Build command" to\n' +
      '  `npm run cf:build`, not `npm run build`. `npm run build` must stay a\n' +
      '  plain `next build` — it is also what OpenNext invokes internally\n' +
      '  (see open-next.config.ts) — so do not change it to run the\n' +
      '  Cloudflare build itself; that reintroduces the recursive-build\n' +
      '  incident this architecture was fixed to avoid.\n',
  );
  process.exit(1);
}

console.log('[cf:verify-output] ok — OpenNext build output present, proceeding to deploy');
