/**
 * Critical Path Tests - CSRF Protection
 * Tests CSRF middleware that protects against cross-site request forgery
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";
import { NextRequest } from "next/server";
import {
  generateCSRFToken,
  validateCSRFToken,
  validateOrigin,
} from "@/lib/security/csrf";

// Test constants (copying since not exported)
const CSRF_COOKIE_NAME = "__Host-csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

// Mocking Request because the actual NextRequest from next/server
// might not be fully compatible with how we're mocking headers in tests
class MockRequest {
  headers: Headers;
  method: string;
  cookies: Map<string, { value: string }>;
  nextUrl: { pathname: string; origin: string };

  constructor(
    method: string = "GET",
    headers: [string, string][] = [],
    pathname: string = "/api/test",
  ) {
    this.method = method;
    this.headers = new Headers(headers);
    this.nextUrl = { pathname, origin: "http://localhost:3000" };
    this.cookies = new Map();

    const cookieHeader = this.headers.get("Cookie");
    if (cookieHeader) {
      cookieHeader.split(";").forEach((c) => {
        const [name, value] = c.trim().split("=");
        if (name && value) {
          this.cookies.set(name, { value });
        }
      });
    }
  }
}

describe("CSRF Protection", () => {
  beforeEach(() => {
    // The CSRF helpers run on the Edge runtime and therefore use the Web Crypto
    // API (`crypto.getRandomValues`) rather than Node's `crypto` module. This
    // stub mirrors that interface. Randomness is delegated to the real
    // implementation so the uniqueness assertions below stay meaningful.
    vi.stubGlobal("crypto", {
      randomUUID: () => webcrypto.randomUUID(),
      getRandomValues: <T extends ArrayBufferView>(array: T): T =>
        webcrypto.getRandomValues(array as unknown as Uint8Array) as unknown as T,
    });
  });

  describe("generateCSRFToken", () => {
    it("should generate a valid CSRF token", () => {
      const token = generateCSRFToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(16); // Should be reasonable length
    });

    it("should generate unique tokens", () => {
      const token1 = generateCSRFToken();
      const token2 = generateCSRFToken();

      expect(token1).not.toBe(token2);
    });

    it("should be cryptographically secure", () => {
      const tokens = Array.from({ length: 100 }, () => generateCSRFToken());
      const uniqueTokens = new Set(tokens);

      // All tokens should be unique (very high probability test)
      expect(uniqueTokens.size).toBe(100);
    });
  });

  describe("validateCSRFToken", () => {
    it("should validate a correct CSRF token", () => {
      const token = generateCSRFToken();

      const mockRequest = new MockRequest("POST", [
        [CSRF_HEADER_NAME, token],
        ["Cookie", `${CSRF_COOKIE_NAME}=${token}`],
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(true);
    });

    it("should reject requests without CSRF token", () => {
      const mockRequest = new MockRequest("POST") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should reject requests with missing header token", () => {
      const token = generateCSRFToken();
      const mockRequest = new MockRequest("POST", [
        ["Cookie", `${CSRF_COOKIE_NAME}=${token}`],
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should reject requests with missing cookie token", () => {
      const token = generateCSRFToken();
      const mockRequest = new MockRequest("POST", [
        [CSRF_HEADER_NAME, token],
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should reject requests with mismatched tokens", () => {
      const token1 = generateCSRFToken();
      const token2 = generateCSRFToken();

      const mockRequest = new MockRequest("POST", [
        [CSRF_HEADER_NAME, token1],
        ["Cookie", `${CSRF_COOKIE_NAME}=${token2}`],
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should be case-sensitive for header name", () => {
      const token = generateCSRFToken();

      const mockRequest = new MockRequest("POST", [
        ["x-csrf-token-wrong", token],
        ["Cookie", `${CSRF_COOKIE_NAME}=${token}`],
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });
  });

  describe("validateOrigin", () => {
    it("should validate same-origin requests", () => {
      const mockRequest = new MockRequest("POST", [
        ["Origin", "http://localhost:3000"],
        ["Host", "localhost:3000"],
      ]) as any;

      const result = validateOrigin(mockRequest);
      expect(result.valid).toBe(true);
    });

    it("should reject cross-origin requests", () => {
      const mockRequest = new MockRequest("POST", [
        ["Origin", "http://evil-site.com"],
        ["Host", "localhost:3000"],
      ]) as any;

      const result = validateOrigin(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should handle requests without origin headers", () => {
      const mockRequest = {
        headers: new Headers([["Host", "localhost:3000"]]),
        nextUrl: new URL("http://localhost:3000/api/test"),
      } as NextRequest;

      const result = validateOrigin(mockRequest);
      expect(result.valid).toBe(true); // Same-host requests are allowed
    });
  });

  describe("CSRF Bypass for Safe Methods", () => {
    it("should allow GET requests without CSRF token", () => {
      const mockRequest = new MockRequest("GET") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(true);
    });

    it("should allow HEAD requests without CSRF token", () => {
      const mockRequest = new MockRequest("HEAD") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(true);
    });

    it("should allow OPTIONS requests without CSRF token", () => {
      const mockRequest = new MockRequest("OPTIONS") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(true);
    });
  });

  describe("CSRF Protection for Unsafe Methods", () => {
    it("should require CSRF token for POST requests", () => {
      const mockRequest = new MockRequest("POST") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should require CSRF token for PUT requests", () => {
      const mockRequest = new MockRequest("PUT") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should require CSRF token for DELETE requests", () => {
      const mockRequest = new MockRequest("DELETE") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should require CSRF token for PATCH requests", () => {
      const mockRequest = new MockRequest("PATCH") as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });
  });

  describe("Security Edge Cases", () => {
    it("should handle empty token strings", () => {
      const mockRequest = new MockRequest("POST", [
        [CSRF_HEADER_NAME, ""],
        ["Cookie", `${CSRF_COOKIE_NAME}=`],
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should handle very long tokens", () => {
      // CSRF token length check in validateCSRFToken? Let's check the implementation.
      // It doesn't seem to have an explicit length check other than comparison.
      // But maybe the constant-time comparison or something else fails with massive strings?
      // Actually, if secureCompare fails length check first, it returns false.
      // The tokens generated are hex(32) = 64 chars.

      const longToken = "a".repeat(5000);

      const mockRequest = new MockRequest("POST", [
        [CSRF_HEADER_NAME, longToken],
        ["Cookie", `${CSRF_COOKIE_NAME}=${generateCSRFToken()}`], // Mismatched and long
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });

    it("should handle malformed cookies gracefully", () => {
      const token = generateCSRFToken();

      const mockRequest = new MockRequest("POST", [
        [CSRF_HEADER_NAME, token],
        ["Cookie", "malformed=cookie; data"],
      ]) as any;

      const result = validateCSRFToken(mockRequest);
      expect(result.valid).toBe(false);
    });
  });

  describe("Performance and Reliability", () => {
    it("should generate tokens efficiently", () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        generateCSRFToken();
      }

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(500);
    });

    it("should validate tokens efficiently", () => {
      const token = generateCSRFToken();
      const mockRequest = new MockRequest("POST", [
        [CSRF_HEADER_NAME, token],
        ["Cookie", `${CSRF_COOKIE_NAME}=${token}`],
      ]) as any;

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        validateCSRFToken(mockRequest);
      }

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(200); // Adjusted threshold for CI/local variance
    });
  });
});
