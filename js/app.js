// Interface : relie la logique (pointage.js), le stockage (stockage.js) et l'affichage.

import { ETATS, LIBELLES, appliquer, bilan, dateLocale } from './pointage.js';
import { creerStockageLocal } from './stockage.js';
import * as fmt from './format.js';

const stockage = creerStockageLocal();
const $ = (id) => document.getElementById(id);

let enCours = null; // journée ouverte, ou null
let historique = []; // journées terminées, la plus récente d'abord
let confirmationDepart = false;
let minuterieConfirmation = null;

const ACTION_PRINCIPALE = {
  [ETATS.ABSENT]: { type: 'arrivee', texte: 'Pointer l’arrivée', ton: 'travail' },
  [ETATS.AU_TRAVAIL]: { type: 'pause', texte: 'Partir en pause', ton: 'pause' },
  [ETATS.EN_PAUSE]: { type: 'reprise', texte: 'Reprendre le travail', ton: 'travail' },
};

// ---------- Données ----------

async function charger() {
  try {
    enCours = await stockage.chargerJourneeEnCours();
    historique = await stockage.listerHistorique();
    // Vérifie que les données relues sont cohérentes avant de les afficher.
    bilan(enCours);
  } catch (erreur) {
    console.error(erreur);
    enCours = null;
    signaler('Les données enregistrées sont illisibles.');
  }
  afficher();
}

async function pointer(type) {
  signaler(null);
  try {
    const journee = appliquer(enCours, type, new Date());
    if (type === 'depart') {
      await stockage.archiverJournee(journee);
      enCours = null;
    } else {
      await stockage.enregistrerJourneeEnCours(journee);
      enCours = journee;
    }
    historique = await stockage.listerHistorique();
  } catch (erreur) {
    console.error(erreur);
    signaler('Le pointage n’a pas pu être enregistré. Réessayez.');
  }
  demanderConfirmation(false);
  afficher();
}

// ---------- Affichage ----------

/** Journée à montrer : celle en cours, sinon la dernière terminée si elle date d'aujourd'hui. */
function journeeAffichee(maintenant) {
  if (enCours) return enCours;
  const derniere = historique[0];
  return derniere && derniere.date === dateLocale(maintenant) ? derniere : null;
}

function afficher() {
  const maintenant = new Date();
  const journee = journeeAffichee(maintenant);
  const b = bilan(journee, maintenant);
  const etatCourant = enCours ? b.etat : ETATS.ABSENT;

  // État
  const etat = $('etat');
  etat.dataset.etat = b.etat;
  etat.textContent = {
    [ETATS.ABSENT]: 'Pas encore pointé',
    [ETATS.AU_TRAVAIL]: 'Au travail',
    [ETATS.EN_PAUSE]: `En pause depuis ${fmt.heureCourte(b.depuis ?? maintenant)}`,
    [ETATS.TERMINEE]: 'Journée terminée',
  }[b.etat];

  // Résumé sous le compteur
  const morceaux = [];
  if (b.depart) morceaux.push(`${fmt.heureCourte(b.arrivee)} – ${fmt.heureCourte(b.depart)}`);
  else if (b.arrivee) morceaux.push(`Arrivée ${fmt.heureCourte(b.arrivee)}`);
  if (b.nbPauses > 0) morceaux.push(`Pauses <span id="temps-pause"></span>`);
  $('resume').innerHTML = morceaux.join(' · ');

  // Journée restée ouverte depuis un autre jour
  const ancienne = enCours && enCours.date !== dateLocale(maintenant);
  if (ancienne) {
    signaler(`Journée commencée ${fmt.dateLongue(fmt.depuisDateLocale(enCours.date))} : pensez à pointer le départ.`, 'rappel');
  } else if ($('alerte').dataset.genre === 'rappel') {
    signaler(null);
  }

  // Action principale
  const action = ACTION_PRINCIPALE[etatCourant];
  const bouton = $('action-principale');
  bouton.textContent = action.texte;
  bouton.dataset.type = action.type;
  bouton.dataset.ton = action.ton;

  // Départ
  $('zone-depart').hidden = etatCourant === ETATS.ABSENT;
  $('depart').hidden = confirmationDepart;
  $('confirmation').hidden = !confirmationDepart;

  // Pointages du jour
  const liste = $('pointages');
  liste.replaceChildren(...lignesPointages(journee, Boolean(enCours)));
  $('pointages-vide').hidden = Boolean(journee);

  afficherHistorique();
  afficherTemps();
}

/** Partie rafraîchie chaque seconde : horloge et compteurs. */
function afficherTemps() {
  const maintenant = new Date();
  const b = bilan(journeeAffichee(maintenant), maintenant);
  $('compteur').textContent = fmt.compteur(b.travailMs);
  const pause = $('temps-pause');
  if (pause) pause.textContent = fmt.compteur(b.pauseMs);
  $('date-jour').textContent = fmt.dateCourte(maintenant);
  $('heure-actuelle').textContent = fmt.heure(maintenant);
}

function icone(nom, classe) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (classe) svg.setAttribute('class', classe);
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#i-${nom}`);
  svg.append(use);
  return svg;
}

function element(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}

/** Les pointages forment un parcours de cases ; le pion est posé sur la dernière si la journée est en cours. */
function lignesPointages(journee, avecPion) {
  const pointages = journee?.pointages ?? [];
  return pointages.map((p, i) => {
    const li = element('li', 'case-ligne');
    li.dataset.type = p.type;
    const jeton = element('span', 'case');
    jeton.append(icone(p.type));
    const temps = element('time', 'case-heure', fmt.heure(p.horodatage));
    temps.dateTime = p.horodatage;
    li.append(jeton, element('span', 'case-nom', LIBELLES[p.type]), temps);
    if (avecPion && i === pointages.length - 1) li.append(icone('pion', 'pion'));
    return li;
  });
}

function afficherHistorique() {
  $('historique-nb').textContent = historique.length ? String(historique.length) : '';
  $('historique-vide').hidden = historique.length > 0;
  const ouvertes = new Set(
    [...document.querySelectorAll('#historique-liste details[open]')].map((d) => d.dataset.id),
  );
  $('historique-liste').replaceChildren(
    ...historique.map((journee) => {
      const b = bilan(journee);
      const details = element('details', 'jour');
      details.dataset.id = journee.id;
      details.open = ouvertes.has(journee.id);

      const resume = element('summary');
      resume.append(
        element('span', 'jour-date', fmt.dateCourte(fmt.depuisDateLocale(journee.date))),
        element('span', 'jour-heures', `${fmt.heureCourte(b.arrivee)} – ${fmt.heureCourte(b.depart)}`),
        element('span', 'jour-net', fmt.duree(b.travailMs)),
      );

      const pauses =
        b.nbPauses === 0
          ? 'Sans pause'
          : `${b.nbPauses} pause${b.nbPauses > 1 ? 's' : ''} · ${fmt.duree(b.pauseMs)}`;
      const liste = element('ol', 'parcours');
      liste.append(...lignesPointages(journee, false));
      details.append(resume, element('p', 'jour-pauses', pauses), liste);

      const li = element('li');
      li.append(details);
      return li;
    }),
  );
}

function signaler(message, genre = 'erreur') {
  const alerte = $('alerte');
  alerte.hidden = !message;
  alerte.textContent = message ?? '';
  alerte.dataset.genre = message ? genre : '';
}

function demanderConfirmation(active) {
  confirmationDepart = active;
  clearTimeout(minuterieConfirmation);
  // Sans réponse, la demande s'annule d'elle-même.
  if (active) minuterieConfirmation = setTimeout(() => { demanderConfirmation(false); afficher(); }, 8000);
}

// ---------- Événements ----------

$('action-principale').addEventListener('click', (e) => pointer(e.currentTarget.dataset.type));
$('depart').addEventListener('click', () => { demanderConfirmation(true); afficher(); $('depart-confirmer').focus(); });
$('depart-annuler').addEventListener('click', () => { demanderConfirmation(false); afficher(); $('depart').focus(); });
$('depart-confirmer').addEventListener('click', () => pointer('depart'));

setInterval(afficherTemps, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) afficher(); });
// Un pointage fait dans un autre onglet du même navigateur.
window.addEventListener('storage', charger);

charger();
