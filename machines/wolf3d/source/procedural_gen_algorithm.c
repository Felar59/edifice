/*
** EPITECH PROJECT, 2026
** is wall
** File description:
** is wall
*/

#include "map.h"
#include <stdlib.h>

static int amount_neighbors(map_t *map, int x, int y)
{
    int n = 0;
    int nx = 0;
    int ny = 0;

    for (int i = 0; i < 8; i++) {
        nx = x + directions[i].x;
        ny = y + directions[i].y;
        if (nx < 0 || ny < 0 || nx >= map->width || ny >= map->height) {
            n++;
            continue;
        }
        if (map->buffer[nx][ny] == M_WALL)
            n++;
    }
    return n;
}

static void alive_or_dead(map_t *map, int x, int y)
{
    int n = amount_neighbors(map, x, y);

    if (n > 4)
        map->ground[x][y] = M_WALL;
    else
        map->ground[x][y] = M_VOID;
}

void cellular_automata(map_t *map, int depth)
{
    if (depth == 0)
        return;
    for (int i = 0; i < map->width; i++)
        for (int j = 0; j < map->height; j++)
            map->buffer[i][j] = map->ground[i][j];
    for (int x = 0; x < map->width; x++)
        for (int y = 0; y < map->height; y++)
            alive_or_dead(map, x, y);
    cellular_automata(map, depth - 1);
}

static void move_towards(sfVector2i *starting_point,
    sfVector2i *end_point)
{
    if (rand() % 50 > 40) {
        if (starting_point->x < end_point->y) {
            starting_point->x++;
            return;
        }
        if (starting_point->x > end_point->y) {
            starting_point->x--;
            return;
        }
    } else {
        if (starting_point->y < end_point->x) {
            starting_point->y++;
            return;
        }
        if (starting_point->y > end_point->x) {
            starting_point->y--;
            return;
        }
    }
}

static void random_move(map_t *map, sfVector2i *starting_point)
{
    int dir = rand() % 4;

    if (dir == 0 && starting_point->x > 1
        && map->ground[starting_point->x - 1][starting_point->y] == M_VOID)
        starting_point->x--;
    if (dir == 1 && starting_point->x < map->width - 2
        && map->ground[starting_point->x + 1][starting_point->y] == M_VOID)
        starting_point->x++;
    if (dir == 2 && starting_point->y > 1
        && map->ground[starting_point->x][starting_point->y - 1] == M_VOID)
        starting_point->y--;
    if (dir == 3 && starting_point->y < map->height - 2
        && map->ground[starting_point->x][starting_point->y + 1] == M_VOID)
        starting_point->y++;
}

void random_walk(map_t *map, sfVector2i *starting_point, sfVector2i *end_point)
{
    sfVector2i cpy_start = {starting_point->x, starting_point->y};

    while ((cpy_start.x != end_point->y)
        || (cpy_start.y != end_point->x)) {
        if (rand() % 1000 < 5)
            move_towards(&cpy_start, end_point);
        else
            random_move(map, &cpy_start);
        map->ground[cpy_start.x][cpy_start.y] = M_VOID;
    }
}
