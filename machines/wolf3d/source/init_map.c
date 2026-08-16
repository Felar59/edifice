/*
** EPITECH PROJECT, 2026
** is wall
** File description:
** is wall
*/

#include "map.h"
#include <time.h>
#include <stdlib.h>
#include "my_res_manager.h"

static void init_map_rect(map_t *map)
{
    for (int i = 0; i < map->height; i++) {
        map->map_rect[i] = malloc(sizeof(sfRectangleShape *) * map->width);
        if (!map->map_rect[i])
            return;
    }
    for (int x = 0; x < map->width; x++)
        for (int y = 0; y < map->height; y++) {
            map->map_rect[y][x] = sfRectangleShape_create();
            sfRectangleShape_setSize(map->map_rect[y][x],
                (sfVector2f){(TILE_SIZE / 2), (TILE_SIZE / 2)});
            sfRectangleShape_setPosition(map->map_rect[y][x],
                (sfVector2f){x * (TILE_SIZE / 2) + OFFSET,
                    y * (TILE_SIZE / 2) + OFFSET});
            sfRectangleShape_setFillColor(map->map_rect[y][x],
                map->ground[x][y] != M_VOID && map->ground[x][y] != M_ENNEMY &&
                map->ground[x][y] != M_BOSS ? (sfColor){10, 10, 10, 255} :
                (sfColor){25, 25, 25, 255});
        }
}

void init_line_wall(map_t *map, int nb_rays)
{
    if (!map->map_rect) {
        map->map_rect = malloc(sizeof(sfRectangleShape **) * map->height);
        if (!map->map_rect)
            return;
        init_map_rect(map);
    }
    map->line_wall = malloc(sizeof(sfRectangleShape *) * nb_rays);
    if (!map->line_wall)
        return;
    for (int i = 0; i < nb_rays; i++)
        map->line_wall[i] = sfRectangleShape_create();
}

static void add_second_type_wall(map_t *map)
{
    int w = map->width;
    int h = map->height;

    for (int x = 0; x < w; x++)
        if (h >= 1 && map->ground[x][1] == M_VOID && rand() % 100 <= 10)
            map->ground[x][0] = M_WALL2;
    for (int y = 0; y < h; y++)
        if (w >= 1 && map->ground[1][y] == M_VOID && rand() % 100 <= 10)
            map->ground[0][y] = M_WALL2;
    for (int x = 0; x < w; x++)
        if (h >= 2 && map->ground[x][h - 2] == M_VOID && rand() % 100 <= 10)
            map->ground[x][h - 1] = M_WALL2;
    for (int y = 0; y < h; y++)
        if (w >= 2 && map->ground[w - 2][y] == M_VOID && rand() % 100 <= 10)
            map->ground[w - 1][y] = M_WALL2;
    map->ground[map->width / 2][map->height - 1] = M_DOOR;
    map->ground[map->width / 2][map->height - 1] = M_DOOR;
}

static void create_seen(map_t *map)
{
    map->seen = malloc(sizeof(sfBool *) * map->height);
    if (!map->seen)
        return;
    for (int i = 0; i < map->height; i++) {
        map->seen[i] = calloc(map->width, sizeof(sfBool));
        if (!map->seen[i])
            return;
    }
}

static void create_random_ground(map_t *map)
{
    map->ground = malloc(sizeof(char *) * map->width);
    if (!map->ground)
        return;
    for (int i = 0; i < map->width; i++) {
        map->ground[i] = malloc(sizeof(char) * map->height);
        if (!map->ground[i])
            return;
    }
    map->buffer = malloc(sizeof(char *) * map->width);
    if (!map->buffer)
        return;
    for (int i = 0; i < map->width; i++) {
        map->buffer[i] = malloc(sizeof(char) * map->height);
        if (!map->buffer[i])
            return;
    }
    create_seen(map);
    for (int x = 0; x < map->width; x++)
        for (int y = 0; y < map->height; y++)
            map->ground[x][y] = (rand() % 100 < 55) ? M_WALL : M_VOID;
}

static void setup_border(map_t *map, int x)
{
    for (int y = 0; y < map->height; y++)
        if (x == 0 || y == 0 || x == map->width - 1 || y == map->height - 1)
            map->ground[x][y] = M_WALL;
}

static void recursive_remove(map_t *map, sfVector2i *pos)
{
    if (pos->x < 0 || pos->y < 0 ||
        pos->x >= map->width || pos->y >= map->height)
        return;
    if (map->buffer[pos->x][pos->y] == M_VOID)
        return;
    map->buffer[pos->x][pos->y] = M_VOID;
    if (map->ground[pos->x - 1][pos->y] == M_VOID)
        recursive_remove(map, &(sfVector2i){pos->x - 1, pos->y});
    if (map->ground[pos->x + 1][pos->y] == M_VOID)
        recursive_remove(map, &(sfVector2i){pos->x + 1, pos->y});
    if (map->ground[pos->x][pos->y - 1] == M_VOID)
        recursive_remove(map, &(sfVector2i){pos->x, pos->y - 1});
    if (map->ground[pos->x][pos->y + 1] == M_VOID)
        recursive_remove(map, &(sfVector2i){pos->x, pos->y + 1});
}

static void remove_empty_spaces(map_t *map, sfVector2i *starting_point)
{
    for (int i = 0; i < map->width; i++)
        for (int j = 0; j < map->height; j++)
            map->buffer[i][j] = M_WALL;
    recursive_remove(map, starting_point);
    for (int i = 0; i < map->width; i++)
        for (int j = 0; j < map->height; j++)
            map->ground[i][j] = map->buffer[i][j];
}

static void make_enough_space(map_t *map, sfVector2i *starting_point,
    sfVector2i *end_point)
{
    random_walk(map, starting_point, end_point);
    random_walk(map, &(sfVector2i){end_point->y, end_point->x},
        &(sfVector2i){map->height - 2, map->width / 2});
    remove_empty_spaces(map, starting_point);
    map->ground[end_point->y][end_point->x] = M_BOSS;
}

void init_map(map_t *map, int diff,
    res_manager_t *rm, int nb_rays)
{
    sfVector2i starting_point;
    sfVector2i end_point;

    if (map->map_rect || map->line_wall)
        return;
    map->seed = map->seed ? map->seed : (time(NULL) % (LONG_MAX - 1)) + 1;
    srand(map->seed);
    map->width = DSETTING[diff].width + rand() % DSETTING[diff].r_width;
    map->height = DSETTING[diff].height + rand() % DSETTING[diff].r_height;
    starting_point = (sfVector2i){map->width / 2, (map->height * 0.025f)};
    end_point = (sfVector2i){(map->height * 0.975f), map->width / 2};
    create_random_ground(map);
    cellular_automata(map, DSETTING[diff].depth);
    for (int i = 0; i < map->width; i++)
        setup_border(map, i);
    make_enough_space(map, &starting_point, &end_point);
    add_second_type_wall(map);
    init_line_wall(map, nb_rays);
}
