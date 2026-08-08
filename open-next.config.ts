import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext adapter configuration for Cloudflare Workers.
 *
 * `buildCommand` is set explicitly, and this is the actual fix for a
 * production incident, not a style choice — do not remove it.
 *
 * `@opennextjs/aws`'s `buildNextjsApp()` (dist/build/buildNextApp.js) runs
 * `config.buildCommand ?? \`${packager} run build\`` to produce the plain
 * Next.js build it bundles. Left unset, that default is `npm run build` —
 * exactly the script that invokes this Cloudflare build in the first place.
 * `npm run build` used to auto-detect the Cloudflare CI environment and
 * re-invoke `opennextjs-cloudflare build`, which re-ran `npm run build`
 * again, forever, until Cloudflare's 27-minute build timeout killed it.
 * Confirmed via the stack trace from a local, depth-capped reproduction:
 *   buildNextjsApp → build (build.js) → buildCommand (cli/commands/build.js)
 *   Error: Command failed: npm run build
 *
 * `npm run build` is now always a plain `next build` with no Cloudflare
 * detection (see package.json), which alone fixes the recursion. This
 * explicit `buildCommand` is defense-in-depth on top of that: even if
 * `npm run build` is ever changed to do something clever again, OpenNext's
 * internal Next.js build is pinned to a command that can never resolve back
 * to itself.
 *
 * No `incrementalCache` override: every route in this app is server-rendered
 * on demand (only /robots.txt and /sitemap.xml are static), so there's no ISR
 * payload worth persisting. Add one here, with the matching R2 binding in
 * wrangler.jsonc, if ISR is introduced later.
 * See https://opennext.js.org/cloudflare/caching
 */
export default {
  ...defineCloudflareConfig(),
  buildCommand: 'npm run build',
};
