const ASSETS = __ASSETS__;
const PREFIX = `vegas-itinerary:${self.registration.scope}:`;
const CACHE = PREFIX + '__VERSION__';
const assetURL = path => new URL(path, self.registration.scope).href;

async function saveAssets() {
    const entries = await Promise.all(Object.entries(ASSETS).map(async ([path, expected]) => {
        const response = await fetch(assetURL(path), { cache: 'reload' });
        if (!response.ok) throw new Error(`Could not save ${path}`);
        const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
        const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== expected) throw new Error(`Incomplete deployment: ${path}`);
        return [assetURL(path), response];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        try {
            await saveAssets();
            // A verified cache is complete, so it is safe to replace the old worker.
            await self.skipWaiting();
        } catch (error) {
            await caches.delete(CACHE);
            throw error;
        }
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await self.clients.claim();
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
        // Reload pages still displaying the previous cached build. This avoids the
        // cache-first worker serving stale inline CSS and JavaScript after refresh.
        const root = new URL(self.registration.scope);
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        await Promise.all(windows
            .filter(client => {
                const url = new URL(client.url);
                return url.origin === root.origin && url.pathname.startsWith(root.pathname);
            })
            .map(client => client.navigate(client.url)));
    })());
});

self.addEventListener('message', event => {
    if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
    if (event.data?.type === 'REPAIR_OFFLINE') {
        event.waitUntil(saveAssets().then(
            () => event.ports[0]?.postMessage({ ready: true }),
            () => event.ports[0]?.postMessage({ ready: false })
        ));
    }
    if (event.data?.type === 'CHECK_OFFLINE') {
        event.waitUntil((async () => {
            const cache = await caches.open(CACHE);
            const complete = (await Promise.all(Object.keys(ASSETS).map(path => cache.match(assetURL(path))))).every(Boolean);
            event.ports[0]?.postMessage({ ready: complete });
        })());
    }
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    const root = new URL(self.registration.scope);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return;
    const path = url.pathname.slice(root.pathname.length) || 'index.html';
    if (!Object.hasOwn(ASSETS, path)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        return await cache.match(assetURL(path)) || fetch(event.request);
    })());
});
