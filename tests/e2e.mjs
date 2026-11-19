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
// NAVIGATEUR=chrome (ou msedge) utilise le navigateur déjà installé plutôt que celui de Playwright.
const navigateur = await chromium.launch({ channel: process.env.NAVIGATEUR || undefined });
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

  async 'correction des heures : enregistrée seulement après validation, bornes respectées'() {
    const p = await ouvrir();
    const { page } = p;
    await p.action('Pointer l’arrivée'); // 09:00:00
    await p.attendre(90 * MIN);
    await p.action('Partir en pause'); // 10:30:00
    await p.attendre(20 * MIN);
    await p.action('Reprendre le travail'); // 10:50:00
    await p.attendre(H); // 11:50:00
    await p.verifier({ compteur: '2:30:00' });

    const saisies = page.locator('#pointages .case-saisie');
    const enregistrer = page.locator('#outils-jour .valider');
    const refus = page.locator('#outils-jour .alerte');
    const valeurs = () => saisies.evaluateAll((champs) => champs.map((c) => c.value));
    const reprise = async () => (await p.donnees()).enCours.pointages[2];

    assert.equal(await saisies.count(), 0);
    await page.locator('#corriger-jour').tap();
    assert.deepEqual(await valeurs(), ['09:00', '10:30', '10:50']);
    assert.equal(await enregistrer.isDisabled(), true);

    // La reprise a en fait eu lieu à 10:40. Rien n'est enregistré avant « Enregistrer ».
    await saisies.nth(2).fill('10:40');
    assert.equal(await enregistrer.isDisabled(), false);
    assert.equal((await reprise()).horodatage, '2026-11-19T09:50:00.000Z');
    await p.capture('9-correction');
    await enregistrer.tap();
    await p.verifier({
      etat: 'Au travail',
      compteur: '2:40:00',
      pointages: ['Arrivée 09:00:00', 'Début de pause 10:30:00', 'Reprise 10:40:00'],
    });
    assert.deepEqual(await reprise(), { type: 'reprise', horodatage: '2026-11-19T09:40:00.000Z', corrige: true });
    assert.deepEqual(Object.keys((await p.donnees()).enCours.pointages[0]).sort(), ['horodatage', 'type']);
    // Seule l'heure corrigée porte la marque, et le compteur continue d'avancer.
    assert.equal(await page.locator('#pointages .corrige').count(), 1);
    assert.equal(await page.locator('#pointages .case-ligne').nth(2).locator('.corrige').count(), 1);
    await p.attendre(10 * MIN); // 12:00:00
    await p.verifier({ compteur: '2:50:00' });
    await p.capture('10-heure-corrigee');

    // Une pause qui commencerait après la reprise est refusée ; la saisie reste, les données aussi.
    await page.locator('#corriger-jour').tap();
    await saisies.nth(1).fill('11:00');
    await enregistrer.tap();
    assert.equal(await refus.innerText(), '« Début de pause » : l’heure doit être comprise entre 09:00 et 10:40.');
    assert.equal(await saisies.nth(1).getAttribute('aria-invalid'), 'true');
    assert.deepEqual(await valeurs(), ['09:00', '11:00', '10:40']);
    assert.equal((await p.donnees()).enCours.pointages[1].horodatage, '2026-11-19T09:30:00.000Z');
    await p.capture('11-correction-refusee');

    // Une heure dans le futur est refusée.
    await saisies.nth(1).fill('10:30');
    await saisies.nth(2).fill('13:00');
    await enregistrer.tap();
    assert.equal(await refus.innerText(), '« Reprise » : l’heure doit être comprise entre 10:30 et maintenant.');

    // Deux heures corrigées ensemble : la pause entière est avancée.
    await saisies.nth(1).fill('10:00');
    await saisies.nth(2).fill('10:15');
    await enregistrer.tap();
    await p.verifier({
      compteur: '2:45:00',
      pointages: ['Arrivée 09:00:00', 'Début de pause 10:00:00', 'Reprise 10:15:00'],
    });
    assert.equal(await page.locator('#pointages .corrige').count(), 2);

    // « Annuler » abandonne la saisie.
    await page.locator('#corriger-jour').tap();
    await saisies.nth(0).fill('07:00');
    await page.locator('#outils-jour > .choix .discret').tap();
    assert.equal(await saisies.count(), 0);
    await p.verifier({ compteur: '2:45:00', pointages: ['Arrivée 09:00:00', 'Début de pause 10:00:00', 'Reprise 10:15:00'] });

    // Tout cela survit au rechargement.
    await p.recharger();
    await p.verifier({ etat: 'Au travail', compteur: '2:45:00', principal: 'Partir en pause' });
    assert.equal(await page.locator('#pointages .corrige').count(), 2);
    await p.fermer();
  },

  async 'retirer le dernier pointage : appui par erreur, départ par erreur, rétablissement'() {
    const p = await ouvrir();
    const { page } = p;
    const retirer = page.locator('#outils-jour .deux-temps > .lien');
    const question = page.locator('#outils-jour .demande');
    const confirmer = page.locator('#outils-jour .demande .depart');
    const bandeau = page.locator('#retablir');

    await p.action('Pointer l’arrivée'); // 09:00:00
    await p.attendre(H);
    await p.action('Partir en pause'); // 10:00:00, par erreur
    await p.attendre(5_000);

    // Sans réponse, la question se referme et rien n'est retiré.
    await page.locator('#corriger-jour').tap();
    await retirer.tap();
    assert.equal(await question.locator('.question').innerText(), 'Retirer « Début de pause » de 10:00 ?');
    await p.attendre(8_000); // 10:00:13
    assert.equal(await question.isVisible(), false);
    assert.equal(await retirer.isVisible(), true);

    // Un double appui ne confirme pas.
    await retirer.tap();
    await confirmer.tap();
    await p.verifier({ etat: 'En pause depuis 10:00' });
    await p.attendre(1_000); // 10:00:14
    await confirmer.tap();
    await p.verifier({ etat: 'Au travail', compteur: '1:00:14', principal: 'Partir en pause', pointages: ['Arrivée 09:00:00'] });
    assert.equal(await page.locator('#retablir-texte').innerText(), 'Dernier pointage retiré.');
    await p.capture('12-pointage-retire');

    // « Rétablir » remet le pointage tel qu'il était, à la seconde.
    await page.locator('#retablir-bouton').tap();
    await p.verifier({ etat: 'En pause depuis 10:00', compteur: '1:00:00', pointages: ['Arrivée 09:00:00', 'Début de pause 10:00:00'] });
    assert.equal(await bandeau.isVisible(), false);

    // Retiré pour de bon : le bandeau disparaît de lui-même.
    await page.locator('#corriger-jour').tap();
    await retirer.tap();
    await p.attendre(1_000);
    await confirmer.tap();
    assert.equal(await bandeau.isVisible(), true);
    await p.attendre(10_000); // 10:00:25
    assert.equal(await bandeau.isVisible(), false);
    await p.verifier({ etat: 'Au travail', pointages: ['Arrivée 09:00:00'] });

    // Départ pointé par erreur : le retirer rouvre la journée, qui quitte l'historique.
    await p.depart();
    await p.verifier({ etat: 'Journée terminée', principal: 'Pointer l’arrivée' });
    assert.equal((await p.donnees()).historique.length, 1);
    await page.locator('#corriger-jour').tap();
    await retirer.tap();
    assert.equal(await question.locator('.question').innerText(), 'Retirer « Départ » de 10:00 ?');
    await p.attendre(1_000);
    await confirmer.tap();
    await p.verifier({ etat: 'Au travail', principal: 'Partir en pause', pointages: ['Arrivée 09:00:00'] });
    let donnees = await p.donnees();
    assert.equal(donnees.historique.length, 0);
    assert.equal(donnees.enCours.pointages.length, 1);
    await page.locator('#retablir-bouton').tap();
    await p.verifier({ etat: 'Journée terminée', principal: 'Pointer l’arrivée' });
    donnees = await p.donnees();
    assert.equal(donnees.historique.length, 1);
    assert.equal(donnees.enCours, null);

    // Retirer l'arrivée d'une journée tout juste commencée la fait disparaître.
    await p.action('Pointer l’arrivée');
    await page.locator('#corriger-jour').tap();
    await retirer.tap();
    await p.attendre(1_000);
    await confirmer.tap();
    assert.equal((await p.donnees()).enCours, null);
    assert.equal((await p.donnees()).historique.length, 1);
    await p.fermer();
  },

  async 'historique : supprimer une journée, tout effacer, jamais par mégarde'() {
    const p = await ouvrir();
    const { page } = p;
    // Trois journées terminées (16, 17 et 18 novembre, 9 h – 17 h) et une journée en cours depuis 8 h 30.
    await page.evaluate(() => {
      const jour = (n) => ({
        id: `2026-11-${n}T08:00:00.000Z`,
        date: `2026-11-${n}`,
        pointages: [
          { type: 'arrivee', horodatage: `2026-11-${n}T08:00:00.000Z` },
          { type: 'depart', horodatage: `2026-11-${n}T16:00:00.000Z` },
        ],
      });
      const enCours = {
        id: '2026-11-19T07:30:00.000Z',
        date: '2026-11-19',
        pointages: [{ type: 'arrivee', horodatage: '2026-11-19T07:30:00.000Z' }],
      };
      localStorage.setItem('ludopointe/v1', JSON.stringify({ enCours, historique: [jour(17), jour(18), jour(16)] }));
    });
    await p.recharger();

    const jours = page.locator('#historique-liste .jour');
    const dates = () => page.locator('#historique-liste .jour-date').allInnerTexts();
    const ouvrirHistorique = () => page.locator('#historique > summary').tap();
    const bandeau = page.locator('#retablir');
    const nbEnregistrees = async () => (await p.donnees()).historique.length;

    await ouvrirHistorique();
    assert.deepEqual(await dates(), ['mer. 18 nov.', 'mar. 17 nov.', 'lun. 16 nov.']);
    // Rien ne permet de supprimer tant qu'une journée n'est pas dépliée.
    assert.equal(await page.locator('#historique-liste .lien:visible').count(), 0);

    const jour17 = jours.nth(1);
    const supprimer = jour17.locator('.deux-temps > .lien');
    const question = jour17.locator('.demande');
    const confirmer = jour17.locator('.demande .depart');
    await jour17.locator('summary').tap();

    // « Garder » : rien ne change.
    await supprimer.tap();
    assert.equal(await question.locator('.question').innerText(), 'Supprimer définitivement la journée du mar. 17 nov. ?');
    await p.capture('13-supprimer-journee');
    await question.locator('.discret').tap();
    assert.equal(await question.isVisible(), false);
    assert.equal(await nbEnregistrees(), 3);

    // Sans réponse pendant 8 secondes : la question se referme.
    await supprimer.tap();
    await p.attendre(8_000);
    assert.equal(await question.isVisible(), false);
    assert.equal(await nbEnregistrees(), 3);

    // Double appui : ignoré. Confirmation posée : la journée disparaît, les autres restent.
    await supprimer.tap();
    await confirmer.tap();
    assert.equal(await nbEnregistrees(), 3);
    await p.attendre(1_000);
    await confirmer.tap();
    assert.deepEqual(await dates(), ['mer. 18 nov.', 'lun. 16 nov.']);
    assert.equal(await nbEnregistrees(), 2);
    assert.equal(await page.locator('#retablir-texte').innerText(), 'Journée du mar. 17 nov. supprimée.');
    await p.capture('14-journee-supprimee');

    // « Rétablir » la remet à sa place.
    await page.locator('#retablir-bouton').tap();
    assert.deepEqual(await dates(), ['mer. 18 nov.', 'mar. 17 nov.', 'lun. 16 nov.']);
    assert.equal(await nbEnregistrees(), 3);
    assert.equal(await bandeau.isVisible(), false);

    // Supprimée pour de bon : le bandeau s'efface, et la suppression survit au rechargement.
    await jour17.locator('summary').tap();
    await supprimer.tap();
    await p.attendre(1_000);
    await confirmer.tap();
    await p.attendre(10_000);
    assert.equal(await bandeau.isVisible(), false);
    await p.recharger();
    await ouvrirHistorique();
    assert.deepEqual(await dates(), ['mer. 18 nov.', 'lun. 16 nov.']);

    // Corriger une journée de l'historique : départ à 16:30 au lieu de 17:00.
    const jour18 = jours.nth(0);
    await jour18.locator('summary').tap();
    await jour18.locator('.outils > .lien').tap();
    assert.deepEqual(await jour18.locator('.case-saisie').evaluateAll((c) => c.map((s) => s.value)), ['09:00', '17:00']);
    await jour18.locator('.case-saisie').nth(1).fill('16:30');
    await jour18.locator('.valider').tap();
    assert.match(await jour18.locator('summary').innerText(), /mer\. 18 nov\.\s+09:00 – 16:30\s+7 h 30/);
    assert.equal(await jour18.locator('.corrige').count(), 1);
    assert.equal(await jour18.locator('.case-saisie').count(), 0);
    // La journée en cours n'a pas bougé.
    await p.verifier({ etat: 'Au travail', pointages: ['Arrivée 08:30:00'] });
    await p.capture('15-historique-corrige');

    // Tout effacer : il faut saisir le mot.
    const effacer = page.locator('#effacer-tout > .lien');
    const mot = page.locator('#effacer-mot');
    const toutEffacer = page.locator('#effacer-tout .depart');
    await effacer.tap();
    assert.match(await page.locator('#effacer-tout .question').innerText(), /les 2 journées de l’historique, saisissez EFFACER/);
    assert.equal(await toutEffacer.isDisabled(), true);
    await toutEffacer.tap({ force: true });
    await mot.fill('EFFACE');
    assert.equal(await toutEffacer.isDisabled(), true);
    await toutEffacer.tap({ force: true });
    assert.equal(await nbEnregistrees(), 2);
    await p.capture('16-tout-effacer');
    // « Garder » referme et vide la saisie.
    await mot.fill('EFFACER');
    await page.locator('#effacer-tout .discret').tap();
    assert.equal(await nbEnregistrees(), 2);
    await effacer.tap();
    assert.equal(await mot.inputValue(), '');
    assert.equal(await toutEffacer.isDisabled(), true);

    await mot.fill('effacer');
    assert.equal(await toutEffacer.isDisabled(), false);
    await toutEffacer.tap();
    assert.equal(await jours.count(), 0);
    assert.equal(await page.locator('#historique-vide').isVisible(), true);
    assert.equal(await page.locator('#effacer-tout > .lien').count(), 0);
    assert.equal(await page.locator('#retablir-texte').innerText(), '2 journées supprimées.');
    // La journée en cours est intacte.
    let donnees = await p.donnees();
    assert.equal(donnees.historique.length, 0);
    assert.equal(donnees.enCours.pointages[0].horodatage, '2026-11-19T07:30:00.000Z');
    await p.verifier({ etat: 'Au travail', principal: 'Partir en pause' });

    // « Rétablir » rend les deux journées, correction comprise.
    await page.locator('#retablir-bouton').tap();
    assert.deepEqual(await dates(), ['mer. 18 nov.', 'lun. 16 nov.']);
    donnees = await p.donnees();
    assert.equal(donnees.historique.length, 2);
    assert.equal(donnees.historique.flatMap((j) => j.pointages).filter((q) => q.corrige).length, 1);

    // Effacé pour de bon.
    await effacer.tap();
    await mot.fill('EFFACER');
    await toutEffacer.tap();
    await p.attendre(10_000);
    await p.recharger();
    assert.equal((await p.donnees()).historique.length, 0);
    await p.verifier({ etat: 'Au travail', pointages: ['Arrivée 08:30:00'] });
    await p.fermer();
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
