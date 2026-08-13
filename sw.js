/* Ovid Calculator service worker.
   The whole app is now a few hundred KB — the background is drawn rather
   than downloaded — so the entire shell is cached and it runs fully offline. */

const CACHE = "ovid-shell-v9";

const SHELL = [
    "./",
    "./index.html",
    "./geometri.html",
    "./geometri.js",
    "./privacy.html",
    "./privacy.js",
    "./theme.js",
    "./fonts/orbitron-latin.woff2",
    "./style.css",
    "./i18n.js",
    "./engine.js",
    "./myJava.js",
    "./sky.js",
    "./community.js",
    "./contributors.json",
    "./manifest.json",
    "./images/icon-192.png",
    "./images/icon-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // never cache cross-origin requests (fonts, etc.)
    if (url.origin !== self.location.origin) return;

    // network-first so updates land immediately, cache as offline fallback
    event.respondWith(
        fetch(request)
            .then(response => {
                /* Only a genuine same-origin success is worth keeping. The
                   previous version cached whatever came back, so a single
                   transient 404 or 502 was written into the offline cache
                   and then served from it indefinitely — the error outlived
                   the outage that caused it. Opaque and redirect responses
                   are skipped for the same reason: their status cannot be
                   inspected, so they cannot be trusted as a fallback. */
                if (response.ok && response.type === "basic") {
                    const copy = response.clone();
                    event.waitUntil(
                        caches.open(CACHE)
                            .then(cache => cache.put(request, copy))
                            .catch(() => { /* eviction or quota — not fatal */ })
                    );
                }
                return response;
            })
            .catch(() => caches.match(request).then(hit => hit || caches.match("./index.html")))
    );
});
