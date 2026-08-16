/*
** La coquille SFML.
**
** Wolf3D est écrit contre CSFML, qui lui donne une fenêtre, des textures et des formes à
** dessiner. Le musée en a déjà : c'est lui la fenêtre. Ce qu'on veut de Wolf3D, c'est son
** raycasting et son générateur de labyrinthe, pas sa couche d'affichage.
**
** Ce fichier remplace donc `<SFML/Graphics.h>` par le strict nécessaire : les types de
** vecteurs, qui traversent tout le code du jeu, et des pointeurs opaques pour les objets
** graphiques qu'on ne touche jamais. **Aucun fichier .c du jeu n'est modifié** — c'est le
** sens du mot « portage » : on remplace la bibliothèque, pas le programme.
**
** Ce qui suit est écrit à la main pour ce projet, et n'a rien de SFML au-delà des noms.
*/

#ifndef EDIFICE_SFML_GRAPHICS_H
#define EDIFICE_SFML_GRAPHICS_H

/* Le vrai en-tête de SFML tire derrière lui les en-têtes système, et le code du jeu compte
   dessus sans les inclure lui-même. La coquille doit donc en faire autant. */
#include <limits.h>
#include <stddef.h>

typedef int sfBool;
#define sfFalse 0
#define sfTrue 1

typedef struct { float x, y; } sfVector2f;
typedef struct { int x, y; } sfVector2i;
typedef struct { unsigned int x, y; } sfVector2u;

typedef struct { unsigned char r, g, b, a; } sfColor;
typedef struct { int left, top, width, height; } sfIntRect;

/* Tout ce que le musée ne dessine pas : des pointeurs qu'on transporte sans jamais les
   déréférencer. Le compilateur suffit à garantir qu'on ne s'en sert pas — une structure
   incomplète ne se déréférence pas par accident. */
typedef struct sfTexture sfTexture;
typedef struct sfRectangleShape sfRectangleShape;
typedef struct sfCircleShape sfCircleShape;
typedef struct sfVertexArray sfVertexArray;
typedef struct sfSprite sfSprite;
typedef struct sfFont sfFont;
typedef struct sfText sfText;
typedef struct sfRenderWindow sfRenderWindow;
typedef struct sfClock sfClock;
typedef struct { float microseconds; } sfTime;

/*
** Les quelques fonctions de dessin que le code compilé appelle vraiment.
**
** `init_map.c` construit, en même temps que le labyrinthe, les rectangles qui serviront à
** l'afficher dans la fenêtre du jeu. On ne peut pas retirer ces lignes sans modifier le
** fichier, et on ne veut pas les modifier : c'est tout l'intérêt de faire tourner le vrai
** code. On les déclare donc, et `stubs.c` les définit sans rien faire.
*/
sfRectangleShape *sfRectangleShape_create(void);
void sfRectangleShape_setSize(sfRectangleShape *shape, sfVector2f size);
void sfRectangleShape_setPosition(sfRectangleShape *shape, sfVector2f pos);
void sfRectangleShape_setFillColor(sfRectangleShape *shape, sfColor color);

#endif
