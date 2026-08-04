import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

// jsdom exposes no `crypto.getRandomValues`, which the Edge-runtime crypto
// helpers in lib/security/edge-crypto.ts depend on. Both Node and the Workers
// runtime provide it natively, so this only fills the gap in the test
// environment rather than weakening the production implementation.
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (message?.includes('--localstorage-file')) {
    return;
  }
  return originalEmitWarning(warning as string, ...(args as [string]));
}) as typeof process.emitWarning;

if (!globalThis.localStorage || typeof globalThis.localStorage.setItem !== 'function') {
  const storage: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      Object.keys(storage).forEach((key) => delete storage[key]);
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  };
}

if (!globalThis.fetch) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const responseBody = method === 'GET' ? [] : (body ?? {});
    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
    } as Response;
  }) as typeof fetch;
}

// Mock IntersectionObserver for framer-motion's whileInView feature
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];

    constructor(
      private callback: IntersectionObserverCallback,
      private options?: IntersectionObserverInit,
    ) {}

    observe(target: Element): void {
      // Immediately trigger with isIntersecting: true to show elements
      this.callback(
        [
          {
            isIntersecting: true,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRatio: 1,
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            target,
            time: Date.now(),
          },
        ],
        this,
      );
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
}

// Mock matchMedia for prefers-reduced-motion and other media queries
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }) as MediaQueryList;
}

if (typeof HTMLAnchorElement !== 'undefined') {
  HTMLAnchorElement.prototype.click = function () {};
}

// JSDOM does not implement scrollIntoView — stub it so components that call it don't throw
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof window !== 'undefined') {
  const currentLocation = window.location;
  const safeLocation = {
    ...currentLocation,
    assign: () => {},
    replace: () => {},
    reload: () => {},
    get href() {
      return currentLocation.href;
    },
    set href(_value: string) {},
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: safeLocation,
  });
}
