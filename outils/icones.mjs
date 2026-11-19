// Génère les icônes PNG à partir de icone.svg (à relancer si le dessin change) :
//   node outils/icones.mjs
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const svg = await readFile(new URL('../icone.svg', import.meta.url), 'utf8');
// Variante pleine (fond carré, pion plus petit) : iOS et Android la découpent eux-mêmes.
const pleine = svg
  .replace('rx="20" ', '')
  .replace(/<g fill="#c9b995">.*?<\/g>/s, '')
  .replace('translate(12 12) scale(3)', 'translate(19.2 19.2) scale(2.4)');
if (pleine === svg) throw new Error('icone.svg a changé : adapter outils/icones.mjs');

const sorties = [
  ['icone-192.png', svg, 192, true],
  ['icone-512.png', svg, 512, true],
  ['icone-pleine-512.png', pleine, 512, false],
  ['icone-apple-180.png', pleine, 180, false],
];
const navigateur = await chromium.launch();
for (const [nom, source, taille, transparent] of sorties) {
  const page = await navigateur.newPage({ viewport: { width: taille, height: taille } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${taille}px;height:${taille}px}</style>${source}`);
  await page.screenshot({ path: new URL(`../icones/${nom}`, import.meta.url).pathname, omitBackground: transparent });
  await page.close();
}
await navigateur.close();
console.log(`${sorties.length} icônes écrites dans icones/`);
