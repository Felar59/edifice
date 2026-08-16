/*
** EPITECH PROJECT, 2026
** raycasting
** File description:
** raycasting
*/

#ifndef F6B21830_4C9F_477C_A7CF_57AB1CB8F8D7
    #define F6B21830_4C9F_477C_A7CF_57AB1CB8F8D7
    #include <SFML/Graphics.h>

    #define FL_CL_SHADER glb->simu.floor_ceiling_shader

typedef struct global global_t;
typedef struct wall_textures_s wall_textures_t;
typedef struct enemy_s enemy_t;

typedef struct wall_type_s {
    sfVector2f pose;
    sfVector2i map_pos;
    char type;
    int side;
} wall_type_t;

typedef struct bomb_info_s {
    sfVector2f pos;
    sfVector2u win_size;
    sfVector2u tex_size;
    float angle;
    float angle_diff;
    float fov;
    float dist;
    int ray_index;
    float wall_dist;
    float sprite_size;
} bomb_info_t;


typedef struct ceiling_floor_info_s {
    sfVector2u win_s;
    sfVector2f hit;
    sfVector2f hit_map;
    sfVector2i mp_crd;
    int wall_count;
} ceiling_floor_info_t;

typedef struct dda_s {
    sfVector2f start;
    sfVector2i map;
    sfVector2f dir;
    sfVector2f unit_step;
    sfVector2f ray_length;
    sfVector2f step;
    int side;
} dda_t;

wall_type_t cast_single_ray(global_t *glb, float angle);
void cast_all_rays(global_t *glb, float step_angle);
void create_floor_and_ceiling(global_t *glb);
void apply_vision(global_t *glb);
void apply_brightness(global_t *glb);
int is_vertical_hit(sfVector2f *hit);
float get_distance(float x, float y, sfVector2f *hit);
dda_t init_dda(global_t *glb, float angle);
sfBool in_wall_list(wall_textures_t *walls, char type);
int wall_enter_enemy(global_t *glb, enemy_t *enemy);
void draw_wall_bomb(global_t *glb);

#endif /* F6B21830_4C9F_477C_A7CF_57AB1CB8F8D7 */
