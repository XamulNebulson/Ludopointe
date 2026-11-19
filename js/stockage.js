// Stockage : seul module qui lit et écrit les données.
//
// L'interface est volontairement petite et asynchrone. Pour centraliser les
// données plus tard, il suffira de fournir un autre objet offrant les quatre
// mêmes méthodes ; la logique (pointage.js) et l'interface (app.js) n'en
// dépendent pas autrement.
//
//   chargerJourneeEnCours()        -> journée | null
//   enregistrerJourneeEnCours(j)   -> void
//   archiverJournee(j)             -> void  (ajoute à l'historique et vide la journée en cours)
//   listerHistorique()             -> journées terminées, la plus récente d'abord

export const CLE = 'ludopointe/v1';

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
      const { historique } = lire();
      ecrire({ enCours: null, historique: [journee, ...historique.filter((j) => j.id !== journee.id)] });
    },
    async listerHistorique() {
      return lire().historique;
    },
  };
}
