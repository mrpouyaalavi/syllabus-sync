// public/sw.js
// ============================================================================
// SERVICE WORKER - Security-Hardened Caching Strategy
// ============================================================================
// SECURITY: This service worker implements a strict caching policy to prevent
// sensitive data from being cached and exposed after logout or on shared devices.

// Root cause of "browser favicon still shows the old logo": /favicon.ico is
// precached (STATIC_ASSETS below) and served cache-first. The lion/dragon
// brand update replaced its bytes on the server, but this cache version
// wasn't bumped alongside it, so every returning visitor's service worker
// kept serving the favicon it precached before the rebrand — confirmed by
// diffing the live response against app/favicon.ico (identical, correct,
// new artwork) while the browser tab still showed the old icon. Bumping the
// version below changes this file's own bytes, which is what actually
// triggers the browser to install a new worker, precache fresh assets, and
// (via the activate handler further down) delete the old cache — the same
// fix applied for the previous logo change in the "bump SW cache version"
// commit.
const CACHE_NAME = "syllabus-sync-v8"; // Bump version for cache invalidation
const STATIC_CACHE = "syllabus-sync-static-v8";
const DYNAMIC_CACHE = "syllabus-sync-dynamic-v8";
const MAP_CACHE = "syllabus-sync-map-v1"; // Dedicated cache for map assets

// SECURITY: Only cache truly static assets - NO HTML pages that may contain user data
// Exception: /offline is a static shell page with no user data, safe to precache
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/offline", // Offline fallback page - safe to precache (no user data)
];

// Map assets — loaded lazily when user visits the map page, NOT precached.
// Precaching ~12MB of PNGs was stalling first-visit performance.
const MAP_ASSETS = [
  "/images/leaflet/marker-icon.png",
  "/images/leaflet/marker-icon-2x.png",
  "/images/leaflet/marker-shadow.png",
];

// SECURITY: Paths that should NEVER be cached (authenticated/sensitive data)
// This includes ALL dynamic HTML pages, API routes, and auth-related paths
const NO_CACHE_PATHS = [
  "/api/",
  "/auth/",
  // SECURITY: Don't cache any HTML pages - they may contain user-specific data
  "/home",
  "/calendar",
  "/settings",
  "/feed",
  "/map",
  "/login",
  "/signup",
  "/manage-profiles",
];

// SECURITY: File extensions that are safe to cache (static assets only)
const SAFE_TO_CACHE_EXTENSIONS = [
  ".css",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".json", // Only for non-API JSON files like manifest
];

// Install event - cache essential static assets only (map overlays cached on demand)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }),
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, MAP_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old cache versions
          if (!validCaches.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
  // Take control immediately
  self.clients.claim();
});

// Handle messages from the app
self.addEventListener("message", (event) => {
  // Skip waiting and activate immediately when app requests it
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  // SECURITY: Handle cache clear message from app (on logout)
  if (event.data && event.data.type === "CLEAR_ALL_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((cacheNames) => {
          return Promise.all(
            cacheNames.map((cacheName) => caches.delete(cacheName)),
          );
        })
        .then(() => {
          // Notify all clients that caches are cleared
          self.clients.matchAll().then((clients) => {
            clients.forEach((client) => {
              client.postMessage({ type: "CACHES_CLEARED" });
            });
          });
        }),
    );
  }
});

self.addEventListener("push", (event) => {
  const fallbackPayload = {
    title: "Syllabus Sync",
    body: "You have a new reminder.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: "/",
    },
  };

  let payload = fallbackPayload;

  if (event.data) {
    try {
      payload = { ...fallbackPayload, ...event.data.json() };
    } catch (_error) {
      payload = {
        ...fallbackPayload,
        body: event.data.text(),
      };
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/icons/icon-192.png",
      badge: payload.badge || "/icons/icon-192.png",
      tag: payload.tag,
      data: payload.data || { url: "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlPath = event.notification.data?.url || "/";
  const absoluteUrl = new URL(urlPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      let focusedClient = null;

      for (const client of windowClients) {
        if ("focus" in client) {
          if (client.url === absoluteUrl || client.url.startsWith(absoluteUrl)) {
            focusedClient = client;
            break;
          }

          if (!focusedClient) {
            focusedClient = client;
          }
        }
      }

      if (focusedClient) {
        if ("navigate" in focusedClient) {
          await focusedClient.navigate(absoluteUrl);
        }
        await focusedClient.focus();
      } else if (self.clients.openWindow) {
        await self.clients.openWindow(absoluteUrl);
      }

      windowClients.forEach((client) => {
        client.postMessage({
          type: "NOTIFICATION_CLICK",
          tag: event.notification.tag,
          data: event.notification.data || {},
        });
      });
    })(),
  );
});

/**
 * SECURITY: Check if a URL should be cached
 * Only static assets with safe extensions are cacheable
 */
function isCacheable(url) {
  const pathname = url.pathname;

  // Never cache Next.js runtime/chunk assets in SW to avoid stale chunk load errors.
  if (pathname.startsWith("/_next/")) {
    return false;
  }

  // Never cache paths in the no-cache list
  if (NO_CACHE_PATHS.some((path) => pathname.startsWith(path))) {
    return false;
  }

  // Only cache files with safe extensions
  const hasExtension = pathname.includes(".");
  if (hasExtension) {
    return SAFE_TO_CACHE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  }

  // Don't cache navigation requests (HTML pages) - they may contain user data
  return false;
}

/**
 * Check if URL is a map asset (for dedicated map cache)
 */
function isMapAsset(url) {
  const pathname = url.pathname;
  return (
    pathname.startsWith("/maps/") ||
    pathname.startsWith("/images/leaflet/") ||
    MAP_ASSETS.some((asset) => pathname === asset)
  );
}

/**
 * Build a safe offline response for requests that are intentionally network-only.
 * This prevents unhandled fetch rejections while keeping sensitive routes uncached.
 */
function getOfflineResponse(request) {
  const isDocumentRequest =
    request.mode === "navigate" || request.destination === "document";

  if (isDocumentRequest) {
    // Try to serve the precached offline page first
    return caches.match("/offline").then((cachedOffline) => {
      if (cachedOffline) return cachedOffline;
      // Fallback: inline HTML if offline page isn't cached yet
      return new Response(
        '<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head><body><h1>Offline</h1><p>Please reconnect and try again.</p></body></html>',
        {
          status: 503,
          statusText: "Offline",
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    });
  }

  const acceptHeader = request.headers.get("accept") || "";
  const isJsonRequest =
    acceptHeader.includes("application/json") || request.url.includes("/api/");

  if (isJsonRequest) {
    return new Response(JSON.stringify({ error: "Network unavailable" }), {
      status: 503,
      statusText: "Offline",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response("", {
    status: 503,
    statusText: "Offline",
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

// Fetch event - network-first for most content, cache only static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and external requests
  if (request.method !== "GET" || !url.origin.includes(self.location.origin)) {
    return;
  }

  // SECURITY: NEVER cache API, auth routes, or HTML pages - always go to network
  if (!isCacheable(url)) {
    event.respondWith(
      fetch(request).catch(() => {
        // getOfflineResponse may return a Promise (for document requests)
        return Promise.resolve(getOfflineResponse(request));
      }),
    );
    return;
  }

  // Special handling for map assets - cache-first with map cache
  if (isMapAsset(url)) {
    event.respondWith(
      caches.open(MAP_CACHE).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            // Return from cache, update in background
            fetch(request)
              .then((response) => {
                if (response.ok) {
                  cache.put(request, response);
                }
              })
              .catch(() => {
                /* ignore */
              });
            return cachedResponse;
          }

          // Not in cache, fetch and cache
          return fetch(request)
            .then((response) => {
              if (response.ok) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Return offline placeholder if map fails to load
              return new Response("", {
                status: 503,
                statusText: "Map unavailable offline",
              });
            });
        });
      }),
    );
    return;
  }

  // Cache-first strategy ONLY for static assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cache, but also update in background (stale-while-revalidate)
        fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(DYNAMIC_CACHE).then((cache) => {
                cache.put(request, response);
              });
            }
          })
          .catch(() => {
            /* ignore fetch errors for background update */
          });

        return cachedResponse;
      }

      return fetch(request).then((response) => {
        // Don't cache non-successful responses
        if (!response.ok) {
          return response;
        }

        // Cache successful static asset responses
        const responseClone = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => {
          cache.put(request, responseClone);
        });

        return response;
      });
    }),
  );
});
