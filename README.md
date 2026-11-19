# Ludopointe

Appli de pointage pour les employés d'une ludothèque, pensée pour le téléphone.

- Pointer l'arrivée, autant de pauses et de reprises que nécessaire, puis le départ (y compris pendant une pause).
- État en cours, temps de travail net, détail des pointages du jour, historique des journées terminées.
- Chaque pointage est horodaté à la seconde avec l'horloge de l'appareil.
- Les données restent dans le navigateur de l'appareil (`localStorage`) : ni compte, ni synchronisation, ni partage.
  Un appareil correspond donc à une personne. Effacer les données du site dans le navigateur efface les pointages.

## Utilisation

Site statique sans dépendance ni étape de construction : il suffit de servir le dossier
(GitHub Pages, par exemple). En local :

```bash
npm start        # http://localhost:8080
```

## Installation sur téléphone

L'appli est une application web installable : pas de magasin d'applications, un simple lien suffit.

1. Ouvrir le lien de l'appli sur le téléphone.
2. Toucher « Installer l'appli sur ce téléphone » en bas de la page
   (sur iPhone, depuis Safari : bouton Partager, puis « Sur l'écran d'accueil »).

L'icône Ludopointe apparaît alors sur l'écran d'accueil ; l'appli s'ouvre en plein écran et
fonctionne sans réseau une fois ouverte une première fois (`sw.js` garde une copie des fichiers).
Désinstaller l'appli ou effacer les données du navigateur efface les pointages.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `js/pointage.js` | Logique pure : états, actions permises, calcul des durées. Ni DOM ni stockage. |
| `js/stockage.js` | Seul module qui lit et écrit les données (aujourd'hui `localStorage`, clé `ludopointe/v1`). |
| `js/format.js` | Heures, dates et durées en français. |
| `js/app.js` | Interface : relie les trois modules ci-dessus à la page. |
| `js/installation.js`, `sw.js` | Installation sur l'écran d'accueil et fonctionnement hors-ligne. |
| `outils/icones.mjs` | Régénère les icônes PNG de `icones/` à partir de `icone.svg`. |

Seuls les pointages sont enregistrés (`{ type, horodatage }`). L'état et le temps net sont
recalculés à partir des horodatages à chaque affichage : le compteur est figé en pause et reste
exact après rechargement.

Pour centraliser les données plus tard, il suffira de remplacer `js/stockage.js` par un module
offrant les quatre mêmes méthodes asynchrones ; le reste du code n'a pas à changer.

Cas particuliers :

- Une journée appartient à la date de son arrivée. Si le départ a été oublié, elle reste ouverte
  et un rappel s'affiche le lendemain ; elle peut alors être clôturée.
- Pointer une nouvelle arrivée après un départ ouvre une nouvelle journée (deux lignes dans l'historique).
- Les pointages ne peuvent pas être corrigés ni supprimés depuis l'appli.

## Tests

```bash
npm test         # logique et stockage (Node 20+)
npm run e2e      # parcours dans Chromium au format téléphone ; demande Playwright (npm i -g playwright)
```

Les parcours couvrent : journée sans pause, plusieurs pauses, départ pendant une pause,
rechargement de la page au travail et en pause, journée restée ouverte jusqu'au lendemain,
rechargement sans réseau, lien d'installation.
