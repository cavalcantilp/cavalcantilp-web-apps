const CACHE_NAME = 'cavalcanti-v1';

// Fichiers à mettre en cache pour le mode hors-ligne
const ASSETS = [
  '/',
  '/index.html',
  '/logo.png',
  '/manifest.json'
];

// 1. Installation du Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// 2. Nettoyage des anciens caches lors des mises à jour
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Interception des requêtes (Réseau d'abord, Cache en secours)
self.addEventListener('fetch', (event) => {
  // On ignore les requêtes non-GET ou externes
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Copie de la réponse dans le cache si la requête réussit
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Utilisation du cache si le réseau échoue (hors-ligne)
        return caches.match(event.request);
      })
  );
});

