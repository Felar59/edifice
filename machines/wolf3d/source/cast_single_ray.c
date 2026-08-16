/*
** EPITECH PROJECT, 2026
** single ray casting
** File description:
** single ray casting
*/

#include "wolf3d.h"
#include "raycasting.h"

dda_t init_dda(global_t *glb, float angle)
{
    dda_t dda = {
        .start = {PX(glb), PY(glb)},
        .map = {(int)PX(glb), (int)PY(glb)},
        .dir = {cosf(angle), sinf(angle)},
    };

    dda.unit_step = (sfVector2f){
        sqrtf(1 + (dda.dir.y / dda.dir.x) * (dda.dir.y / dda.dir.x)),
        sqrtf(1 + (dda.dir.x / dda.dir.y) * (dda.dir.x / dda.dir.y))
    };
    dda.step.x = dda.dir.x < 0 ? -1 : 1;
    dda.ray_length.x = dda.dir.x < 0 ?
        (dda.start.x - (float)dda.map.x) * dda.unit_step.x :
        ((float)(dda.map.x + 1) - dda.start.x) * dda.unit_step.x;
    dda.step.y = dda.dir.y < 0 ? -1 : 1;
    dda.ray_length.y = dda.dir.y < 0 ?
        (dda.start.y - (float)dda.map.y) * dda.unit_step.y :
        ((float)(dda.map.y + 1) - dda.start.y) * dda.unit_step.y;
    return dda;
}

static void step_dda(dda_t *dda)
{
    if (dda->ray_length.x < dda->ray_length.y) {
        dda->map.x += (int)dda->step.x;
        dda->ray_length.x += dda->unit_step.x;
        dda->side = 0;
        return;
    }
    dda->map.y += (int)dda->step.y;
    dda->ray_length.y += dda->unit_step.y;
    dda->side = 1;
}

sfBool in_wall_list(wall_textures_t *walls, char type)
{
    for (int i = 0; walls[i].type != 0; i++)
        if (walls[i].type == type)
            return sfTrue;
    return sfFalse;
}

float get_distance(float x, float y, sfVector2f *hit)
{
    float dx = hit->x - x;
    float dy = hit->y - y;

    return sqrt(dx * dx + dy * dy);
}

int wall_enter_enemy(global_t *glb, enemy_t *enemy)
{
    float angle = atan2(enemy->pos.y - PY(glb), enemy->pos.x - PX(glb));
    dda_t dda = init_dda(glb, angle);
    float dist;
    wall_type_t hit;

    hit.type = is_wall(&glb->simu.map, dda.map.x, dda.map.y);
    while (!in_wall_list(glb->simu.walls, hit.type)) {
        step_dda(&dda);
        dist = dda.side == 0 ? dda.ray_length.x - dda.unit_step.x :
            dda.ray_length.y - dda.unit_step.y;
        if (fabsf(dist) >= enemy->dist)
            return 0;
        hit.type = is_wall(&glb->simu.map, dda.map.x, dda.map.y);
    }
    return 1;
}

wall_type_t cast_single_ray(global_t *glb, float angle)
{
    dda_t dda = init_dda(glb, angle);
    float dist;
    wall_type_t hit;

    hit.type = is_wall(&glb->simu.map, dda.map.x, dda.map.y);
    while (!in_wall_list(glb->simu.walls, hit.type)) {
        step_dda(&dda);
        hit.type = is_wall(&glb->simu.map, dda.map.x, dda.map.y);
    }
    dist = dda.side == 0 ? dda.ray_length.x - dda.unit_step.x :
        dda.ray_length.y - dda.unit_step.y;
    hit.pose = (sfVector2f){dda.start.x + dda.dir.x * dist,
        dda.start.y + dda.dir.y * dist};
    hit.map_pos = dda.map;
    hit.side = dda.side;
    return hit;
}
