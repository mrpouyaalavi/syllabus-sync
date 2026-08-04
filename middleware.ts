// middleware.ts — root request interceptor.
//
// This uses the `middleware` file convention rather than Next 16's newer
// `proxy` convention *deliberately*. `proxy` is hard-wired to the Node.js
// runtime ("The proxy runtime is nodejs, and it cannot be configured"), and the
// OpenNext Cloudflare adapter rejects Node.js middleware outright, so a `proxy`
// file makes the app undeployable to Cloudflare Workers. The Next 16 upgrade
// guide covers exactly this case: "If you want to continue using the edge
// runtime, keep using middleware."
//
// Keep this file free of Node-only APIs. The crypto used downstream lives in
// lib/security/edge-crypto.ts and is Web Crypto based for this reason.
import { proxy as requestHandler } from '@/lib/proxy';

export const middleware = requestHandler;

// The matcher must be declared in this file — Next does not follow re-exports.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/ (all Next.js internals, including HMR websocket endpoints)
     * - favicon.ico (favicon file)
     * - public folder static assets
     */
    '/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest|woff2?|ttf|eot|ico|json|txt)$).*)',
  ],
};
