/**
 * Edge-runtime-safe cryptographic primitives.
 *
 * The root proxy/middleware runs on the Edge runtime so the app can be built by
 * the OpenNext Cloudflare adapter, which rejects Node.js middleware. Node's
 * `crypto` module (`randomBytes`, `createHash`) is unavailable there, so these
 * helpers use the Web Crypto API plus `@noble/hashes` instead.
 *
 * `@noble/hashes` is used rather than `crypto.subtle.digest` deliberately:
 * `subtle` is async, and making the CSRF hash async would force
 * `validateCSRF` — and its ~29 call sites — to become async. The noble
 * implementation is synchronous and audited, so token validation stays sync and
 * the call sites are untouched.
 *
 * Output is byte-identical to the previous Node implementation, so CSRF tokens
 * and cookies issued before this change remain valid.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** Cryptographically secure random bytes, Web Crypto backed. */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Random bytes as lowercase hex. Replaces `randomBytes(n).toString('hex')`. */
export function randomHex(length: number): string {
  return bytesToHex(randomBytes(length));
}

/** Random bytes as base64. Replaces `randomBytes(n).toString('base64')`. */
export function randomBase64(length: number): string {
  const bytes = randomBytes(length);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * SHA-256 of a UTF-8 string as lowercase hex.
 * Replaces `createHash('sha256').update(input).digest('hex')`.
 */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}
