// Mise en forme des heures, dates et durées en français.

const deux = (n) => String(n).padStart(2, '0');

const fmtHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtHeureCourte = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDateLongue = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** « 14:05:09 » */
export const heure = (instant) => fmtHeure.format(new Date(instant));
/** « 14:05 » */
export const heureCourte = (instant) => fmtHeureCourte.format(new Date(instant));
/** « jeu. 19 nov. » */
export const dateCourte = (instant) => fmtDate.format(new Date(instant));
/** « jeudi 19 novembre » */
export const dateLongue = (instant) => fmtDateLongue.format(new Date(instant));

/** Date « AAAA-MM-JJ » (calendrier local) vers un objet Date à midi, sans décalage de fuseau. */
export function depuisDateLocale(texte) {
  const [a, m, j] = texte.split('-').map(Number);
  return new Date(a, m - 1, j, 12);
}

/** Compteur « 7:05:09 » */
export function compteur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`;
}

/** Durée lisible : « 7 h 05 », « 45 min », « 30 s » */
export function duree(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${deux(min)}`;
  if (min > 0) return `${min} min`;
  return `${s} s`;
}
