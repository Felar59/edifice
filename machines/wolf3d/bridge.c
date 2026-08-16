/*
** Le pont entre le musée et Wolf3D.
**
** Même principe que le noyau de physique : **une interface qui n'est que des nombres**.
** Aucun outil intermédiaire, aucune chaîne de caractères, aucune structure partagée — la page
** appelle des fonctions qui prennent et rendent des entiers et des flottants, et lit le
** résultat dans la mémoire du module. C'est ce qui permet de charger le module en trois
** lignes, ici comme dans l'atelier.
**
** ## Ce qui tourne, et ce qui ne tourne pas
**
** Tourne, mot pour mot, le code du dépôt d'origine :
**   - `init_map` : le tirage aléatoire, les automates cellulaires, les bordures, les deux
**     marches aléatoires, l'élagage des poches inaccessibles, les murs de second type ;
**   - `cellular_automata` et `random_walk` : les deux algorithmes de génération ;
**   - `init_dda` et `cast_single_ray` : le lancer de rayon par DDA ;
**   - `is_wall` : la lecture de la carte.
**
** Ne tourne pas, et c'est la définition d'un portage : le dessin. Wolf3D peint ses colonnes
** avec des `sfRectangleShape` texturées, c'est-à-dire avec sa fenêtre. Le musée en a une.
** La boucle sur les colonnes ci-dessous est donc à nous ; ce qu'elle demande à chaque
** colonne — où est le mur, de quel type, de quel côté — vient du jeu.
**
** La correction de distorsion et la teinte sont reprises du jeu, et signalées comme telles.
*/

#include <stdlib.h>
#include <math.h>
#include "wolf3d.h"
#include "raycasting.h"

/** Une image de mille deux cents pixels de large suffit largement à un stéréoscope. */
#define MAX_W 1200
#define MAX_H 900

static global_t GLB;
static unsigned char FRAME[MAX_W * MAX_H * 4];

/**
 * Les murs qui arrêtent un rayon.
 *
 * Le jeu tient cette liste pour savoir quelle texture appliquer ; ici elle ne sert qu'à dire
 * ce qui est opaque. Le mur ordinaire, le mur de second type qui borde les couloirs, et la
 * porte — qui est un mur tant qu'on ne l'a pas ouverte.
 */
static wall_textures_t WALLS[] = {
    {M_WALL, 0},
    {M_WALL2, 0},
    {M_DOOR, 0},
    {0, 0},
};

/** Le point de départ du jeu, calculé comme dans `init_map`. */
static float START_X;
static float START_Y;

/**
 * Bâtit un labyrinthe. Renvoie zéro si la graine ne donne rien d'exploitable.
 *
 * La difficulté est celle du jeu : zéro, un ou deux. Elle décide de la taille de la carte et
 * de la profondeur des automates, donc de la densité du labyrinthe.
 */
int wolf_generate(int seed, int difficulty)
{
    map_t *map = &GLB.simu.map;

    /* Une seconde génération dans le même module réutiliserait les tableaux de la
       première : `init_map` refuse de recommencer si les siens existent déjà. On repart
       donc d'une carte vierge, ce qui abandonne la précédente — le module est rechargé à
       chaque visite, et une fuite d'un mégaoctet par labyrinthe n'a pas de conséquence. */
    map->map_rect = 0;
    map->line_wall = 0;
    map->ground = 0;
    map->buffer = 0;
    map->seen = 0;
    map->seed = seed ? seed : 1;
    if (difficulty < 0 || difficulty > 2)
        difficulty = 0;

    init_map(map, difficulty, 0, 1);
    if (!map->ground)
        return 0;

    /* Le même calcul que dans `init_map`, qui garde son point de départ pour lui. Le demi
       tour de plus met le joueur au centre de sa case et non sur son coin. */
    START_X = (float)(map->width / 2) + 0.5f;
    START_Y = (float)((int)(map->height * 0.025f)) + 0.5f;
    GLB.simu.walls = WALLS;
    return 1;
}

int wolf_width(void) { return GLB.simu.map.width; }
int wolf_height(void) { return GLB.simu.map.height; }
float wolf_start_x(void) { return START_X; }
float wolf_start_y(void) { return START_Y; }

/** Le contenu d'une case, tel que le jeu l'a écrit : '#', 'O', 'D', '.', 'B'… */
int wolf_tile(int x, int y)
{
    if (!GLB.simu.map.ground)
        return M_WALL;
    return is_wall(&GLB.simu.map, x, y);
}

/** L'adresse de l'image, dans la mémoire du module. */
unsigned char *wolf_frame(void) { return FRAME; }

/**
 * Peint une image, colonne par colonne.
 *
 * Chaque colonne demande son mur au jeu, puis le musée la dessine. Trois choses viennent du
 * jeu et sont signalées à leur ligne : la distance rendue par le DDA, le côté touché, et le
 * type de mur.
 */
void wolf_view(float px, float py, float angle, float fov, int w, int h)
{
    if (w > MAX_W) w = MAX_W;
    if (h > MAX_H) h = MAX_H;
    if (!GLB.simu.map.ground)
        return;

    GLB.simu.player.x = px;
    GLB.simu.player.y = py;

    for (int i = 0; i < w; i++) {
        float ray = angle - fov / 2.0f + fov * ((float)i / (float)(w - 1));
        wall_type_t hit = cast_single_ray(&GLB, ray);

        /* La distance jusqu'au mur, puis la correction de distorsion : sans elle, un mur
           droit devant se creuse en tonneau vers les bords de l'image. C'est la projection
           sur l'axe du regard, et c'est ce que fait tout raycaster de cette famille. */
        float dx = hit.pose.x - px;
        float dy = hit.pose.y - py;
        float dist = sqrtf(dx * dx + dy * dy) * cosf(ray - angle);
        if (dist < 0.02f)
            dist = 0.02f;

        /* La teinte du mur avec la distance, transcrite de `get_wall_shadow`
           (src/simulation/raycasting/cast_all_rays.c) : elle n'a pas pu être compilée avec
           le reste, ce fichier-là étant entièrement écrit contre SFML. */
        float shade = 255.0f - dist * 35.0f;
        if (shade < 35.0f) shade = 35.0f;
        if (shade > 255.0f) shade = 255.0f;
        /* Un mur pris par le travers est plus sombre : c'est ce qui donne les arêtes. */
        if (hit.side == 1)
            shade *= 0.72f;

        float r = shade;
        float g = shade;
        float b = shade;
        if (hit.type == M_WALL2) { g = shade * 0.78f; b = shade * 0.6f; }
        if (hit.type == M_DOOR) { r = shade * 0.55f; g = shade * 0.85f; b = shade * 0.7f; }

        int wall = (int)((float)h / dist);
        int top = (h - wall) / 2;
        int bottom = top + wall;
        if (top < 0) top = 0;
        if (bottom > h) bottom = h;

        for (int y = 0; y < h; y++) {
            unsigned char *p = FRAME + (y * w + i) * 4;
            if (y < top) {
                /* Le ciel et le sol, en dégradé : le jeu les peint avec un nuanceur qu'on
                   ne peut pas emporter, mais un dégradé simple dit la même chose — il y a
                   un haut et un bas. */
                int k = 26 + (top ? (y * 30) / (top + 1) : 0);
                p[0] = k; p[1] = k; p[2] = k + 6;
            } else if (y >= bottom) {
                int k = 60 - ((y - bottom) * 34) / (h - bottom + 1);
                p[0] = k; p[1] = k; p[2] = k - 4;
            } else {
                p[0] = (unsigned char)r;
                p[1] = (unsigned char)g;
                p[2] = (unsigned char)b;
            }
            p[3] = 255;
        }
    }
}
