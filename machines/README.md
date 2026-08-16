# `machines/` — les projets, en état de marche

Le musée ne montre pas des captures d'écran de mes projets : il les **fait tourner**. Ce
dossier tient leur code et rien d'autre, séparé du moteur, un sous-dossier par projet.

## La règle

**Le code d'origine ne se modifie pas.** Ce qui vit dans `<projet>/source/` est la copie mot
pour mot du dépôt d'origine. Le jour où il cesse de compiler, c'est la coquille de
`<projet>/shim/` qu'il faut corriger — jamais lui. Un projet qu'on a réécrit pour le faire
entrer dans le musée n'est plus le projet, et toute la promesse tombe.

La coquille remplace ce que le musée fournit déjà : la fenêtre, les textures, le son. C'est
le sens du mot portage — on remplace la bibliothèque, pas le programme.

## Ce qu'il faut pour compiler

Un compilateur C qui vise WebAssembly. Celui qu'on utilise est distribué par PyPI :

```
python -m pip install ziglang
```

`zig cc` est un clang complet, il apporte sa bibliothèque C, il ne touche rien d'autre sur la
machine et il se désinstalle aussi vite. C'était la condition pour faire tourner du vrai C
sans imposer une chaîne d'outils entière.

Chaque projet a son `build.mjs`, qui écrit son `.wasm` dans `src/machines/`.

## Ce qui est là

| projet | ce qui tourne | ce que le musée refait |
| --- | --- | --- |
| `wolf3d` (noyau) | génération du labyrinthe (automates cellulaires, marches aléatoires, élagage), lancer de rayon par DDA, lecture de la carte | le dessin des colonnes, qui passait par SFML |
| `wolf3d` (entier) | **le jeu complet** : menu, réglages, carte, simulation, arme, minimap, son | rien — c'est SFML qu'on a portée |

### La borne s'allume, et s'arrête

Le jeu tourne derrière l'écran d'une borne d'arcade, dans une salle qu'on finit par quitter.
Un jeu qui continue de lancer ses rayons pour personne coûte exactement ce qu'il coûterait
devant un joueur : la borne a donc un interrupteur, qu'on vise et qu'on presse, et elle
s'éteint d'elle-même dès qu'on sort de la salle.

Et ce n'est pas une mise en veille : c'est une **coupure**. Le portage envoie au jeu
l'événement de fermeture — le même que la croix d'une fenêtre — et il se referme par son
propre chemin : sa boucle s'arrête, il libère ce qu'il a pris, `main` rend la main. Rien ne
subsiste, et le prochain allumage est un vrai démarrage, menu compris. C'est la seule façon
honnête d'éteindre un programme qu'on n'a pas écrit : lui demander de s'arrêter, plutôt que
de le figer par surprise.

Mesuré dans le musée : **zéro appel de dessin** avant le premier allumage, deux mille sept
cents en deux secondes et demie borne allumée, zéro de nouveau une fois coupée. Et l'allumage
ne coûte aucune saccade — soixante-trois images du musée pendant la première seconde.

### Les deux Wolf3D

Le premier est le noyau du jeu recompilé seul, sans sa bibliothèque : `machines/wolf3d/`,
construit par `build.mjs` avec `zig cc`. Léger, immédiat, et c'est du vrai C.

Le second est le jeu entier, `machines/wolf3d/web/`, construit par `build.sh` avec emscripten.
Il n'a demandé aucune réécriture du jeu — un mot et trois littéraux, consignés dans
`patches/` — mais il a fallu apprendre le navigateur à **SFML** : un moteur de fenêtre sur le
canevas, un contexte EGL unique, et lui rendre ses nuanceurs, qu'elle désactive en OpenGL ES.
Ces modifications vivent dans une copie de SFML et de CSFML hors du dépôt
(`C:\Users\felar\build\`) ; le journal complet, avec chaque mur rencontré, est dans
`wolf3d-web.txt` sur le bureau.
