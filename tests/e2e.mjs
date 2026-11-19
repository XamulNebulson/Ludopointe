// Parcours réels dans Chromium, au format téléphone, avec une horloge pilotée.
// Lancer : npm run e2e   (captures d'écran dans captures/ avec CAPTURES=1)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { demarrer } from '../outils/serveur.mjs';

// Playwright n'est pas une dépendance du projet : il est pris là où il est installé (local ou global).
const { chromium } = createRequire(import.meta.url)('playwright');

const CAPTURES = process.env.CAPTURES === '1';
const DEBUT = new Date('2026-11-19T09:00:00+01:00');
const MIN = 60_000;
const H = 60 * MIN;

const serveur = await demarrer();
const URL_APPLI = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch();
if (CAPTURES) await mkdir('captures', { recursive: true });

async function ouvrir({ theme = 'light', debut = DEBUT, options = {}, avant = null } = {}) {
  const contexte = await navigateur.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: CAPTURES ? 2 : 1,
    hasTouch: true,
    isMobile: true,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    colorScheme: theme,
    ...options,
  });
  if (avant) await contexte.addInitScript(avant);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(new Error(m.text())));
  // Horloge à l'arrêt : le temps n'avance que par attendre(), au millième près.
  await page.clock.install({ time: debut.getTime() - 1000 });
  await page.clock.pauseAt(debut);
  await page.goto(URL_APPLI);
  await page.locator('#action-principale').waitFor();

  const p = {
    page,
    contexte,
    erreurs,
    attendre: (ms) => page.clock.fastForward(ms),
    texte: (sel) => page.locator(sel).innerText(),
    principal: () => page.locator('#action-principale'),
    async action(libelle) {
      assert.equal(await p.texte('#action-principale'), libelle);
      await p.principal().tap();
    },
    async depart() {
      await page.locator('#depart').tap();
      await page.locator('#depart-confirmer').tap();
    },
    async verifier({ etat, compteur, principal, pointages }) {
      if (etat) assert.equal(await p.texte('#etat'), etat);
      if (compteur) assert.equal(await p.texte('#compteur'), compteur);
      if (principal) assert.equal(await p.texte('#action-principale'), principal);
      if (pointages) {
        assert.deepEqual(
          await page.locator('#pointages .case-ligne').evaluateAll((lignes) =>
            lignes.map((l) => `${l.querySelector('.case-nom').textContent} ${l.querySelector('time').textContent}`),
          ),
          pointages,
        );
      }
    },
    /** Le bouton est entièrement dans l'écran, sans défilement. */
    async visibleSansDefiler(sel) {
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      const cadre = await page.locator(sel).boundingBox();
      assert.ok(cadre && cadre.y >= 0 && cadre.y + cadre.height <= 640, `${sel} hors écran`);
    },
    async recharger() {
      await page.reload();
      await p.principal().waitFor();
    },
    donnees: () => page.evaluate(() => JSON.parse(localStorage.getItem('ludopointe/v1'))),
    capture: (nom) => (CAPTURES ? page.screenshot({ path: `captures/${nom}.png` }) : null),
    async fermer() {
      assert.deepEqual(erreurs, [], 'erreurs dans la console');
      await contexte.close();
    },
  };
  return p;
}

const scenarios = {
  async 'journée sans pause'() {
    const p = await ouvrir();
    await p.verifier({ etat: 'Pas encore pointé', compteur: '0:00:00', principal: 'Pointer l’arrivée', pointages: [] });
    assert.equal(await p.page.locator('#zone-depart').isVisible(), false);
    await p.visibleSansDefiler('#action-principale');
    await p.capture('1-avant-arrivee');

    await p.attendre(5_000);
    await p.action('Pointer l’arrivée');
    await p.attendre(3 * H + 12 * MIN + 7_000);
    await p.verifier({ etat: 'Au travail', compteur: '3:12:07', principal: 'Partir en pause', pointages: ['Arrivée 09:00:05'] });
    await p.visibleSansDefiler('#action-principale');
    await p.visibleSansDefiler('#depart');
    await p.capture('2-au-travail');

    // La demande de départ peut être annulée sans rien enregistrer.
    await p.page.locator('#depart').tap();
    await p.capture('3-confirmation-depart');
    await p.page.locator('#depart-annuler').tap();
    await p.verifier({ etat: 'Au travail', pointages: ['Arrivée 09:00:05'] });

    await p.attendre(5 * H);
    await p.depart();
    await p.verifier({
      etat: 'Journée terminée',
      compteur: '8:12:07',
      principal: 'Pointer l’arrivée',
      pointages: ['Arrivée 09:00:05', 'Départ 17:12:12'],
    });
    // Le compteur ne bouge plus une fois la journée terminée.
    await p.attendre(2 * H);
    await p.verifier({ compteur: '8:12:07' });

    await p.page.locator('#historique > summary').tap();
    assert.equal(await p.page.locator('#historique-liste .jour').count(), 1);
    assert.match(await p.texte('#historique-liste .jour summary'), /jeu\. 19 nov\.\s+09:00 – 17:12\s+8 h 12/);
    await p.page.locator('#historique-liste .jour summary').tap();
    assert.equal(await p.texte('#historique-liste .jour-pauses'), 'Sans pause');
    await p.fermer();
  },

  async 'plusieurs pauses, rechargements au travail et en pause'() {
    const p = await ouvrir();
    await p.action('Pointer l’arrivée'); // 09:00:00
    await p.attendre(90 * MIN);
    await p.action('Partir en pause'); // 10:30:00
    await p.attendre(15 * MIN);
    await p.verifier({ etat: 'En pause depuis 10:30', compteur: '1:30:00', principal: 'Reprendre le travail' });
    assert.equal(await p.texte('#temps-pause'), '0:15:00');
    await p.visibleSansDefiler('#action-principale');
    await p.visibleSansDefiler('#depart');
    await p.capture('4-en-pause');

    // Rechargement en pause : même état, compteur toujours figé.
    await p.recharger();
    await p.verifier({ etat: 'En pause depuis 10:30', compteur: '1:30:00', principal: 'Reprendre le travail' });
    await p.attendre(5 * MIN);
    await p.verifier({ compteur: '1:30:00' });
    assert.equal(await p.texte('#temps-pause'), '0:20:00');

    await p.action('Reprendre le travail'); // 10:50:00
    await p.attendre(70 * MIN);
    await p.action('Partir en pause'); // 12:00:00
    await p.attendre(45 * MIN + 30_000);
    await p.action('Reprendre le travail'); // 12:45:30
    await p.attendre(2 * H);

    // Rechargement au travail : le compteur est recalculé et continue d'avancer.
    await p.verifier({ etat: 'Au travail', compteur: '4:40:00' });
    await p.recharger();
    await p.verifier({ etat: 'Au travail', compteur: '4:40:00', principal: 'Partir en pause' });
    await p.attendre(30_000);
    await p.verifier({ compteur: '4:40:30' });

    await p.action('Partir en pause'); // 14:46:00
    await p.attendre(4 * MIN);
    await p.action('Reprendre le travail'); // 14:50:00
    await p.attendre(10 * MIN);
    await p.verifier({
      compteur: '4:50:30',
      pointages: [
        'Arrivée 09:00:00',
        'Début de pause 10:30:00',
        'Reprise 10:50:00',
        'Début de pause 12:00:00',
        'Reprise 12:45:30',
        'Début de pause 14:46:00',
        'Reprise 14:50:00',
      ],
    });
    await p.capture('5-plusieurs-pauses');
    // Même avec une longue liste, l'action principale et le départ restent à l'écran.
    await p.visibleSansDefiler('#action-principale');
    await p.visibleSansDefiler('#depart');

    // Seuls les horodatages sont enregistrés.
    const donnees = await p.donnees();
    assert.deepEqual(Object.keys(donnees.enCours).sort(), ['date', 'id', 'pointages']);
    assert.deepEqual(Object.keys(donnees.enCours.pointages[0]).sort(), ['horodatage', 'type']);

    await p.depart(); // 15:00:00
    await p.verifier({ etat: 'Journée terminée', compteur: '4:50:30' });
    await p.recharger();
    await p.verifier({ etat: 'Journée terminée', compteur: '4:50:30', principal: 'Pointer l’arrivée' });
    await p.page.locator('#historique > summary').tap();
    await p.page.locator('#historique-liste .jour summary').tap();
    assert.equal(await p.texte('#historique-liste .jour-pauses'), '3 pauses · 1 h 09');
    await p.capture('6-terminee-historique');
    await p.fermer();
  },

  async 'départ pendant une pause'() {
    const p = await ouvrir({ theme: 'dark' });
    await p.action('Pointer l’arrivée'); // 09:00:00
    await p.attendre(3 * H);
    await p.action('Partir en pause'); // 12:00:00
    await p.attendre(20 * MIN);
    await p.capture('7-sombre-en-pause');
    await p.depart(); // 12:20:00
    await p.verifier({
      etat: 'Journée terminée',
      compteur: '3:00:00',
      principal: 'Pointer l’arrivée',
      pointages: ['Arrivée 09:00:00', 'Début de pause 12:00:00', 'Départ 12:20:00'],
    });
    assert.equal(await p.texte('#temps-pause'), '0:20:00');
    const donnees = await p.donnees();
    assert.equal(donnees.enCours, null);
    assert.equal(donnees.historique.length, 1);

    // Une nouvelle arrivée le même jour ouvre une nouvelle journée ; la première reste dans l'historique.
    await p.attendre(H);
    await p.action('Pointer l’arrivée'); // 13:20:00
    await p.attendre(10 * MIN);
    await p.verifier({ etat: 'Au travail', compteur: '0:10:00', pointages: ['Arrivée 13:20:00'] });
    await p.depart();
    assert.equal((await p.donnees()).historique.length, 2);
    await p.fermer();
  },

  async 'journée restée ouverte : rappel le lendemain, clôture possible'() {
    const p = await ouvrir({ debut: new Date('2026-11-19T18:00:00+01:00') });
    await p.action('Pointer l’arrivée');
    await p.attendre(14 * H); // 08:00 le lendemain
    await p.recharger();
    await p.verifier({ etat: 'Au travail', compteur: '14:00:00' });
    assert.match(await p.texte('#alerte'), /Journée commencée jeudi 19 novembre/);
    await p.visibleSansDefiler('#depart');
    await p.depart();
    assert.equal(await p.page.locator('#alerte').isVisible(), false);
    // Rattachée à sa date d'arrivée, elle n'est pas présentée comme la journée d'aujourd'hui.
    await p.verifier({ etat: 'Pas encore pointé', compteur: '0:00:00', pointages: [] });
    assert.equal((await p.donnees()).historique[0].date, '2026-11-19');
    await p.fermer();
  },
  async 'hors-ligne : l’appli se recharge sans réseau, pointage conservé'() {
    const p = await ouvrir();
    await p.action('Pointer l’arrivée'); // 09:00:00
    await p.attendre(H);
    await p.action('Partir en pause'); // 10:00:00
    // Attend que la copie locale des fichiers soit prête et active.
    await p.page.evaluate(() => navigator.serviceWorker.ready);
    await p.page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await p.contexte.setOffline(true);
    p.erreurs.length = 0;
    await p.recharger();
    await p.attendre(30 * MIN);
    await p.verifier({
      etat: 'En pause depuis 10:00',
      compteur: '1:00:00',
      principal: 'Reprendre le travail',
      pointages: ['Arrivée 09:00:00', 'Début de pause 10:00:00'],
    });
    // Styles et icônes viennent bien de la copie locale.
    assert.equal(await p.page.evaluate(() => getComputedStyle(document.querySelector('.carte')).borderRadius), '14px');
    assert.equal(await p.page.evaluate(() => fetch('icones/icone-192.png').then((r) => r.ok)), true);
    await p.action('Reprendre le travail');
    await p.verifier({ etat: 'Au travail' });
    await p.fermer();
  },

  async 'installation : manifeste, icônes et lien « Installer »'() {
    // Navigateur ordinaire : pas de lien tant que le navigateur ne propose pas l'installation.
    const p = await ouvrir();
    const lien = p.page.locator('#installer');
    assert.equal(await lien.isVisible(), false);
    const manifeste = await p.page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json()));
    assert.equal(manifeste.display, 'standalone');
    for (const icone of manifeste.icons) {
      const taille = await p.page.evaluate(async (src) => {
        const image = await createImageBitmap(await (await fetch(src)).blob());
        return `${image.width}x${image.height}`;
      }, icone.src);
      assert.equal(taille, icone.sizes, icone.src);
    }
    // Android : le navigateur propose l'installation, le lien apparaît et la déclenche.
    await p.page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.inviteMontree = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
    assert.equal(await lien.isVisible(), true);
    await p.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.capture('8-lien-installer');
    await lien.tap();
    assert.equal(await p.page.evaluate(() => window.inviteMontree), true);
    assert.equal(await lien.isVisible(), false);
    await p.fermer();

    // iPhone : le lien affiche la marche à suivre.
    const iphone = await ouvrir({
      options: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
    });
    assert.equal(await iphone.page.locator('#installer-aide').isVisible(), false);
    await iphone.page.locator('#installer').tap();
    assert.match(await iphone.texte('#installer-aide'), /Partager, puis « Sur l’écran d’accueil »/);
    await iphone.visibleSansDefiler('#action-principale');
    await iphone.fermer();

    // Appli déjà installée : aucun lien.
    const installee = await ouvrir({
      options: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' },
      avant: () => Object.defineProperty(navigator, 'standalone', { value: true }),
    });
    assert.equal(await installee.page.locator('#installer').isVisible(), false);
    await installee.fermer();
  },
};

let echecs = 0;
for (const [nom, scenario] of Object.entries(scenarios)) {
  try {
    await scenario();
    console.log(`ok   ${nom}`);
  } catch (erreur) {
    echecs++;
    console.log(`ÉCHEC ${nom}\n${erreur.stack}`);
  }
}
await navigateur.close();
serveur.close();
console.log(echecs ? `${echecs} scénario(s) en échec` : `${Object.keys(scenarios).length} scénarios réussis`);
process.exit(echecs ? 1 : 0);
