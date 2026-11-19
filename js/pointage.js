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

// ---------- Corrections ----------

/** Heure refusée lors d'une correction. `min` et `max` (ISO) bornent ce qui aurait été accepté ; null si l'heure est illisible. */
export class ErreurCorrection extends Error {
  constructor(index, min, max, jusquAMaintenant) {
    super(`Heure refusée pour le pointage n° ${index + 1}.`);
    this.name = 'ErreurCorrection';
    Object.assign(this, { index, min, max, jusquAMaintenant });
  }
}

/**
 * Corrige des heures d'une journée et renvoie une nouvelle journée.
 * `heures[i]` vaut « HH:MM » pour changer le pointage i, null pour le garder tel quel.
 *
 * Les pointages doivent rester dans l'ordre : chaque heure corrigée se situe entre le
 * pointage précédent et le prochain pointage conservé (ou maintenant s'il n'y en a pas).
 * Une correction se fait à la minute ; elle est marquée `corrige: true`, ce qui la
 * distingue d'un pointage pris sur l'horloge de l'appareil.
 *
 * L'heure est cherchée le jour du pointage d'origine, sinon la veille (départ oublié puis
 * pointé le lendemain). L'arrivée ne change jamais de jour.
 */
export function corrigerHeures(journee, heures, maintenant) {
  const anciens = journee.pointages;
  const present = Math.floor(maintenant.getTime() / 1000) * 1000;
  const iso = (ms) => new Date(ms).toISOString();
  const nouveaux = [];

  for (let i = 0; i < anciens.length; i++) {
    const ancien = anciens[i];
    const voulue = heures[i] ?? null;
    if (voulue === null) {
      nouveaux.push(ancien);
      continue;
    }
    const lue = /^(\d{1,2}):(\d{2})$/.exec(voulue);
    if (!lue || Number(lue[1]) > 23 || Number(lue[2]) > 59) throw new ErreurCorrection(i, null, null, false);

    const min = i > 0 ? Date.parse(nouveaux[i - 1].horodatage) : null;
    const conserve = anciens.findIndex((_, k) => k > i && (heures[k] ?? null) === null);
    const max = conserve === -1 ? present : Date.parse(anciens[conserve].horodatage);

    const origine = new Date(ancien.horodatage);
    let instant = null;
    for (const decalage of i === 0 ? [0] : [0, -1]) {
      const debut = new Date(
        origine.getFullYear(), origine.getMonth(), origine.getDate() + decalage, Number(lue[1]), Number(lue[2]),
      ).getTime();
      // La minute demandée doit recouper l'intervalle permis ; on y prend le premier instant possible.
      if (debut > max || (min !== null && debut + 59_000 < min)) continue;
      instant = min === null ? debut : Math.max(debut, min);
      break;
    }
    if (instant === null) throw new ErreurCorrection(i, min === null ? null : iso(min), iso(max), conserve === -1);

    const horodatage = iso(instant);
    nouveaux.push(horodatage === ancien.horodatage ? ancien : { ...ancien, horodatage, corrige: true });
  }

  const corrigee = { ...journee, pointages: nouveaux };
  etat(corrigee); // lève une erreur si la suite n'est plus valide
  return corrigee;
}

/** Retire le dernier pointage. Renvoie null s'il ne restait que l'arrivée. */
export function annulerDernier(journee) {
  if (journee.pointages.length <= 1) return null;
  return { ...journee, pointages: journee.pointages.slice(0, -1) };
}
