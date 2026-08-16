/*
** Les fonctions de dessin de SFML, réduites à ne rien faire.
**
** `init_map.c` construit, en même temps que le labyrinthe, les rectangles qui serviront à
** l'afficher dans la fenêtre du jeu. On ne peut pas retirer ces lignes sans modifier le
** fichier, et on ne veut pas les modifier : c'est tout l'intérêt de faire tourner le vrai
** code. On fournit donc les fonctions qu'elles appellent, et elles ne font rien.
**
** Le musée dessine le labyrinthe lui-même, à partir de la carte que ce même fichier a
** générée — laquelle est, elle, bien réelle.
*/

#include <SFML/Graphics.h>

sfRectangleShape *sfRectangleShape_create(void) { return 0; }
void sfRectangleShape_setSize(sfRectangleShape *s, sfVector2f v) { (void)s; (void)v; }
void sfRectangleShape_setPosition(sfRectangleShape *s, sfVector2f v) { (void)s; (void)v; }
void sfRectangleShape_setFillColor(sfRectangleShape *s, sfColor c) { (void)s; (void)c; }
