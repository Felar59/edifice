#!/usr/bin/env bash
# Compile Wolf3D — le jeu entier — vers WebAssembly.
#
# Le jeu n'est pas modifié, à un mot près : voir patches/. Ce qui a été modifié,
# ce sont SFML et CSFML, à qui on a appris que le navigateur existe. Le journal
# complet, avec chaque mur rencontré, est dans wolf3d-web.txt sur le bureau.
set -e

GAME=${GAME:-/c/Users/felar/build/wolf3d-src}
PREFIX=${PREFIX:-/c/Users/felar/build/prefix}
CSFML=${CSFML:-/c/Users/felar/build/CSFML}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$HERE/wolf3d.js}
OBJ=${OBJ:-/c/Users/felar/build/wolf3d-obj}
OPT=${OPT:--O2}

# Tous les dossiers qui contiennent un en-tête : le jeu inclut ses propres
# fichiers par leur nom court, sans chemin.
INCLUDES=$(cd "$GAME" && find src lib -name '*.h' | sed 's|/[^/]*$||' | sort -u | sed "s|^|-I$GAME/|")
INCLUDES="$INCLUDES -I$GAME/include -I$CSFML/include -I$PREFIX/include"

# ── Deux phases, et il le faut ────────────────────────────────────────────────
#
# On compile avec `emcc`, qui traite un .c comme du C. On lie avec `em++`, qui
# apporte la bibliothèque standard C++ dont SFML a besoin pour s'exécuter.
#
# Tout faire avec `em++` compilerait le jeu comme du C++ et le refuserait : les
# déclarations anticipées d'énumérations, tout ce qui est légal en C et interdit
# à côté. Tout faire avec `emcc` lie sans la bibliothèque C++ et sort une
# centaine de symboles manquants. Il n'y a pas de commande unique qui marche.

mkdir -p "$OBJ"
COUNT=0
for src in $(cd "$GAME" && find src lib -name '*.c'); do
    emcc $OPT -c "$GAME/$src" $INCLUDES -o "$OBJ/$(echo "$src" | tr '/' '_').o"
    COUNT=$((COUNT + 1))
done
emcc $OPT -c "$HERE/environ.c" -o "$OBJ/edifice_environ.o"
echo "$COUNT fichiers du jeu compilés"

em++ "$OBJ"/*.o \
  -L"$CSFML/web/lib" -L"$PREFIX/lib" \
  -lcsfml-graphics -lcsfml-window -lcsfml-audio -lcsfml-system \
  -lsfml-graphics-s -lsfml-window-s -lsfml-audio-s -lsfml-system-s \
  -sUSE_FREETYPE=1 -sUSE_VORBIS=1 -sUSE_OGG=1 \
  -lopenal -lEGL -lGL \
  $OPT $EXTRA \
  -sASYNCIFY \
  -sASYNCIFY_STACK_SIZE=65536 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sSTACK_SIZE=8388608 \
  -sMAX_WEBGL_VERSION=2 \
  -sGL_ENABLE_GET_PROC_ADDRESS=1 \
  `# SFML 2.6 dessine en pipeline fixe — glMatrixMode, glVertexPointer,` \
  `# glEnableClientState — hérité d'OpenGL 1.1. WebGL n'a rien de tout cela : il` \
  `# est ES 2, tout passe par des nuanceurs. C'est le mur qui a obligé le fork` \
  `# VRSFML à réécrire toute la couche de rendu de SFML 3.` \
  `#` \
  `# Emscripten a précisément une réponse à ce cas : une émulation du pipeline fixe` \
  `# écrite au-dessus de WebGL, faite pour les portages de code OpenGL ancien.` \
  -sLEGACY_GL_EMULATION=1 \
  `# FS donne accès au système de fichiers du module — celui où sont préchargés`   `# les Assets et les nuanceurs. C'est un outil de mise au point : on peut y`   `# réécrire un .frag depuis la console avant que le jeu ne le charge, et voir`   `# le résultat sans recompiler. Les deux défauts de rendu ont été trouvés`   `# comme cela, en quelques secondes par essai plutôt qu'en deux minutes.`   -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,stringToUTF8,lengthBytesUTF8,setValue,FS \
  -sEXPORTED_FUNCTIONS=_main,_edifice_environ,_edifice_ecoute,_malloc \
  -sINVOKE_RUN=0 \
  `# Une fabrique plutôt qu'un objet global : le musée est une application` \
  `# à modules, et un « Module » posé sur window y serait une verrue — sans` \
  `# compter qu'il faudrait l'installer avant que le script ne s'exécute.` \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=creerWolf3d \
  `# Le musée relit le canevas du jeu pour l'accrocher à son mur. Sans cela, le` \
  `# navigateur vide le tampon de dessin dès qu'il l'a affiché, et la relecture` \
  `# ne rapporte que du noir. Le drapeau porte un nom malheureux : il ne fait` \
  `# rien d'autre que poser preserveDrawingBuffer.` \
  -sGL_TESTING=1 \
  --preload-file "$GAME/Assets@/Assets" \
  --preload-file "$GAME/shaders@/shaders" \
  -o "$OUT"

echo "écrit : $OUT"

# ── Les drapeaux qui ont coûté cher, et pourquoi ──────────────────────────────
#
# -sASYNCIFY
#   La clef de tout. Un jeu tient sa propre boucle — « tant que la fenêtre est
#   ouverte, dessine » — et un navigateur ne le permet pas : c'est lui qui tient
#   la boucle. ASYNCIFY réécrit le programme pour qu'il puisse s'interrompre au
#   milieu d'une boucle bloquante et reprendre à l'image suivante. C'est l'outil
#   fait pour ne pas réécrire le projet. Il faut encore que quelque chose demande
#   à attendre : c'est `Window::display` qui s'en charge, côté SFML.
#
# -sSTACK_SIZE=8388608
#   Le jeu déclare tout son état — menus, réglages, simulation, liste
#   d'affichage — dans une seule variable locale de `main`. Cette structure pèse
#   plus que les 64 Ko de pile qu'emscripten accorde par défaut, et le programme
#   meurt sur un débordement à sa première ligne, avant d'avoir rien appelé. Sur
#   un ordinateur la pile fait huit mégaoctets et personne ne s'en aperçoit.
#
# -sGL_ENABLE_GET_PROC_ADDRESS=1
#   Sans lui, emscripten fait renvoyer zéro à eglGetProcAddress pour économiser
#   quelques kilo-octets. SFML range consciencieusement ces zéros dans sa table
#   de fonctions GL et en appelle une au premier dessin.
#
# -lEGL -lGL
#   Les implémentations EGL et GLES d'emscripten. Sans elles, l'éditeur de liens
#   fabrique des souches vides plutôt que d'échouer, et `EglContext` appelle des
#   fonctions nulles dès sa construction.
#
# -sINVOKE_RUN=0
#   La page appelle `main` elle-même, avec ses trois arguments : voir environ.c.
