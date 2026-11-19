// Service worker : garde une copie des fichiers de l'appli pour qu'elle s'ouvre sans réseau.
// Réseau d'abord (les mises à jour arrivent toutes seules), copie locale en secours.
// Les pointages ne passent pas par ici : ils restent dans le stockage du navigateur.

const CACHE = 'ludopointe-fichiers-v1';
const FICHIERS = [
  './',
  'css/style.css',
  'js/app.js',
  'js/pointage.js',
  'js/stockage.js',
  'js/format.js',
  'js/installation.js',
  'manifest.webmanifest',
  'icone.svg',
  'icones/icone-192.png',
  'icones/icone-512.png',
  'icones/icone-pleine-512.png',
  'icones/icone-apple-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(request)
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put(request, copie));
        }
        return reponse;
      })
      .catch(async () => {
        const copie = await caches.match(request, { ignoreSearch: true });
        if (copie) return copie;
        if (request.mode === 'navigate') return caches.match('./');
        return Response.error();
      }),
  );
});
