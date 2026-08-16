/*
** EPITECH PROJECT, 2026
** map header
** File description:
** map header
*/

#ifndef CCC9BF88_AEC6_4F46_B132_B5B34C3874B9
    #define CCC9BF88_AEC6_4F46_B132_B5B34C3874B9
    #define TILE_SIZE 64
    #include <SFML/Graphics.h>
    #include <SFML/Audio.h>
    #define OFFSET 20
    #define GROUND glb->simu.map.ground

    #define M_WALL '#'
    #define M_WALL2 'O'
    #define M_DOOR 'D'
    #define M_VOID '.'
    #define M_PLAYER 'P'
    #define M_ENNEMY 'E'
    #define M_BOSS 'B'

typedef struct res_manager_s res_manager_t;
typedef struct global global_t;

static const sfVector2i directions[] = {
    {-1, -1}, {-1, 0}, {-1, 1},
    { 0, -1}, { 0, 1},
    { 1, -1}, { 1, 0}, { 1, 1},
};

typedef struct difficulty_settings_s {
    int height;
    int r_height;
    int width;
    int r_width;
    int depth;
    int enemy_count;
    float enemy_speed;
    int enemy_hp;
    float enemy_miss_rate;
    float enemy_attack_cooldown;
} difficulty_settings_t;

static const difficulty_settings_t DSETTING[] = {
    {100, 50, 10, 5, 3, 50, 0.7f, 100, 0.55f, 3.0f},
    {150, 50, 15, 5, 4, 75, 1.0f, 150, 0.35f, 2.0f},
    {200, 50, 20, 5, 2, 100, 1.3f, 200, 0.10f, 1.2f},
    {0, 0, 0, 0, 0, 0, 0.0f, 0, 0.0f, 0.0f},
};

typedef enum difficulty_e {
    D_EASY,
    D_MEDIUM,
    D_HARD,
    D_NONE
} difficulty_t;

typedef struct map_s {
    int width;
    int height;
    long seed;
    char *name;
    char **ground;
    char **buffer;
    sfBool **seen;
    sfRectangleShape ***map_rect;
    sfRectangleShape **line_wall;
    sfCircleShape *minimap_water;
    sfTexture *water;
    difficulty_t difficulty;
} map_t;

void init_line_wall(map_t *map, int nb_rays);

void init_mini_map(global_t *glb);
void init_map(map_t *map, int diff,
    res_manager_t *rm, int nb_rays);
char is_wall(map_t *map, int x, int y);
int collide_wall_rect(global_t *glb, float next_x, float next_y);

// procedural algo
void cellular_automata(map_t *map, int depth);
void random_walk(map_t *map, sfVector2i *starting_point, sfVector2i *end_point);

#endif /* CCC9BF88_AEC6_4F46_B132_B5B34C3874B9 */
