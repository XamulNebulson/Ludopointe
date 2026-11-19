// Stockage : seul module qui lit et écrit les données.
//
// L'interface est volontairement petite et asynchrone. Pour centraliser les
// données plus tard, il suffira de fournir un autre objet offrant les mêmes
// méthodes ; la logique (pointage.js) et l'interface (app.js) n'en dépendent
// pas autrement.
//
//   chargerJourneeEnCours()        -> journée | null
//   enregistrerJourneeEnCours(j)   -> void  (j peut être null : plus de journée en cours)
//   archiverJournee(j)             -> void  (ajoute j à l'historique, ou l'y remplace ;
//                                            si j était la journée en cours, elle ne l'est plus)
//   listerHistorique()             -> journées terminées, la plus récente d'abord
//   supprimerJournee(id)           -> void  (retire une journée de l'historique)
//   effacerHistorique()            -> void  (vide l'historique, pas la journée en cours)

export const CLE = 'ludopointe/v1';

const arrivee = (journee) => journee?.pointages?.[0]?.horodatage ?? '';

export function creerStockageLocal(magasin = globalThis.localStorage, cle = CLE) {
  function lire() {
    try {
      const donnees = JSON.parse(magasin.getItem(cle));
      if (donnees && Array.isArray(donnees.historique)) {
        return { enCours: donnees.enCours ?? null, historique: donnees.historique };
      }
    } catch {
      // Données absentes ou illisibles : on repart d'un état vide.
    }
    return { enCours: null, historique: [] };
  }

  function ecrire(donnees) {
    magasin.setItem(cle, JSON.stringify(donnees));
  }

  return {
    async chargerJourneeEnCours() {
      return lire().enCours;
    },
    async enregistrerJourneeEnCours(journee) {
      ecrire({ ...lire(), enCours: journee });
    },
    async archiverJournee(journee) {
      const { enCours, historique } = lire();
      ecrire({
        enCours: enCours?.id === journee.id ? null : enCours,
        historique: [journee, ...historique.filter((j) => j.id !== journee.id)],
      });
    },
    async listerHistorique() {
      // Tri stable par heure d'arrivée, la plus récente d'abord.
      return [...lire().historique].sort((a, b) => (arrivee(a) < arrivee(b) ? 1 : arrivee(a) > arrivee(b) ? -1 : 0));
    },
    async supprimerJournee(id) {
      const donnees = lire();
      ecrire({ ...donnees, historique: donnees.historique.filter((j) => j.id !== id) });
    },
    async effacerHistorique() {
      ecrire({ ...lire(), historique: [] });
    },
  };
}
