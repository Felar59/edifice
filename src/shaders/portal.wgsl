struct Uniforms {
  viewProj : mat4x4<f32>,
  center   : vec4<f32>,
  right    : vec4<f32>,   // right × demi-largeur
  up       : vec4<f32>,   // up × demi-hauteur
  camera   : vec4<f32>,   // xyz : position de l'œil ; w : profondeur minimale admise
  viewFwd  : vec4<f32>,   // xyz : direction du regard, unitaire
  params   : vec4<f32>,   // x : 1 = image disponible, 0 = repli
  fallback : vec4<f32>,   // couleur de repli, en linéaire
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var src : texture_2d<f32>;

// Ramène un point au-delà du plan proche **sans changer sa projection**.
//
// Le problème : dès qu'on approche l'ouverture à moins de la distance du plan
// proche, le quad du portail se fait intégralement écrêter. Il ne reste alors que
// le trou dans la paroi, donc une image vide — précisément pendant le
// franchissement.
//
// La parade repose sur une propriété simple : **la projection d'un point est
// invariante le long du rayon qui le relie à l'œil.** On peut donc éloigner chaque
// coin de l'œil autant qu'il faut pour qu'il repasse devant le plan proche, sans
// déplacer d'un pixel la silhouette du quad — un segment droit en 3D se projetant
// en un segment droit, les arêtes restent exactement où elles étaient.
//
// C'est ce qui distingue cette méthode de la solution naïve consistant à peindre
// tout l'écran quand on est près de l'ouverture : celle-là ignore la direction du
// regard. Debout dans l'embrasure et tourné vers l'arrière, elle recouvrait toute
// l'image avec la vue d'une caméra virtuelle qui regarde hors de la salle d'en
// face — un grand aplat gris à la place de la pièce où l'on se trouve.
fn pushBeyondNear(p : vec3<f32>, eye : vec3<f32>, fwd : vec3<f32>, minDepth : f32) -> vec3<f32> {
  let ray = p - eye;
  let depth = dot(ray, fwd);
  // Un coin situé derrière l'œil est laissé intact : l'écrêtage matériel en fera ce
  // qu'il faut, alors que le tirer vers l'avant le renverrait du mauvais côté.
  if (depth <= 0.0 || depth >= minDepth) {
    return p;
  }
  return eye + ray * (minDepth / depth);
}

@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0,  1.0), vec2<f32>(-1.0,  1.0),
  );
  let k = corners[i];
  let corner = u.center.xyz + u.right.xyz * k.x + u.up.xyz * k.y;
  let world = pushBeyondNear(corner, u.camera.xyz, u.viewFwd.xyz, u.camera.w);
  return u.viewProj * vec4<f32>(world, 1.0);
}

@fragment
fn fs(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  if (u.params.x < 0.5) {
    // Même encodage que la scène, sans quoi le fond de récursion trancherait sur le
    // brouillard qui l'entoure au lieu de s'y confondre.
    return vec4<f32>(pow(u.fallback.rgb, vec3<f32>(1.0 / 2.2)), 1.0);
  }
  // L'image de l'autre côté a été rendue avec exactement la même projection en x et
  // en y : le plan proche oblique ne modifie que la troisième ligne de la matrice,
  // jamais les deux premières ni la quatrième. Le pixel cherché est donc au même
  // endroit à l'écran, et un `textureLoad` à la position du fragment est **exact** —
  // aucun filtrage, aucun demi-pixel de dérive.
  return vec4<f32>(textureLoad(src, vec2<i32>(frag.xy), 0).rgb, 1.0);
}
