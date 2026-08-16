/*
** EPITECH PROJECT, 2026
** is wall
** File description:
** is wall
*/

#include "map.h"

char is_wall(map_t *map, int x, int y)
{
    if (x < 0 || y < 0 || x >= map->width || y >= map->height)
        return M_WALL;
    return map->ground[x][y];
}
