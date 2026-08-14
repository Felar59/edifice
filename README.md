# Édifice — le musée impossible

Un musée dont l'architecture est physiquement impossible, et dont chaque salle est
une machine en état de marche. Le plan complet est dans
[`PLAN.md`](https://github.com/Felar59/portfolio-museum/blob/master/PLAN.md) du
dépôt du portfolio ; ce dépôt-ci contient le moteur.

**État : étape 1 terminée.** Deux pièces, deux coutures, un portail qu'on n'arrive
pas à prendre en défaut.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5190
npm run torture    # les invariants + les captures dans shots/
npm run check      # typage
```

Il faut un navigateur avec WebGPU : Chrome ou Edge à jour.

Commandes : `ZQSD`/`WASD` pour se déplacer, `Maj` pour courir, `F` pour lancer un
cube, `R` pour tout retirer, `[` et `]` pour la profondeur de récursion, `H` pour
masquer les panneaux, `1`–`7` pour les points de vue du test.

## Ce qui est fait

### L'espace cousu

Le monde n'est pas un espace unique mais un **graphe de cellules** reliées par des
**coutures**. Une couture est une ouverture rectangulaire porteuse d'une
transformation rigide : franchir cette ouverture, c'est changer de repère. Les
deux pièces de l'étape 1 sont éloignées de trente mètres, de tailles différentes
(10 × 4 × 10 contre 16 × 8 × 16) et pivotées d'un quart de tour — de sorte
qu'aucune coïncidence de position ne puisse masquer une erreur de calcul.

Chaque pièce a **deux** ouvertures, sur ses parois opposées. Le couloir n'a donc
pas de fin : il alterne les deux salles indéfiniment. C'est le cas le plus dur du
rendu de portails, et il valait mieux l'avoir sous les yeux dès le premier jour.

### Le rendu

Récursion en profondeur d'abord. Pour dessiner une cellule, on dessine d'abord
dans des textures séparées ce qu'on aperçoit à travers chacune de ses bouches,
puis la cellule elle-même, puis on peint chaque ouverture avec l'image
correspondante. Les passes étant encodées dans le même tampon de commandes,
l'ordre d'exécution garantit que l'image d'un enfant est prête quand son parent la
lit.

Trois décisions valent d'être expliquées.

**Textures plein écran plutôt que stencil.** Le rendu par stencil évite les
textures intermédiaires mais devient inextricable au-delà de deux niveaux. Avec
des cibles de la taille de la fenêtre, la caméra virtuelle conserve exactement la
même projection en x et y, donc le pixel cherché est au même endroit à l'écran :
un `textureLoad` à la position du fragment est **exact**, sans filtrage ni dérive
d'un demi-pixel.

**Plan proche oblique.** Sans lui, la paroi qui contient la bouche de sortie
apparaît en tranche dès qu'on approche le visage de l'ouverture — le défaut qui
trahit immédiatement un portail bricolé. La méthode d'Eric Lengyel s'applique, à
une correction près : la version qui circule partout suppose un z de clip dans
[-1, 1] à la façon d'OpenGL, alors que WebGPU utilise [0, 1]. Recopiée telle
quelle, elle décale le plan proche. Voir `src/math/mat4.ts`.

**Une bouche vue de dos ne se dessine pas.** C'est le point qui a coûté le plus
cher à trouver. Il ne suffit pas de distinguer « avec image » et « sans image » :
il faut un troisième état, « invisible ». Une bouche prise de dos n'est pas une
surface, c'est un trou — et comme la bouche de sortie occupe à l'écran exactement
la zone que le parent s'apprête à lire, y poser un aplat recouvre toute l'image
utile. Le symptôme était une porte uniformément grise alors que tous les
compteurs indiquaient une récursion correcte.

### Le déplacement

Un pas ne peut pas s'appliquer d'un bloc : sur une seule image, un corps peut
franchir une couture, ressortir ailleurs, glisser contre un mur et franchir une
seconde couture. Le pas est donc découpé en sous-pas de quatre centimètres, et à
chaque sous-pas on teste la traversée **avant** la collision — dans l'autre sens,
le mur qui contient la porte arrêterait net celui qui cherche à la franchir.

Les vecteurs à transporter (direction du regard, verticale locale, vitesse) sont
passés à `advance` et transformés à chaque traversée. L'orientation du visiteur
n'est pas stockée en angles d'Euler mais comme un regard plus une verticale : une
couture peut faire pivoter le monde n'importe comment, et le tunnel-vrille comme
la gravité par face exigent que « le haut » cesse d'être une constante.

Les objets lancés passent par le même code. Un cube qui traverse l'ouverture,
atterrit de l'autre côté et reste visible **à travers** l'ouverture prouve d'un
coup que la géométrie, le déplacement et le rendu partagent bien la même
transformation — un portail purement visuel se trahit ici en une seconde.

## Le test de torture

`npm run torture` fait deux choses.

**Les invariants**, vérifiés par le calcul : rigidité et orientation de chaque
transformation, coïncidence des bouches, normale retournée, verticale conservée,
aller-retour strictement neutre, mille six cents mètres de marche dans le couloir
infini sans dérive de la direction du regard ni sortie de cellule. Tous les écarts
mesurés sont actuellement nuls au bit près, ce qui est attendu : les
transformations sont composées de zéros, de uns et de translations exactes.

**Les points de vue**, capturés dans `shots/` : les sept situations qui trahissent
un portail mal fait — nez collé à l'ouverture, regard rasant, pile dans
l'embrasure, récursion, vue en biais, depuis l'autre pièce, cube en vol.

Les captures sont à regarder ; la comparaison automatique avec des références
viendra quand le rendu sera stabilisé, sinon on passerait son temps à réviser des
références.

## Ce qui n'est pas fait

Par ordre d'arrivée prévue :

- **Éclairage** — pour l'instant une lumière directionnelle et un ambiant. La
  cohérence de l'éclairage à travers les coutures est le vrai morceau difficile :
  d'où vient la lumière dans une pièce qui n'a pas d'extérieur ?
- **Audio** — la spatialisation doit elle aussi traverser les coutures.
- **Verticalité** — ni saut ni chute. La position verticale ne change qu'en
  franchissant une couture.
- **Le tunnel-vrille**, la gravité par face, les murs mobiles, l'espace pavé.
  Toute la géométrie tricheuse, qui est la raison d'être du projet.
- **Épaisseur des parois** — les murs sont des quads sans épaisseur. Les faces
  arrière sont écartées, ce qui suffit pour l'instant.
- **Rust** — le moteur est en TypeScript. L'étape 1 était un problème de matrices
  et de passes GPU, et le pilotage de WebGPU vit de toute façon côté page :
  traverser la frontière WASM à chaque image n'aurait fait que ralentir la boucle
  d'itération, qui est exactement ce qui comptait ici. Le Rust reprendra la main
  sur la physique, les collisions et le précalcul des lightmaps, où il gagne sa
  place. Les modules sont isolés pour que ce soit sans douleur.

## Organisation

```
src/math/      vecteurs, matrices, plan proche oblique
src/world/     cellules, coutures, géométrie, déplacement
src/render/    initialisation WebGPU, rendu récursif des portails
src/player/    visiteur, objets lancés
src/dev/       auto-test des invariants
src/shaders/   scene.wgsl, portal.wgsl
scripts/       pilote CDP sans dépendance, test de torture
```
