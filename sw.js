const APP_CACHE_NAME = 'ukratimer-app-v2026041801';
const RUNTIME_CACHE_NAME = 'ukratimer-runtime-v2026041801';
const USER_ASSET_CACHE_NAME = 'ukratimer-user-assets-v1';
const LOCAL_BACKGROUND_UPLOAD_PATH_PREFIX = './cached-assets/theme-background-upload-';

const CUBING_SCRAMBLE_MODULE_URL = 'https://cdn.cubing.net/v0/js/cubing/scramble';
const SCRAMBOW_SCRIPT_URL = 'https://unpkg.com/scrambow@1.8.1/dist/scrambow.js';

const LOCAL_PRECACHE_PATHS = [
    './',
    './index.html',
    './manifest.webmanifest?v=2026041801',
    './css/fonts.css?v=2026041801',
    './css/variables.css?v=2026041801',
    './css/base.css?v=2026041801',
    './css/layout.css?v=2026041801',
    './css/scramble.css?v=2026041801',
    './css/timer.css?v=2026041801',
    './css/stats.css?v=2026041801',
    './css/cube.css?v=2026041801',
    './css/graph.css?v=2026041801',
    './css/modal.css?v=2026041801',
    './css/settings.css?v=2026041801',
    './js/app.js?v=2026041801',
    './js/timer.js?v=2026041801',
    './js/scramble.js?v=2026041801',
    './js/subset-scramblers.js?v=2026041801',
    './js/session.js?v=2026041801',
    './js/settings.js?v=2026041801',
    './js/stats.js?v=2026041801',
    './js/modal.js?v=2026041801',
    './js/cube-display.js?v=2026041801',
    './js/graph.js?v=2026041801',
    './js/utils.js?v=2026041801',
    './js/storage.js?v=2026041801',
    './js/db.js?v=2026041801',
    './js/distribution.js?v=2026041801',
    './js/google-drive-sync.js?v=2026041801',
    './resources/comment.svg',
    './resources/comment-off.svg',
    './resources/calendar-date.svg',
    './resources/calendar-date-off.svg',
    './resources/clock.svg',
    './resources/legend.svg',
    './resources/hashtag.svg',
    './resources/hashtag-full.svg',
    './resources/settings.svg',
    './resources/distribution.svg',
    './resources/trash.svg',
    './resources/search.svg',
    './resources/pwa-icon.svg',
    './resources/pwa-icon-192.png',
    './resources/pwa-icon-512.png',
    './resources/pwa-icon-180.png',
    './resources/fonts/L0x5DF4xlVMF-BfR8bXMIjhEq3-cXbKDO1w.woff2',
    './resources/fonts/L0x5DF4xlVMF-BfR8bXMIjhFq3-cXbKDO1w.woff2',
    './resources/fonts/L0x5DF4xlVMF-BfR8bXMIjhGq3-cXbKDO1w.woff2',
    './resources/fonts/L0x5DF4xlVMF-BfR8bXMIjhIq3-cXbKDO1w.woff2',
    './resources/fonts/L0x5DF4xlVMF-BfR8bXMIjhLq3-cXbKD.woff2',
    './resources/fonts/L0x5DF4xlVMF-BfR8bXMIjhPq3-cXbKDO1w.woff2',
    './resources/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7W0Q5n-wU.woff2',
    './resources/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2',
    './resources/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7W0Q5n-wU.woff2',
    './resources/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7W0Q5n-wU.woff2',
    './resources/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7W0Q5n-wU.woff2',
    './resources/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7W0Q5n-wU.woff2',
    './resources/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7W0Q5n-wU.woff2',
    './resources/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx3cwgknk-6nFg.woff2',
    './resources/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwgknk-6nFg.woff2',
    './resources/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2',
    './resources/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxPcwgknk-6nFg.woff2',
    './resources/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxTcwgknk-6nFg.woff2',
    './resources/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx_cwgknk-6nFg.woff2',
];

const EXTERNAL_PRECACHE_REQUESTS = [
    new Request(CUBING_SCRAMBLE_MODULE_URL, { mode: 'cors' }),
    new Request(SCRAMBOW_SCRIPT_URL, { mode: 'no-cors' }),
];

const EXTERNAL_RUNTIME_HOSTS = new Set([
    'cdn.cubing.net',
    'unpkg.com',
]);

function resolveLocalUrl(path) {
    return new URL(path, self.location).toString();
}

function isCacheableResponse(response) {
    return Boolean(response) && (response.ok || response.type === 'opaque');
}

async function addLocalAssetsToCache(cache) {
    await cache.addAll(LOCAL_PRECACHE_PATHS);
}

async function addExternalAssetsToCache(cache) {
    await Promise.allSettled(
        EXTERNAL_PRECACHE_REQUESTS.map(async (request) => {
            const response = await fetch(request);
            if (isCacheableResponse(response)) {
                await cache.put(request, response.clone());
            }
        }),
    );
}

async function networkFirstNavigation(request) {
    const cache = await caches.open(APP_CACHE_NAME);

    try {
        const response = await fetch(request);
        if (isCacheableResponse(response)) {
            await cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        return (
            await caches.match(request)
            || await caches.match(resolveLocalUrl('./'))
            || await caches.match(resolveLocalUrl('./index.html'))
        );
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }

    const response = await fetch(request);
    if (isCacheableResponse(response)) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
    }
    return response;
}

async function staleWhileRevalidate(request, cacheName) {
    const cached = await caches.match(request);

    const networkPromise = fetch(request)
        .then(async (response) => {
            if (isCacheableResponse(response)) {
                const cache = await caches.open(cacheName);
                await cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    if (cached) {
        void networkPromise;
        return cached;
    }

    const response = await networkPromise;
    if (response) return response;

    throw new Error(`Unable to satisfy request for ${request.url}`);
}

async function serveCachedUpload(request) {
    return (
        await caches.match(request)
        || new Response('', { status: 404, statusText: 'Not Found' })
    );
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE_NAME);
        await addLocalAssetsToCache(cache);
        await addExternalAssetsToCache(cache);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames
                .filter((name) => name !== APP_CACHE_NAME && name !== RUNTIME_CACHE_NAME && name !== USER_ASSET_CACHE_NAME)
                .map((name) => caches.delete(name)),
        );
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        void self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (request.url.startsWith(resolveLocalUrl(LOCAL_BACKGROUND_UPLOAD_PATH_PREFIX))) {
        event.respondWith(serveCachedUpload(request));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request, APP_CACHE_NAME));
        return;
    }

    if (request.destination === 'image') {
        event.respondWith(staleWhileRevalidate(request, USER_ASSET_CACHE_NAME));
        return;
    }

    if (EXTERNAL_RUNTIME_HOSTS.has(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE_NAME));
    }
});
