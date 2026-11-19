import test from 'node:test';
import assert from 'node:assert/strict';
import { ETATS, appliquer, bilan, etat, actionsPossibles, horodater } from '../js/pointage.js';
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
