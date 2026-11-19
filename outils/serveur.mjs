// Petit serveur de fichiers statiques pour le développement et les tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

export function demarrer(port = 0) {
  const serveur = createServer(async (requete, reponse) => {
    const chemin = decodeURIComponent(new URL(requete.url, 'http://x').pathname);
    const fichier = join(RACINE, normalize(chemin === '/' ? '/index.html' : chemin));
    if (!fichier.startsWith(RACINE)) return reponse.writeHead(403).end();
    try {
      const contenu = await readFile(fichier);
      reponse.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' }).end(contenu);
    } catch {
      reponse.writeHead(404).end('Introuvable');
    }
  });
  return new Promise((ok) => serveur.listen(port, () => ok(serveur)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const serveur = await demarrer(Number(process.env.PORT) || 8080);
  console.log(`Ludopointe : http://localhost:${serveur.address().port}`);
}
