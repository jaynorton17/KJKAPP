const CACHE_NAME = 'kjk-app-shell-v1';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/kjk-icon-192.png',
  '/icons/kjk-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

const canCacheResponse = (response) => (
  response
  && response.ok
  && response.type === 'basic'
);

const networkFirst = async (request, fallbackUrl = '') => {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (canCacheResponse(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
    return fallbackUrl ? cache.match(fallbackUrl) : Response.error();
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  if (['font', 'image', 'manifest', 'script', 'style', 'worker'].includes(request.destination)) {
    event.respondWith(networkFirst(request));
  }
});
