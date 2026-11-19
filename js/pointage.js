// Logique de pointage : fonctions pures, sans DOM ni stockage.
//
// Une journée est { id, date, pointages: [{ type, horodatage }] }.
// Rien d'autre n'est enregistré : l'état et les durées sont toujours
// recalculés à partir des horodatages.

export const ETATS = Object.freeze({
  ABSENT: 'absent',
  AU_TRAVAIL: 'au_travail',
  EN_PAUSE: 'en_pause',
  TERMINEE: 'terminee',
});

export const LIBELLES = Object.freeze({
  arrivee: 'Arrivée',
  pause: 'Début de pause',
  reprise: 'Reprise',
  depart: 'Départ',
});

const TRANSITIONS = {
  absent: { arrivee: 'au_travail' },
  au_travail: { pause: 'en_pause', depart: 'terminee' },
  en_pause: { reprise: 'au_travail', depart: 'terminee' },
  terminee: {},
};

/** Horodatage ISO (UTC) tronqué à la seconde. */
export function horodater(date) {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

/** Date du calendrier local, « AAAA-MM-JJ ». */
export function dateLocale(date) {
  const deux = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
}

export function etat(journee) {
  let e = ETATS.ABSENT;
  for (const p of journee?.pointages ?? []) {
    const suivant = TRANSITIONS[e][p.type];
    if (!suivant) throw new Error(`Suite de pointages invalide : « ${p.type} » depuis « ${e} ».`);
    e = suivant;
  }
  return e;
}

export function actionsPossibles(journee) {
  return Object.keys(TRANSITIONS[etat(journee)]);
}

/**
 * Ajoute un pointage et renvoie une nouvelle journée (l'ancienne n'est pas modifiée).
 * `journee` vaut null avant l'arrivée. Lève une erreur si l'action n'est pas permise.
 *
 * Si l'horloge de l'appareil a reculé depuis le pointage précédent, l'heure de ce
 * dernier est reprise : les pointages restent ainsi dans l'ordre chronologique.
 */
export function appliquer(journee, type, maintenant) {
  if (!actionsPossibles(journee).includes(type)) {
    throw new Error(`Action « ${type} » impossible dans l'état « ${etat(journee)} ».`);
  }
  let horodatage = horodater(maintenant);
  const precedent = journee?.pointages.at(-1);
  if (precedent && horodatage < precedent.horodatage) horodatage = precedent.horodatage;

  if (type === 'arrivee') {
    return { id: horodatage, date: dateLocale(maintenant), pointages: [{ type, horodatage }] };
  }
  return { ...journee, pointages: [...journee.pointages, { type, horodatage }] };
}

/**
 * Bilan d'une journée à l'instant `maintenant` (ignoré une fois la journée terminée).
 * Le temps net est le temps entre arrivée et départ, pauses déduites. Une pause en
 * cours au moment du départ se termine au départ.
 */
export function bilan(journee, maintenant = new Date()) {
  const e = etat(journee);
  const resultat = {
    etat: e,
    travailMs: 0,
    pauseMs: 0,
    nbPauses: 0,
    arrivee: null,
    depart: null,
    depuis: null, // horodatage du dernier pointage
  };
  const pointages = journee?.pointages ?? [];
  if (pointages.length === 0) return resultat;

  const fin = e === ETATS.TERMINEE ? null : Math.floor(maintenant.getTime() / 1000) * 1000;
  for (let i = 0; i < pointages.length; i++) {
    const p = pointages[i];
    const debut = Date.parse(p.horodatage);
    const suivant = i + 1 < pointages.length ? Date.parse(pointages[i + 1].horodatage) : fin;
    const duree = suivant === null ? 0 : Math.max(0, suivant - debut);
    if (p.type === 'arrivee') resultat.arrivee = p.horodatage;
    if (p.type === 'depart') resultat.depart = p.horodatage;
    if (p.type === 'arrivee' || p.type === 'reprise') resultat.travailMs += duree;
    if (p.type === 'pause') {
      resultat.pauseMs += duree;
      resultat.nbPauses += 1;
    }
  }
  resultat.depuis = pointages.at(-1).horodatage;
  return resultat;
}
