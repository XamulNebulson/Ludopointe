// Interface : relie la logique (pointage.js), le stockage (stockage.js) et l'affichage.

import {
  ETATS, LIBELLES, ErreurCorrection, annulerDernier, appliquer, bilan, corrigerHeures, dateLocale,
} from './pointage.js';
import { creerStockageLocal } from './stockage.js';
import * as fmt from './format.js';

const stockage = creerStockageLocal();
const $ = (id) => document.getElementById(id);

let enCours = null; // journée ouverte, ou null
let historique = []; // journées terminées, la plus récente d'abord
let confirmationDepart = false;
let minuterieConfirmation = null;

// Corrections et suppressions.
let correction = null; // journée en cours de correction : 'jour' ou l'identifiant d'une journée de l'historique
let retablissement = null; // { texte, retablir } : dernière suppression, annulable quelques secondes
let minuterieRetablissement = null;
let version = 0; // augmente à chaque modification : indique quand redessiner les listes
let cleListes = null;

const DELAI_CONFIRMATION = 8000; // une demande sans réponse s'annule d'elle-même
const DELAI_RETABLISSEMENT = 10000;
const DELAI_ANTI_DOUBLE_APPUI = 500; // un double appui ne doit jamais valider une suppression
const MOT_EFFACER = 'EFFACER';

const ACTION_PRINCIPALE = {
  [ETATS.ABSENT]: { type: 'arrivee', texte: 'Pointer l’arrivée', ton: 'travail' },
  [ETATS.AU_TRAVAIL]: { type: 'pause', texte: 'Partir en pause', ton: 'pause' },
  [ETATS.EN_PAUSE]: { type: 'reprise', texte: 'Reprendre le travail', ton: 'travail' },
};

// ---------- Données ----------

async function relire() {
  enCours = await stockage.chargerJourneeEnCours();
  historique = await stockage.listerHistorique();
}

async function charger() {
  try {
    await relire();
    // Vérifie que les données relues sont cohérentes avant de les afficher.
    bilan(enCours);
  } catch (erreur) {
    console.error(erreur);
    enCours = null;
    signaler('Les données enregistrées sont illisibles.');
  }
  oublierRetablissement();
  afficher();
}

/** Exécute une modification des données, puis relit et réaffiche. Renvoie true si elle a réussi. */
async function executer(operation, echec = 'La modification n’a pas pu être enregistrée. Réessayez.') {
  let reussi = true;
  signaler(null);
  try {
    await operation();
  } catch (erreur) {
    console.error(erreur);
    signaler(echec);
    reussi = false;
  }
  try {
    await relire();
  } catch (erreur) {
    console.error(erreur);
  }
  version++;
  afficher();
  return reussi;
}

async function pointer(type) {
  oublierRetablissement();
  correction = null;
  demanderConfirmation(false);
  await executer(async () => {
    const journee = appliquer(enCours, type, new Date());
    if (type === 'depart') await stockage.archiverJournee(journee);
    else await stockage.enregistrerJourneeEnCours(journee);
  }, 'Le pointage n’a pas pu être enregistré. Réessayez.');
}

/** Enregistre une journée modifiée là où elle se trouve : en cours, ou dans l'historique. */
async function enregistrerCorrection(journee) {
  oublierRetablissement();
  correction = null;
  await executer(() =>
    enCours?.id === journee.id ? stockage.enregistrerJourneeEnCours(journee) : stockage.archiverJournee(journee),
  );
}

/** Retire le dernier pointage de la journée affichée ; retirer un départ rouvre la journée. */
async function retirerDernier(journee) {
  const terminee = enCours?.id !== journee.id;
  const restante = annulerDernier(journee);
  correction = null;
  const reussi = await executer(async () => {
    await stockage.enregistrerJourneeEnCours(restante);
    if (terminee) await stockage.supprimerJournee(journee.id);
  });
  if (reussi) {
    proposerRetablissement('Dernier pointage retiré.', () =>
      terminee ? stockage.archiverJournee(journee) : stockage.enregistrerJourneeEnCours(journee),
    );
  }
}

async function supprimerJournee(journee) {
  if (correction === journee.id) correction = null;
  const reussi = await executer(() => stockage.supprimerJournee(journee.id));
  if (reussi) {
    proposerRetablissement(`Journée du ${fmt.dateCourte(fmt.depuisDateLocale(journee.date))} supprimée.`, () =>
      stockage.archiverJournee(journee),
    );
  }
}

async function effacerHistorique() {
  const supprimees = historique;
  if (correction !== 'jour') correction = null;
  const reussi = await executer(() => stockage.effacerHistorique());
  if (reussi) {
    const n = supprimees.length;
    proposerRetablissement(`${n} journée${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}.`, async () => {
      for (const journee of supprimees) await stockage.archiverJournee(journee);
    });
  }
}

// ---------- Rétablissement ----------

function proposerRetablissement(texte, retablir) {
  clearTimeout(minuterieRetablissement);
  retablissement = { texte, retablir };
  minuterieRetablissement = setTimeout(() => { oublierRetablissement(); afficher(); }, DELAI_RETABLISSEMENT);
  afficher();
}

function oublierRetablissement() {
  clearTimeout(minuterieRetablissement);
  retablissement = null;
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

  // Listes : redessinées seulement si quelque chose a changé, pour ne pas
  // interrompre une saisie ou une confirmation en cours.
  if (correction === 'jour' && !journee) correction = null;
  const cle = JSON.stringify([version, enCours, historique, correction, dateLocale(maintenant)]);
  if (cle !== cleListes) {
    cleListes = cle;
    afficherJour(journee);
    afficherHistorique();
  }

  // Rétablissement d'une suppression
  $('retablir').hidden = !retablissement;
  $('retablir-texte').textContent = retablissement?.texte ?? '';

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

function bouton(classe, texte) {
  const b = element('button', classe, texte);
  b.type = 'button';
  return b;
}

/**
 * Les pointages forment un parcours de cases ; le pion est posé sur la dernière si la journée est en cours.
 * En correction, chaque heure devient un champ de saisie.
 */
function lignesPointages(journee, { pion = false, edition = false } = {}) {
  const pointages = journee?.pointages ?? [];
  return pointages.map((p, i) => {
    const li = element('li', 'case-ligne');
    li.dataset.type = p.type;
    const jeton = element('span', 'case');
    jeton.append(icone(p.type));
    li.append(jeton, element('span', 'case-nom', LIBELLES[p.type]));

    if (edition) {
      const saisie = element('input', 'case-saisie');
      saisie.type = 'time';
      saisie.value = saisie.dataset.initiale = fmt.heureSaisie(p.horodatage);
      saisie.setAttribute('aria-label', `Heure : ${LIBELLES[p.type]}`);
      li.append(saisie);
      return li;
    }

    if (p.corrige) {
      const marque = element('span', 'corrige');
      marque.title = 'Heure corrigée à la main';
      marque.append(icone('crayon'), element('span', 'discret-lecteur', 'corrigé'));
      li.append(marque);
    }
    const temps = element('time', 'case-heure', fmt.heure(p.horodatage));
    temps.dateTime = p.horodatage;
    li.append(temps);
    if (pion && i === pointages.length - 1) li.append(icone('pion', 'pion'));
    return li;
  });
}

function texteRefus(journee, refus) {
  const nom = `« ${LIBELLES[journee.pointages[refus.index].type]} »`;
  if (!refus.max) return `${nom} : indiquez une heure.`;
  if (!refus.min) {
    return refus.jusquAMaintenant
      ? `${nom} : l’heure ne peut pas être dans le futur.`
      : `${nom} : l’heure doit être au plus tard ${fmt.heureCourte(refus.max)}.`;
  }
  const fin = refus.jusquAMaintenant ? 'maintenant' : fmt.heureCourte(refus.max);
  return `${nom} : l’heure doit être comprise entre ${fmt.heureCourte(refus.min)} et ${fin}.`;
}

/**
 * Outils d'une journée en correction : les heures saisies dans `liste` ne sont
 * enregistrées qu'à l'appui sur « Enregistrer », toutes ensemble.
 */
function outilsCorrection(journee, liste) {
  const refus = element('p', 'alerte');
  refus.setAttribute('role', 'alert');
  refus.hidden = true;
  const enregistrer = bouton('bouton valider', 'Enregistrer');
  enregistrer.disabled = true;
  const annuler = bouton('bouton discret', 'Annuler');
  const choix = element('div', 'choix');
  choix.append(annuler, enregistrer);

  const saisies = () => [...liste.querySelectorAll('.case-saisie')];
  liste.oninput = () => {
    enregistrer.disabled = !saisies().some((s) => s.value !== s.dataset.initiale);
  };
  annuler.addEventListener('click', () => { correction = null; afficher(); });
  enregistrer.addEventListener('click', () => {
    const champs = saisies();
    for (const champ of champs) champ.removeAttribute('aria-invalid');
    let corrigee;
    try {
      corrigee = corrigerHeures(journee, champs.map((s) => (s.value === s.dataset.initiale ? null : s.value)), new Date());
    } catch (erreur) {
      if (!(erreur instanceof ErreurCorrection)) throw erreur;
      champs[erreur.index].setAttribute('aria-invalid', 'true');
      refus.textContent = texteRefus(journee, erreur);
      refus.hidden = false;
      return;
    }
    enregistrerCorrection(corrigee);
  });

  return [element('p', 'vide', 'Modifiez les heures, puis enregistrez.'), refus, choix];
}

/**
 * Action en deux temps : un premier appui pose la question, un second confirme.
 * La question se referme seule ; la confirmation n'est pas sous le doigt et
 * ignore un double appui.
 */
function aDeuxTemps({ libelle, question, confirmer, action, masquer = [] }) {
  const bloc = element('div', 'deux-temps');
  const declencheur = bouton('lien danger', libelle);
  const demande = element('div', 'demande');
  demande.hidden = true;
  const garder = bouton('bouton discret', 'Garder');
  const oui = bouton('bouton depart', confirmer);
  const choix = element('div', 'choix');
  choix.append(garder, oui);
  demande.append(element('p', 'question', question), choix);
  bloc.append(declencheur, demande);

  let minuterie = null;
  let ouvertA = 0;
  const basculer = (ouvert) => {
    clearTimeout(minuterie);
    declencheur.hidden = ouvert;
    for (const autre of masquer) autre.hidden = ouvert;
    demande.hidden = !ouvert;
    bloc.classList.toggle('ouvert', ouvert);
    if (ouvert) {
      ouvertA = Date.now();
      minuterie = setTimeout(() => basculer(false), DELAI_CONFIRMATION);
    }
  };
  declencheur.addEventListener('click', () => { basculer(true); garder.focus(); });
  garder.addEventListener('click', () => { basculer(false); declencheur.focus(); });
  oui.addEventListener('click', () => {
    if (Date.now() - ouvertA < DELAI_ANTI_DOUBLE_APPUI) return;
    clearTimeout(minuterie);
    action();
  });
  return bloc;
}

function afficherJour(journee) {
  const edition = correction === 'jour';
  const liste = $('pointages');
  liste.classList.toggle('edition', edition);
  liste.oninput = null;
  liste.replaceChildren(...lignesPointages(journee, { pion: Boolean(enCours), edition }));
  $('pointages-vide').hidden = Boolean(journee);
  $('corriger-jour').hidden = !journee || edition;

  const outils = $('outils-jour');
  outils.replaceChildren();
  if (!edition) return;
  const dernier = journee.pointages.at(-1);
  outils.append(
    ...outilsCorrection(journee, liste),
    aDeuxTemps({
      libelle: 'Retirer le dernier pointage',
      question: `Retirer « ${LIBELLES[dernier.type]} » de ${fmt.heureCourte(dernier.horodatage)} ?`,
      confirmer: 'Retirer',
      action: () => retirerDernier(journee),
    }),
  );
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
      const edition = correction === journee.id;
      const date = fmt.dateCourte(fmt.depuisDateLocale(journee.date));
      const details = element('details', 'jour');
      details.dataset.id = journee.id;
      details.open = edition || ouvertes.has(journee.id);

      const resume = element('summary');
      resume.append(
        element('span', 'jour-date', date),
        element('span', 'jour-heures', `${fmt.heureCourte(b.arrivee)} – ${fmt.heureCourte(b.depart)}`),
        element('span', 'jour-net', fmt.duree(b.travailMs)),
      );

      const pauses =
        b.nbPauses === 0
          ? 'Sans pause'
          : `${b.nbPauses} pause${b.nbPauses > 1 ? 's' : ''} · ${fmt.duree(b.pauseMs)}`;
      const liste = element('ol', edition ? 'parcours edition' : 'parcours');
      liste.append(...lignesPointages(journee, { edition }));

      const outils = element('div', 'outils');
      if (edition) {
        outils.append(...outilsCorrection(journee, liste));
      } else {
        const corriger = bouton('lien', 'Corriger');
        corriger.addEventListener('click', () => { correction = journee.id; afficher(); });
        outils.classList.add('actions');
        outils.append(
          corriger,
          aDeuxTemps({
            libelle: 'Supprimer',
            question: `Supprimer définitivement la journée du ${date} ?`,
            confirmer: 'Supprimer',
            action: () => supprimerJournee(journee),
            masquer: [corriger],
          }),
        );
      }
      details.append(resume, element('p', 'jour-pauses', pauses), liste, outils);

      const li = element('li');
      li.append(details);
      return li;
    }),
  );
  afficherEffacerTout();
}

/** Tout effacer demande de saisir un mot : impossible à faire par mégarde. */
function afficherEffacerTout() {
  const zone = $('effacer-tout');
  zone.replaceChildren();
  const n = historique.length;
  if (n === 0) return;

  const declencheur = bouton('lien danger', 'Effacer tout l’historique');
  const demande = element('div', 'demande');
  demande.hidden = true;
  const saisie = element('input', 'saisie-mot');
  saisie.type = 'text';
  saisie.id = 'effacer-mot';
  saisie.autocomplete = 'off';
  saisie.spellcheck = false;
  saisie.setAttribute('autocapitalize', 'characters');
  saisie.setAttribute('aria-label', `Saisir ${MOT_EFFACER} pour confirmer`);
  const garder = bouton('bouton discret', 'Garder');
  const oui = bouton('bouton depart', 'Tout effacer');
  oui.disabled = true;
  const choix = element('div', 'choix');
  choix.append(garder, oui);
  demande.append(
    element('p', 'question', `Pour effacer définitivement ${n > 1 ? `les ${n} journées` : 'la journée'} de l’historique, saisissez ${MOT_EFFACER}.`),
    saisie,
    choix,
  );

  const basculer = (ouvert) => {
    declencheur.hidden = ouvert;
    demande.hidden = !ouvert;
    saisie.value = '';
    oui.disabled = true;
  };
  declencheur.addEventListener('click', () => { basculer(true); saisie.focus(); });
  garder.addEventListener('click', () => { basculer(false); declencheur.focus(); });
  saisie.addEventListener('input', () => { oui.disabled = saisie.value.trim().toUpperCase() !== MOT_EFFACER; });
  oui.addEventListener('click', () => effacerHistorique());
  zone.append(declencheur, demande);
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
  if (active) minuterieConfirmation = setTimeout(() => { demanderConfirmation(false); afficher(); }, DELAI_CONFIRMATION);
}

// ---------- Événements ----------

$('action-principale').addEventListener('click', (e) => pointer(e.currentTarget.dataset.type));
$('depart').addEventListener('click', () => { demanderConfirmation(true); afficher(); $('depart-confirmer').focus(); });
$('depart-annuler').addEventListener('click', () => { demanderConfirmation(false); afficher(); $('depart').focus(); });
$('depart-confirmer').addEventListener('click', () => pointer('depart'));
$('corriger-jour').addEventListener('click', () => { correction = 'jour'; afficher(); });
$('retablir-bouton').addEventListener('click', () => {
  const { retablir } = retablissement ?? {};
  oublierRetablissement();
  if (retablir) executer(retablir);
});

setInterval(afficherTemps, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) afficher(); });
// Un pointage fait dans un autre onglet du même navigateur.
window.addEventListener('storage', charger);

charger();
