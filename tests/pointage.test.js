import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ETATS, ErreurCorrection, appliquer, annulerDernier, bilan, corrigerHeures, etat, actionsPossibles, horodater,
} from '../js/pointage.js';
import { creerStockageLocal } from '../js/stockage.js';

const H = 3600_000;
const MIN = 60_000;
/** Heure locale du 19 novembre 2026. */
const a = (h, min = 0, s = 0, ms = 0) => new Date(2026, 10, 19, h, min, s, ms);

/** Rejoue une suite de [type, date]. */
const jouer = (suite) => suite.reduce((j, [type, quand]) => appliquer(j, type, quand), null);

function faussMagasin() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

test('journée sans pause', () => {
  let j = jouer([['arrivee', a(9)]]);
  assert.equal(etat(j), ETATS.AU_TRAVAIL);
  assert.equal(bilan(j, a(12)).travailMs, 3 * H);
  j = appliquer(j, 'depart', a(17, 30));
  const b = bilan(j, a(23));
  assert.equal(b.etat, ETATS.TERMINEE);
  assert.equal(b.travailMs, 8 * H + 30 * MIN);
  assert.equal(b.pauseMs, 0);
  assert.equal(b.nbPauses, 0);
  assert.equal(j.date, '2026-11-19');
});

test('journée avec plusieurs pauses', () => {
  const j = jouer([
    ['arrivee', a(9)],
    ['pause', a(10, 30)],
    ['reprise', a(10, 45)],
    ['pause', a(12)],
    ['reprise', a(13)],
    ['pause', a(15, 0, 10)],
    ['reprise', a(15, 5, 40)],
    ['depart', a(17)],
  ]);
  const b = bilan(j);
  assert.equal(b.nbPauses, 3);
  assert.equal(b.pauseMs, 15 * MIN + H + 5 * MIN + 30_000);
  assert.equal(b.travailMs, 8 * H - b.pauseMs);
});

test('le compteur est figé pendant une pause et repart à la reprise', () => {
  let j = jouer([['arrivee', a(9)], ['pause', a(10)]]);
  assert.equal(etat(j), ETATS.EN_PAUSE);
  assert.equal(bilan(j, a(10, 1)).travailMs, H);
  assert.equal(bilan(j, a(10, 40)).travailMs, H);
  assert.equal(bilan(j, a(10, 40)).pauseMs, 40 * MIN);
  j = appliquer(j, 'reprise', a(10, 40));
  assert.equal(bilan(j, a(11, 40)).travailMs, 2 * H);
});

test('départ pendant une pause : la pause se termine au départ', () => {
  const j = jouer([['arrivee', a(9)], ['pause', a(12)], ['depart', a(12, 20)]]);
  const b = bilan(j, a(20));
  assert.equal(b.etat, ETATS.TERMINEE);
  assert.equal(b.travailMs, 3 * H);
  assert.equal(b.pauseMs, 20 * MIN);
  assert.equal(b.nbPauses, 1);
});

test('horodatage à la seconde', () => {
  const j = jouer([['arrivee', a(9, 0, 5, 999)]]);
  assert.equal(j.pointages[0].horodatage, horodater(a(9, 0, 5)));
  assert.match(j.pointages[0].horodatage, /:\d\d\.000Z$/);
});

test('actions refusées quand elles ne sont pas permises', () => {
  assert.deepEqual(actionsPossibles(null), ['arrivee']);
  assert.throws(() => appliquer(null, 'pause', a(9)));
  assert.throws(() => appliquer(null, 'depart', a(9)));
  const auTravail = jouer([['arrivee', a(9)]]);
  assert.throws(() => appliquer(auTravail, 'reprise', a(10)));
  assert.throws(() => appliquer(auTravail, 'arrivee', a(10)));
  const enPause = appliquer(auTravail, 'pause', a(10));
  assert.throws(() => appliquer(enPause, 'pause', a(11)));
  assert.deepEqual(actionsPossibles(enPause), ['reprise', 'depart']);
  const finie = appliquer(enPause, 'depart', a(11));
  assert.deepEqual(actionsPossibles(finie), []);
});

test('appliquer ne modifie pas la journée reçue', () => {
  const j = jouer([['arrivee', a(9)]]);
  appliquer(j, 'pause', a(10));
  assert.equal(j.pointages.length, 1);
});

test('horloge qui recule : les pointages restent dans l’ordre, aucune durée négative', () => {
  const j = jouer([['arrivee', a(9)], ['pause', a(8)]]);
  assert.equal(j.pointages[1].horodatage, j.pointages[0].horodatage);
  assert.equal(bilan(j, a(7)).travailMs, 0);
  assert.equal(bilan(j, a(7)).pauseMs, 0);
});

test('stockage : l’état est retrouvé à partir des seuls horodatages enregistrés', async () => {
  const magasin = faussMagasin();
  const j = jouer([['arrivee', a(9)], ['pause', a(10)], ['reprise', a(10, 15)], ['pause', a(11)]]);
  await creerStockageLocal(magasin).enregistrerJourneeEnCours(j);

  // « Rechargement » : nouvelle instance, mêmes données brutes.
  const relue = await creerStockageLocal(magasin).chargerJourneeEnCours();
  assert.deepEqual(relue, j);
  assert.deepEqual(Object.keys(relue).sort(), ['date', 'id', 'pointages']);
  const b = bilan(relue, a(11, 30));
  assert.equal(b.etat, ETATS.EN_PAUSE);
  assert.equal(b.travailMs, H + 45 * MIN);
});

test('stockage : archiver vide la journée en cours et alimente l’historique', async () => {
  const magasin = faussMagasin();
  const s = creerStockageLocal(magasin);
  const j1 = jouer([['arrivee', a(9)], ['depart', a(12)]]);
  const j2 = jouer([['arrivee', a(14)], ['depart', a(18)]]);
  await s.enregistrerJourneeEnCours(j1);
  await s.archiverJournee(j1);
  await s.archiverJournee(j2);
  assert.equal(await s.chargerJourneeEnCours(), null);
  assert.deepEqual((await s.listerHistorique()).map((j) => j.id), [j2.id, j1.id]);
});

test('stockage : données illisibles ignorées', async () => {
  const magasin = faussMagasin();
  magasin.setItem('ludopointe/v1', '{pas du json');
  const s = creerStockageLocal(magasin);
  assert.equal(await s.chargerJourneeEnCours(), null);
  assert.deepEqual(await s.listerHistorique(), []);
});

// ---------- Corrections ----------

/** Journée terminée : 9:00:05, pause 10:30:20 – 10:50:00, départ 17:00:00. */
const journeeType = () =>
  jouer([['arrivee', a(9, 0, 5)], ['pause', a(10, 30, 20)], ['reprise', a(10, 50)], ['depart', a(17)]]);
const heures = (j) => j.pointages.map((p) => p.horodatage);
const refus = (fonction) => {
  try {
    fonction();
  } catch (erreur) {
    assert.ok(erreur instanceof ErreurCorrection, String(erreur));
    return erreur;
  }
  assert.fail('la correction aurait dû être refusée');
};

test('correction : une heure est modifiée, marquée, et le temps net recalculé', () => {
  const j = journeeType();
  const c = corrigerHeures(j, [null, null, '10:40', null], a(18));
  assert.deepEqual(heures(c), [a(9, 0, 5), a(10, 30, 20), a(10, 40), a(17)].map(horodater));
  assert.deepEqual(c.pointages.map((p) => p.corrige === true), [false, false, true, false]);
  assert.equal(c.pointages[0], j.pointages[0]);
  assert.equal(bilan(c).pauseMs, 9 * MIN + 40_000);
  assert.equal(bilan(c).travailMs, bilan(j).travailMs + 10 * MIN);
  // La journée d'origine n'est pas modifiée.
  assert.equal(j.pointages[2].horodatage, horodater(a(10, 50)));
  assert.equal(c.id, j.id);
  assert.equal(c.date, j.date);
});

test('correction : la minute du pointage voisin est acceptée, sans inverser l’ordre', () => {
  // La pause a commencé à 10:30:20 ; « 10:30 » pour la reprise donne 10:30:20, pas 10:30:00.
  const c = corrigerHeures(journeeType(), [null, null, '10:30', null], a(18));
  assert.equal(c.pointages[2].horodatage, horodater(a(10, 30, 20)));
  assert.equal(bilan(c).pauseMs, 0);
});

test('correction : heure hors de l’intervalle permis refusée, avec les bornes', () => {
  const j = journeeType();
  let e = refus(() => corrigerHeures(j, [null, null, '10:20', null], a(18)));
  assert.deepEqual([e.index, e.min, e.max, e.jusquAMaintenant], [2, horodater(a(10, 30, 20)), horodater(a(17)), false]);
  e = refus(() => corrigerHeures(j, [null, '11:00', null, null], a(18)));
  assert.deepEqual([e.index, e.min, e.max], [1, horodater(a(9, 0, 5)), horodater(a(10, 50))]);
  e = refus(() => corrigerHeures(j, [null, null, null, '10:00'], a(18)));
  assert.deepEqual([e.index, e.min, e.jusquAMaintenant], [3, horodater(a(10, 50)), true]);
});

test('correction : plusieurs heures à la fois, validées ensemble', () => {
  const j = journeeType();
  // Décaler la pause entière : chaque heure seule sortirait de ses anciennes bornes.
  const c = corrigerHeures(j, [null, '12:00', '12:30', null], a(18));
  assert.deepEqual(heures(c), [a(9, 0, 5), a(12), a(12, 30), a(17)].map(horodater));
  assert.equal(bilan(c).pauseMs, 30 * MIN);
  const e = refus(() => corrigerHeures(j, [null, '12:30', '12:00', null], a(18)));
  assert.deepEqual([e.index, e.min, e.max], [2, horodater(a(12, 30)), horodater(a(17))]);
});

test('correction : jamais dans le futur', () => {
  const j = jouer([['arrivee', a(9)], ['pause', a(10)]]);
  const e = refus(() => corrigerHeures(j, [null, '10:45'], a(10, 30)));
  assert.deepEqual([e.index, e.max, e.jusquAMaintenant], [1, horodater(a(10, 30)), true]);
  assert.equal(corrigerHeures(j, [null, '10:15'], a(10, 30)).pointages[1].horodatage, horodater(a(10, 15)));
  assert.equal(bilan(corrigerHeures(j, [null, '10:15'], a(10, 30)), a(10, 30)).etat, ETATS.EN_PAUSE);
});

test('correction : l’arrivée reste le même jour', () => {
  const j = journeeType();
  assert.equal(corrigerHeures(j, ['08:45', null, null, null], a(18)).pointages[0].horodatage, horodater(a(8, 45)));
  // 23:00 la veille serait « avant la pause », mais allongerait la journée de dix heures : refusé.
  const e = refus(() => corrigerHeures(j, ['23:00', null, null, null], a(18)));
  assert.deepEqual([e.index, e.min, e.max], [0, null, horodater(a(10, 30, 20))]);
});

test('correction : départ oublié puis pointé le lendemain, ramené à la veille', () => {
  const lendemain = (h, min = 0) => new Date(2026, 10, 20, h, min);
  const j = jouer([['arrivee', a(9)], ['depart', lendemain(8)]]);
  const c = corrigerHeures(j, [null, '18:00'], lendemain(8, 5));
  assert.equal(c.pointages[1].horodatage, horodater(a(18)));
  assert.equal(bilan(c).travailMs, 9 * H);
  assert.equal(c.date, '2026-11-19');
  // Une heure possible le jour même du pointage est prise ce jour-là.
  assert.equal(corrigerHeures(j, [null, '07:00'], lendemain(8, 5)).pointages[1].horodatage, horodater(lendemain(7)));
});

test('correction : un départ ne saute pas au lendemain', () => {
  // « 08:00 » pour un départ à 17:00 : ni le jour même (avant la reprise), ni le lendemain.
  const e = refus(() => corrigerHeures(journeeType(), [null, null, null, '08:00'], new Date(2026, 10, 26, 12)));
  assert.equal(e.index, 3);
});

test('correction : heure inchangée ou illisible', () => {
  const j = journeeType();
  const c = corrigerHeures(j, [null, null, '10:50', null], a(18));
  assert.equal(c.pointages[2], j.pointages[2]);
  assert.equal('corrige' in c.pointages[2], false);
  for (const illisible of ['', '25:00', '10:75', 'midi']) {
    const e = refus(() => corrigerHeures(j, [null, illisible, null, null], a(18)));
    assert.deepEqual([e.index, e.min, e.max], [1, null, null]);
  }
});

test('retirer le dernier pointage', () => {
  const j = journeeType();
  const rouverte = annulerDernier(j);
  assert.equal(etat(rouverte), ETATS.AU_TRAVAIL);
  assert.equal(rouverte.pointages.length, 3);
  assert.equal(j.pointages.length, 4);
  assert.equal(etat(annulerDernier(rouverte)), ETATS.EN_PAUSE);
  assert.equal(annulerDernier(jouer([['arrivee', a(9)]])), null);
});

test('stockage : corriger une journée de l’historique ne touche pas la journée en cours', async () => {
  const s = creerStockageLocal(faussMagasin());
  const hier = jouer([['arrivee', new Date(2026, 10, 18, 9)], ['depart', new Date(2026, 10, 18, 17)]]);
  const enCours = jouer([['arrivee', a(9)]]);
  await s.archiverJournee(hier);
  await s.enregistrerJourneeEnCours(enCours);
  const corrigee = corrigerHeures(hier, [null, '16:30'], a(10));
  await s.archiverJournee(corrigee);
  assert.deepEqual(await s.chargerJourneeEnCours(), enCours);
  assert.deepEqual(await s.listerHistorique(), [corrigee]);
});

test('stockage : supprimer une journée, effacer l’historique, ordre par arrivée', async () => {
  const s = creerStockageLocal(faussMagasin());
  const jour = (n) => jouer([['arrivee', new Date(2026, 10, n, 9)], ['depart', new Date(2026, 10, n, 17)]]);
  const [j16, j17, j18] = [jour(16), jour(17), jour(18)];
  const enCours = jouer([['arrivee', a(9)]]);
  await s.enregistrerJourneeEnCours(enCours);
  for (const j of [j17, j18, j16]) await s.archiverJournee(j);
  assert.deepEqual((await s.listerHistorique()).map((j) => j.date), ['2026-11-18', '2026-11-17', '2026-11-16']);

  await s.supprimerJournee(j17.id);
  assert.deepEqual((await s.listerHistorique()).map((j) => j.date), ['2026-11-18', '2026-11-16']);
  // Rétablir une journée la remet à sa place.
  await s.archiverJournee(j17);
  assert.deepEqual((await s.listerHistorique()).map((j) => j.date), ['2026-11-18', '2026-11-17', '2026-11-16']);

  await s.effacerHistorique();
  assert.deepEqual(await s.listerHistorique(), []);
  assert.deepEqual(await s.chargerJourneeEnCours(), enCours);
});
