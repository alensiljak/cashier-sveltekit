/**
 * Service Worker
 */

var cacheName = 'cashier'
var filesToCache = [
  'favicon.png',
  'index.html',
  // 'favicon-16x16.png',
  // 'favicon-96x96.png',
  'icon-64.png',
  'icon-192.png',
  'icon-512.png',
]

self.addEventListener('install', function (e) {
  console.log('[ServiceWorker] Install')
  e.waitUntil(
    caches.open(cacheName).then(function (cache) {
      console.log('[ServiceWorker] Caching app shell')
      return cache.addAll(filesToCache)
    }),
  )
})

self.addEventListener('activate', function (e) {
  console.log('[ServiceWorker] Activate')
  e.waitUntil(
    caches.keys().then(function (keyList) {
      return Promise.all(
        keyList.map(function (key) {
          if (key !== cacheName) {
            console.log('[ServiceWorker] Removing old cache', key)
            return caches.delete(key)
          }
        }),
      )
    }),
  )
  return self.clients.claim()
})

// self.addEventListener('fetch', function (event) {
//     // Do something interesting with the fetch here
// });
