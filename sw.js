/* Ovid Calculator service worker.
   Caches the app shell only — the 16 MB background video is deliberately
   left to the network so installing the app stays cheap. */

const CACHE = "ovid-shell-v2";

const SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./myJava.js",
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

    // never cache the video or cross-origin requests (fonts, etc.)
    if (url.origin !== self.location.origin || url.pathname.endsWith(".mp4")) return;

    // network-first so updates land immediately, cache as offline fallback
    event.respondWith(
        fetch(request)
            .then(response => {
                const copy = response.clone();
                caches.open(CACHE).then(cache => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request).then(hit => hit || caches.match("./index.html")))
    );
});
