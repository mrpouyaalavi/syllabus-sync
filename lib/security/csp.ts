/**
 * CSP (Content Security Policy) Configuration
 *
 * SECURITY: This module defines the CSP configuration with hash-based script validation
 * and nonce-based CSP for middleware-driven requests.
 *
 * The inline scripts for theme and RTL are static and pre-computed hashes are used
 * instead of 'unsafe-inline' to maintain XSS protection.
 *
 * Nonce-based CSP is used by the root middleware to tag every request with a
 * unique cryptographic nonce, eliminating the need for 'unsafe-inline' entirely.
 */

import { randomBase64 } from './edge-crypto';

// ============================================================================
// NONCE GENERATION
// ============================================================================

/**
 * Generate a cryptographically random nonce for CSP.
 * Used by middleware.ts to create a per-request nonce.
 */
export function generateNonce(): string {
  return randomBase64(16);
}

// ============================================================================
// NONCE-BASED CSP BUILDER
// ============================================================================

/**
 * Build a nonce-based Content Security Policy header value.
 * This replaces 'unsafe-inline' with a per-request nonce for maximum XSS protection.
 *
 * Used by the root middleware.ts on every request.
 */
export function buildNonceCSP(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';

  const directives = [
    "default-src 'self'",

    // Scripts: nonce-based (no unsafe-inline!).
    // NOTE: 'strict-dynamic' intentionally omitted — it causes browsers to
    // ignore host allowlists ('self', maps.googleapis.com, etc.) per the CSP
    // spec, which breaks Google Maps embeds and Next.js chunk loading.
    `script-src 'self' 'nonce-${nonce}' https://maps.googleapis.com https://maps.gstatic.com${isDev ? " 'unsafe-eval'" : ''}`,

    // Styles: 'unsafe-inline' kept because Leaflet, Tailwind, and Next.js
    // all inject dynamic <style> elements that cannot be nonced at runtime.
    // Style-based XSS is far less exploitable than script-based XSS.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,

    // Fonts
    "font-src 'self' data: https://fonts.gstatic.com https://r2cdn.perplexity.ai",

    // Images: self, data, blob, Google Maps tiles
    "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https:",

    // Connect: Supabase, Google Maps JS/Routes, weather, Sentry, HMR in dev
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://weather.googleapis.com https://maps.googleapis.com https://routes.googleapis.com https://places.googleapis.com https://maps.gstatic.com https://*.sentry.io${isDev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,

    // Frame sources retained for conservative compatibility with external content.
    "frame-src 'self' https://www.google.com https://maps.google.com",

    // Frame ancestors: prevent clickjacking
    "frame-ancestors 'self'",

    // Disable plugins
    "object-src 'none'",

    // Restrict base tag
    "base-uri 'self'",

    // Form actions: self + Google OAuth
    "form-action 'self' https://accounts.google.com",

    // Workers
    "worker-src 'self' blob:",

    // Manifest
    "manifest-src 'self'",

    // Upgrade in production
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ];

  return directives.join('; ');
}

// ============================================================================
// SCRIPT DEFINITIONS (keep in sync with app/layout.tsx)
// ============================================================================

/**
 * Theme initialization script - prevents flash of wrong theme
 * IMPORTANT: If you modify this script, you must regenerate the hash!
 *
 * To regenerate: Run the script content through SHA-256 and base64 encode:
 * echo -n '<script content>' | openssl dgst -sha256 -binary | base64
 */
export const THEME_SCRIPT = `(function(){try{var stored=localStorage.getItem('theme-storage');var theme='system';if(stored){var parsed=JSON.parse(stored);theme=parsed.state?.theme||'system'}var resolved=theme;if(theme==='system'){resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.classList.add(resolved);document.documentElement.style.colorScheme=resolved}catch(e){}})();`;

/**
 * RTL direction script - sets correct text direction based on language
 * IMPORTANT: If you modify this script, you must regenerate the hash!
 */
export const RTL_SCRIPT = `(function(){try{var stored=localStorage.getItem('language-storage');if(stored){var parsed=JSON.parse(stored);var lang=parsed.state?.language||'en';var rtlLanguages=['fa','ar','ur','he'];if(rtlLanguages.includes(lang)){document.documentElement.dir='rtl';document.documentElement.lang=lang}else{document.documentElement.dir='ltr';document.documentElement.lang=lang}}}catch(e){}})();`;

// ============================================================================
// CSP HASHES
// ============================================================================

/**
 * Pre-computed SHA-256 hashes for inline scripts
 * These MUST be updated if the scripts above are modified!
 *
 * Generate with: echo -n '<script>' | openssl dgst -sha256 -binary | base64
 */
export const CSP_SCRIPT_HASHES = {
  theme: 'sha256-euA/nX7OMJt6hghOJ/qTKFU59who5Fhoj7IWVSgwBss=',
  rtl: 'sha256-7IUh1B8MYhdIeSKtKih/ERxZm0rfT5jNWzQqe73/yeY=',
};

// ============================================================================
// CSP BUILDER
// ============================================================================

export interface CSPOptions {
  /** Include upgrade-insecure-requests directive */
  upgradeInsecure?: boolean;
  /** Additional script sources to allow */
  additionalScriptSrc?: string[];
  /** Additional connect sources to allow */
  additionalConnectSrc?: string[];
  /** Report URI for CSP violations (legacy, use reportTo) */
  reportUri?: string;
  /** Report-To directive for CSP violations (modern browsers) */
  reportTo?: string;
  /** Enable report-only mode (violations logged but not enforced) */
  reportOnly?: boolean;
}

/**
 * Build a Content Security Policy header value
 *
 * SECURITY: CSP reporting helps detect and prevent XSS attacks by monitoring
 * policy violations. Configure CSP_REPORT_URI or CSP_REPORT_TO env vars.
 */
export function buildCSP(options: CSPOptions = {}): string {
  const {
    upgradeInsecure = process.env.NODE_ENV === 'production',
    additionalScriptSrc = [],
    additionalConnectSrc = [],
    reportUri = process.env.CSP_REPORT_URI,
    reportTo = process.env.CSP_REPORT_TO,
  } = options;

  // Build script-src with hashes
  const scriptHashes = Object.values(CSP_SCRIPT_HASHES).map((h) => `'${h}'`);
  const scriptSrc = ["'self'", ...scriptHashes, ...additionalScriptSrc].join(' ');

  const directives = [
    // Default fallback
    "default-src 'self'",

    // Scripts: self + hash-validated inline scripts (NO unsafe-inline!)
    `script-src ${scriptSrc}`,

    // Styles: self + unsafe-inline (required for Tailwind/CSS-in-JS)
    // Note: Styles are less dangerous than scripts for XSS
    "style-src 'self' 'unsafe-inline'",

    // Images: Allow self, data URIs, blobs, and HTTPS
    "img-src 'self' data: blob: https:",

    // Fonts: self and known in-app sources only
    "font-src 'self' data: https://r2cdn.perplexity.ai",

    // Connect: API endpoints, Supabase, Google Maps JS/Routes, weather
    `connect-src 'self' https://*.supabase.co https://weather.googleapis.com https://maps.googleapis.com https://routes.googleapis.com https://places.googleapis.com https://maps.gstatic.com wss://*.supabase.co ${additionalConnectSrc.join(' ')}`.trim(),

    // Frame ancestors: Prevent clickjacking
    "frame-ancestors 'self'",

    // Frame sources: kept for conservative compatibility
    "frame-src 'self' https://www.google.com https://maps.google.com",

    // Base URI: Restrict base tag
    "base-uri 'self'",

    // Form actions: Where forms can submit (Google OAuth may POST back)
    "form-action 'self' https://accounts.google.com",

    // Object sources: Disable plugins
    "object-src 'none'",

    // Upgrade insecure in production
    ...(upgradeInsecure ? ['upgrade-insecure-requests'] : []),

    // Report-To directive (modern browsers, preferred over report-uri)
    ...(reportTo ? [`report-to ${reportTo}`] : []),

    // Report URI if configured (legacy, but still supported)
    ...(reportUri ? [`report-uri ${reportUri}`] : []),
  ];

  return directives.join('; ');
}

/**
 * Build CSP header for development (more permissive)
 * NOTE: Next.js injects many inline scripts for hydration and routing that
 * cannot be pre-hashed. In development, we use unsafe-inline WITHOUT hashes
 * because browsers ignore unsafe-inline when hashes are present.
 */
export function buildDevCSP(): string {
  // In development, skip hash-based validation entirely
  // because unsafe-inline is ignored when hashes are present
  const directives = [
    "default-src 'self'",
    // Scripts: Allow inline and eval for HMR, hydration, Turbopack
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    // Styles: Allow inline for Tailwind/CSS-in-JS
    "style-src 'self' 'unsafe-inline'",
    // Images
    "img-src 'self' data: blob: https:",
    // Fonts
    "font-src 'self' data: https://r2cdn.perplexity.ai",
    // Connect: API endpoints, Supabase, Google Maps JS/Routes, HMR websockets
    "connect-src 'self' https://*.supabase.co https://weather.googleapis.com https://maps.googleapis.com https://routes.googleapis.com https://places.googleapis.com https://maps.gstatic.com wss://*.supabase.co ws://localhost:* ws://127.0.0.1:*",
    // Frame ancestors
    "frame-ancestors 'self'",
    // Frame sources
    "frame-src 'self' https://www.google.com https://maps.google.com",
    // Base URI
    "base-uri 'self'",
    // Form actions (Google OAuth may POST back)
    "form-action 'self' https://accounts.google.com",
    // Object sources
    "object-src 'none'",
  ];

  return directives.join('; ');
}

/**
 * Build CSP header for production (strict)
 *
 * NOTE: 'unsafe-inline' is temporarily required because Next.js App Router
 * injects dynamic inline scripts for hydration and routing that cannot be
 * pre-hashed. This is a known limitation with Next.js + strict CSP.
 *
 * TODO: Migrate to nonce-based CSP when Next.js fully supports it:
 * https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
 */
export function buildProdCSP(): string {
  // Build script-src with 'unsafe-inline' for Next.js compatibility
  // Note: When 'unsafe-inline' is present alongside hashes, modern browsers
  // still require the hashes to match for hash-specified scripts, but will
  // allow other inline scripts. This is a temporary workaround.
  const directives = [
    "default-src 'self'",
    // Scripts: Allow self + unsafe-inline for Next.js hydration scripts + Google Maps
    "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com",
    // Styles: Allow inline for Tailwind/CSS-in-JS
    "style-src 'self' 'unsafe-inline'",
    // Images: Allow self, data URIs, blobs, and HTTPS
    "img-src 'self' data: blob: https:",
    // Fonts: self and known in-app sources
    "font-src 'self' data: https://r2cdn.perplexity.ai",
    // Connect: API endpoints, Supabase, Sentry, routing services
    "connect-src 'self' https://*.supabase.co https://weather.googleapis.com https://maps.googleapis.com https://routes.googleapis.com https://places.googleapis.com https://maps.gstatic.com https://*.sentry.io wss://*.supabase.co",
    // Frame ancestors: Prevent clickjacking
    "frame-ancestors 'self'",
    // Frame sources: allow Google Maps embed
    "frame-src 'self' https://www.google.com https://maps.google.com",
    // Base URI: Restrict base tag
    "base-uri 'self'",
    // Form actions: Where forms can submit (Google OAuth may POST back)
    "form-action 'self' https://accounts.google.com",
    // Object sources: Disable plugins
    "object-src 'none'",
    // Upgrade insecure requests in production
    'upgrade-insecure-requests',
  ];

  // Add report-uri if configured
  const reportUri = process.env.CSP_REPORT_URI;
  const reportTo = process.env.CSP_REPORT_TO;
  if (reportTo) {
    directives.push(`report-to ${reportTo}`);
  }
  if (reportUri) {
    directives.push(`report-uri ${reportUri}`);
  }

  return directives.join('; ');
}

/**
 * Get appropriate CSP based on environment
 */
export function getCSP(): string {
  return process.env.NODE_ENV === 'production' ? buildProdCSP() : buildDevCSP();
}
