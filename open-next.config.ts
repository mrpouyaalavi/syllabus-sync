import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext adapter configuration for Cloudflare Workers.
 *
 * No incremental-cache override is configured on purpose. Every route in this
 * application is server-rendered on demand (only /robots.txt and /sitemap.xml
 * are static), so there is no ISR payload worth persisting. Adding the R2
 * incremental cache from the adapter's template would require provisioning an
 * R2 bucket that this app would never meaningfully use.
 *
 * If ISR or `revalidate` is introduced later, add `incrementalCache` here and
 * create the matching R2 bucket + binding in wrangler.jsonc.
 * See https://opennext.js.org/cloudflare/caching
 */
export default defineCloudflareConfig();
