// Installation sur l'écran d'accueil et fonctionnement hors-ligne.
// Indépendant du pointage : ce module peut être retiré sans rien casser.

const bouton = document.getElementById('installer');
const aide = document.getElementById('installer-aide');

const dejaInstallee =
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let invite = null; // proposition d'installation fournie par le navigateur (Android, ordinateur)

if (!dejaInstallee) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    invite = e;
    bouton.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    bouton.hidden = true;
    aide.hidden = true;
  });
  // Apple ne permet pas de déclencher l'installation : on explique le geste.
  if (iOS) bouton.hidden = false;

  bouton.addEventListener('click', async () => {
    if (invite) {
      invite.prompt();
      await invite.userChoice?.catch(() => {});
      invite = null;
      bouton.hidden = true;
    } else {
      aide.hidden = !aide.hidden;
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((erreur) => console.warn('Hors-ligne indisponible :', erreur));
}
