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
| `wolf3d` | génération du labyrinthe (automates cellulaires, marches aléatoires, élagage), lancer de rayon par DDA, lecture de la carte | le dessin des colonnes, qui passait par SFML |
