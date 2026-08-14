# Édifice — le musée impossible

Un musée dont l'architecture est physiquement impossible, et dont chaque salle est
une machine en état de marche : chacun de mes projets y tourne pour de vrai, et
c'est en le faisant fonctionner qu'on avance dans le bâtiment.

Le plan de travail complet — les six moments signature, les onze machines, les
lots et leurs portes de sortie — vit dans `PLAN.md`, à la racine du dossier du
portfolio. Ce dépôt-ci contient le moteur.

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

**Le haut de la caméra n'est pas la verticale de gravité.** Confondre les deux ne
se voit pas tant qu'on regarde à l'horizontale. Dès qu'on pique du nez, le repère
(côté, verticale de gravité, regard) cesse d'être orthogonal — et `invertRigid`,
qui suppose l'orthonormalité et se contente de transposer la rotation, renvoie
alors une matrice de vue fausse, sans le moindre message d'erreur. L'image
cisaille, et les coutures, dont la caméra virtuelle hérite du défaut, se
remplissent de zones vides. La verticale de gravité ne sert qu'à fixer le roulis.

**Les parois ont une épaisseur.** Ce n'est pas une coquetterie d'architecte. Avec
des cloisons sans épaisseur, l'œil passe à quelques millimètres d'un mur, donc plus
près que le plan proche : le mur est intégralement écrêté, et comme rien ne se
trouve derrière lui, toute la zone qu'il occupait devient la couleur d'effacement.
Une embrasure de vingt-cinq centimètres, avec la couture posée en son fond,
garantit qu'aucune surface n'entre dans le plan proche pendant la traversée. Le
relief des jambages remplace du même coup l'encadrement peint qui décorait les
ouvertures, ce qui supprime la seule géométrie coplanaire de la scène — et permet
donc de rapprocher le plan proche à quatre millimètres sans craindre le conflit de
profondeur.

**Deux pièges à l'instant du franchissement.** Ils se cumulent, et donnaient tous
deux une image entièrement vide au pire moment.

Le premier : à quelques millimètres de l'ouverture, le quad du portail est plus
proche que le plan proche, donc entièrement écrêté. La parade tient en une ligne de
nuanceur — **borner la profondeur de clip à zéro**. La position d'un sommet à
l'écran vient de `x`, `y` et `w` ; `z` ne détermine que la profondeur. La ramener à
zéro pose donc le sommet sur le plan proche sans le déplacer d'un pixel. On y perd
seulement que, sur ces quelques millimètres, l'ouverture gagne le test de
profondeur contre tout ce qui la précède — or rien ne peut s'y trouver.

Deux tentatives précédentes ont échoué, et pour des raisons instructives.

La première peignait tout l'écran quand l'œil approchait de l'ouverture, au motif
qu'à cette distance elle couvre tout le champ. C'était vrai, mais seulement si on
la regarde : le raccourci ignorait la **direction du regard**. Debout dans
l'embrasure et tourné vers l'arrière, il recouvrait toute l'image avec la vue d'une
caméra virtuelle qui regarde hors de la salle d'en face — la pièce où l'on se
trouve devenait un grand aplat gris.

La seconde éloignait chaque coin de l'œil le long de son rayon, ce qui préserve
aussi la projection. Mais un coin passé **derrière** l'œil ne peut pas être éloigné
vers l'avant, et l'arête qui le relie à un coin déplacé n'est plus la même droite :
elle traverse le plan proche ailleurs, et la silhouette obtenue est fausse. Cela
survient dès qu'on se tient dans l'embrasure en inclinant le regard, et cela
laissait une bande de quatre millimètres où l'image se vidait encore. D'où le
découpage du polygone contre le demi-espace situé devant l'œil, côté processeur,
avant de l'envoyer au nuanceur.

Le second : quand le plan de coupe passe **par** la caméra virtuelle, le plan
proche oblique dégénère. La troisième ligne de la matrice devient l'opposée de la
quatrième, tous les fragments atterrissent exactement sur le plan lointain, et la
comparaison de profondeur `less` échoue partout. La parade est de renoncer à
l'obliquité dans ce cas, ce qui est correct et pas seulement commode : s'il n'y a
rien entre la caméra et l'ouverture, il n'y a rien à écarter.

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
passés à `advance` et transformés à chaque traversée. Après quoi on les **remet à
l'unité, et rien de plus** : une version antérieure projetait aussi le regard
perpendiculairement à la verticale « pour remettre le repère d'équerre », ce qui
écrasait le tangage — le regard se redressait brutalement à chaque porte franchie.
Le regard n'a aucune raison d'être perpendiculaire à la verticale ; c'est
précisément ce que veut dire regarder en haut ou en bas. Seul le repère de la
caméra doit être orthonormé, et il est reconstruit à chaque image. L'orientation du visiteur
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

S'y ajoute l'orthonormalité du repère de la caméra, vérifiée à toutes les
inclinaisons. C'est l'invariant qui manquait, et son absence a laissé passer le
défaut le plus visible du prototype.

**Les points de vue**, capturés dans `shots/` : les dix situations qui trahissent
un portail mal fait — nez collé à l'ouverture, regard rasant, pile dans
l'embrasure, récursion, vue en biais, depuis l'autre pièce, tangage dans les deux
sens, à un cheveu et au micron de la couture, cube en vol.

Chaque capture est **mesurée**, et non seulement enregistrée : une image utile
n'est jamais un aplat, donc on exige un minimum de relief et de teintes
distinctes. C'est grossier, et c'est exactement ce qui manquait — les trois
premiers défauts trouvés au clavier laissaient tous les compteurs du moteur
intacts. La mesure porte sur le PNG enregistré plutôt que sur le canevas, ce qui
garantit qu'on mesure exactement l'image qu'on regarde ensuite ; un canevas WebGPU
ne se relit d'ailleurs pas avec `drawImage` hors de la boucle de rendu.
`scripts/png.mjs` est un décodeur minimal écrit pour l'occasion, sans dépendance.

S'y ajoutent deux contrôles nés d'un défaut que les mesures précédentes avaient
laissé passer : le tangage doit survivre au placement et à la traversée, et **deux
points de vue ne peuvent pas produire la même image**. Ce second contrôle est
trivial et il aurait suffi : les deux vues inclinées sortaient identiques au bit
près, et leurs statistiques identiques s'affichaient à l'écran sans que personne ne
les rapproche.

Chacun de ces contrôles a été **vu échouer** : les trois défauts ont été
réintroduits un par un pour vérifier que le test les attrape. Un contrôle de
régression qu'on n'a jamais vu échouer n'en est pas un — et il s'est trouvé qu'un
seul des trois se laissait prendre par la mesure d'image, d'où l'invariant sur la
caméra.

**Le balayage du franchissement.** Des poses fixes ne prouvent pas qu'une
transition est propre : ce qui gênait à l'œil, c'était le passage lui-même, une
bande grise de quelques millimètres trop brève pour être capturée par hasard et
assez longue pour être vue. On fait donc **marcher** le visiteur à travers la
porte, millimètre par millimètre, par le même code de déplacement que d'habitude,
et on mesure chaque position sous trois directions de regard. Le résultat n'est pas
un oui-non mais une largeur : sur quelle épaisseur, en millimètres, l'image se
dégrade-t-elle ? À la vitesse de marche une image couvre près de six centimètres,
donc tout ce qui reste sous le centimètre est invisible en pratique.

Téléporter l'œil de part et d'autre ne dirait rien, et c'est une erreur que ce test
a commise avant d'être corrigé : une position au-delà d'une couture mais rattachée
à la cellule de départ est un état que le moteur ne produit jamais, et le mesurer
fabrique de faux échecs.

`scripts/probe-sweep.mjs` est la version exhaustive, à lancer à la main quand
quelque chose résiste : elle fait tourner le regard sur trois cent soixante degrés
et trois inclinaisons à chaque millimètre, soit près de trois mille images, et
signale la pire. C'est elle qui a localisé la bande de quatre millimètres que les
trois directions du test permanent avaient laissée passer.

La comparaison au pixel avec des références viendra quand le rendu sera stabilisé,
sinon on passerait son temps à réviser des références.

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
- **Rust** — le moteur est en TypeScript. L'étape 1 était un problème de matrices
  et de passes GPU, et le pilotage de WebGPU vit de toute façon côté page :
  traverser la frontière WASM à chaque image n'aurait fait que ralentir la boucle
  d'itération, qui est exactement ce qui comptait ici. Le Rust reprendra la main
  sur la physique, les collisions et le précalcul des lightmaps, où il gagne sa
  place. Les modules sont isolés pour que ce soit sans douleur.

## L'atelier

Le dossier `tools/` est un atelier de mise au point, **non versionné** et
régénérable : des sondes qui servent à comprendre ce qui se passe quand quelque
chose résiste, pas au projet livré. Il contient son propre `README.md`.

En résumé de ce qui s'y trouve :

- `sheet.mjs` assemble tout un balayage en une seule planche de contact — une
  transition étalée sur quarante captures interdit la comparaison, et un accident
  d'une seule image y passe inaperçu ;
- `trace.mjs` relève position, regard, verticale locale, inclinaison et roulis pas à
  pas, pour les défauts qu'aucune image ne montre ;
- `ab.mjs` réintroduit un défaut connu, lance le test, et restaure — parce qu'un
  contrôle de non-régression qu'on n'a jamais vu échouer n'en est pas un. Le
  catalogue des défauts déjà rencontrés vit dans `tools/patches.mjs` ;
- `diff.mjs` dit *où* deux images diffèrent, là où le test de torture dit seulement
  *si*.

Les outils pilotent le crochet `window.__edifice` exposé par `src/main.ts`
(`state`, `seam`, `teleport`, `walk`, `face`, `setDepth`, `setChrome`, `selfTest`).
C'est la frontière prévue pour ça : quand une sonde a besoin de voir autre chose, on
ajoute une entrée plutôt que d'aller fouiller dans les modules.

Deux règles y sont apprises à mes dépens, et elles valent au-delà de l'atelier :
ne jamais écrire une coordonnée du monde en dur — le plan des coutures a déjà bougé
une fois et tous les repères figés se sont mis à mesurer autre chose sans rien
signaler ; et ne jamais téléporter à travers une couture, une position au-delà du
plan mais rattachée à la cellule de départ étant un état que le moteur ne produit
jamais.

## Organisation

```
src/math/      vecteurs, matrices, plan proche oblique
src/world/     cellules, coutures, géométrie, déplacement
src/render/    initialisation WebGPU, rendu récursif des portails
src/player/    visiteur, objets lancés
src/dev/       auto-test des invariants
src/shaders/   scene.wgsl, portal.wgsl
scripts/       pilote CDP sans dépendance, décodeur PNG, test de torture
tools/         atelier de mise au point, non versionné (voir tools/README.md)
```
