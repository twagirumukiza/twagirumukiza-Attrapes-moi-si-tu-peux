# Attrape-moi si tu peux ! — Édition Olympique

## Nouveautés (v3)
- **Persistance de partie** : la course en cours (solo/local) est sauvegardée automatiquement. Si tu quittes l'onglet ou recharges la page, un écran "Partie en cours" te propose de reprendre exactement où tu en étais.
- **Double = rejoue** : si les deux dés affichent le même chiffre, le joueur (ou l'IA) rejoue immédiatement au lieu de passer la main.
- **Cartes bonus/malus à partir du 3ᵉ tour** : chaque tour à partir du 3ᵉ, le joueur pioche parmi deux cartes face cachée. L'une est un bonus (addition ou multiplication du résultat des dés), l'autre un malus (soustraction ou division). Impossible de savoir laquelle avant de la retourner — c'est la tombola.
- **Transparence totale** : la carte tirée (par un humain ou par l'IA) est révélée à l'écran pour tout le monde, reste affichée au moins 3 secondes, avec un son de joie pour un bonus et un son de désolation pour un malus.
- **Effet visible sur le plateau** : quand une carte s'applique, un anneau coloré (vert = bonus, rouge = malus) entoure le coureur pendant son déplacement, avec un texte flottant (ex. "+4", "÷2") qui s'élève au-dessus de lui.
- **Historique des cartes** : sous le plateau, la liste des cartes tirées par chaque athlète au fil de la partie.

## Ce qui a changé (v2)
- **Design** : piste en anneau façon stade (arène "tartan"), départ/arrivée marqué 🏁, dégradé et lumières de stade, couleurs inspirées des Jeux.
- **Animation** : chaque athlète court case par case dans le **sens inverse des aiguilles d'une montre** (au lieu d'un saut instantané), avec un léger "hop" à chaque pas.
- **Vitesse de déplacement réglable** : Lente (par défaut) / Normale / Rapide, dans le menu ☰. Ce réglage est personnel (stocké en local), il n'affecte pas la synchronisation en ligne.
- **Sons** : coup de starter au départ, bruit de pas pendant la course, "attrapé !" quand un adversaire est éliminé, fanfare + confettis à la victoire — tout est synthétisé en direct (aucun fichier audio à héberger).
- **Bug multijoueur corrigé** : `online.js` avait un bloc `try { … } catch` mal fermé, ce qui cassait le chargement du module Firebase (message "Unexpected keyword 'catch'"). Le fichier a été entièrement réécrit et validé (`node --check`).
- Le chemin des salons est passé de `catchmeRoomsV2` à `catchmeRoomsV3` (nouveau départ propre) — pense à mettre à jour les règles Firebase (voir plus bas).

## Firebase — à vérifier avant de tester le multijoueur
1. Dans la console Firebase du projet `focus-game-1c7ee` : **Authentication → Sign-in method → Anonymous** doit être activé.
2. Dans **Realtime Database → Règles**, ajoute (ou fusionne si tu as déjà des règles pour d'autres jeux comme Les Trois Brigands) le contenu de `database.rules.json` :
```json
{
  "rules": {
    "catchmeRoomsV3": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```
Ne remplace pas toutes tes règles existantes : ajoute juste la branche `catchmeRoomsV3` à côté de `rooms`, `morabarabaRooms`, etc.

## Déploiement GitHub Pages
Place à la racine du repo : `index.html`, `style.css`, `script.js`, `online.js`, `firebase-init.js`.

by twagirumukiza
