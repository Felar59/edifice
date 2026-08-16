/*
** La coquille du jeu.
**
** `cast_single_ray.c` inclut `wolf3d.h`, qui dans le dépôt d'origine tire derrière lui tout
** le programme : les menus, les réglages, l'éditeur de niveaux, le gestionnaire de scènes,
** la liste d'affichage. Rien de tout cela n'a de sens dans le musée, et rien de tout cela
** n'est touché par le lanceur de rayon.
**
** Ce fichier fournit donc **exactement ce que le fichier compilé utilise**, et rien de plus :
** la carte, la liste des murs qui arrêtent un rayon, la position du joueur, et les deux
** macros qui la lisent. Les noms, les types et les champs sont ceux du dépôt d'origine —
** c'est la condition pour que le .c compile sans être modifié d'un caractère.
**
** ## Où passe la frontière
**
** Ce qui tourne, et qui est le code d'origine mot pour mot :
**   - `init_dda` et `cast_single_ray` : le lancer de rayon par DDA ;
**   - `cellular_automata` et `random_walk` : la génération du labyrinthe ;
**   - `is_wall` : la lecture de la carte, bords compris.
**
** Ce qui ne tourne pas, et qui est refait par le musée :
**   - le dessin des colonnes, qui dans Wolf3D passe par des `sfRectangleShape` texturées.
**     C'est la couche d'affichage, celle qu'un portage remplace par définition.
*/

#ifndef EDIFICE_WOLF3D_H
#define EDIFICE_WOLF3D_H

#include <SFML/Graphics.h>
#include <SFML/Audio.h>
#include <math.h>
#include "map.h"

/* Repris tel quel de `src/simulation/my_simu.h`. */
typedef struct wall_textures_s {
    char type;
    sfTexture *texture;
} wall_textures_t;

/* Repris de `src/simulation/entities/entities.h`, réduit aux deux champs que le fichier
   compilé consulte. */
typedef struct enemy_s {
    sfVector2f pos;
    float dist;
} enemy_t;

typedef struct player_s {
    float x;
    float y;
} player_t;

typedef struct simu_s {
    map_t map;
    player_t player;
    wall_textures_t *walls;
} simu_t;

typedef struct global {
    simu_t simu;
} global_t;

/* Repris tel quel de `src/simulation/my_simu.h`. */
#define PX(glb) ((glb)->simu.player.x)
#define PY(glb) ((glb)->simu.player.y)

#endif
