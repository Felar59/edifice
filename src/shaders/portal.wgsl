struct Uniforms {
  viewProj : mat4x4<f32>,
  center   : vec4<f32>,
  right    : vec4<f32>,   // right × demi-largeur
  up       : vec4<f32>,   // up × demi-hauteur
  params   : vec4<f32>,   // x : 1 = image disponible ; y : 1 = plein écran
  fallback : vec4<f32>,   // couleur de repli, en linéaire
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var src : texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0,  1.0), vec2<f32>(-1.0,  1.0),
  );
  let k = corners[i];

  // Mode plein écran : la caméra est **dans** l'ouverture, plus près du plan que
  // le plan proche lui-même. Le quad géométrique serait alors entièrement écrêté,
  // et il ne resterait que le trou dans la paroi — d'où une image intégralement
  // vide pendant l'image du franchissement. Or à cette distance l'ouverture
  // couvre de toute façon tout le champ : on peint l'écran entier, au plus près.
  if (u.params.y > 0.5) {
    return vec4<f32>(k, 0.0, 1.0);
  }

  let world = u.center.xyz + u.right.xyz * k.x + u.up.xyz * k.y;
  return u.viewProj * vec4<f32>(world, 1.0);
}

@fragment
fn fs(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  if (u.params.x < 0.5) {
    // Même encodage que la scène, sans quoi le fond de récursion trancherait
    // sur le brouillard qui l'entoure au lieu de s'y confondre.
    return vec4<f32>(pow(u.fallback.rgb, vec3<f32>(1.0 / 2.2)), 1.0);
  }
  // L'image de l'autre côté a été rendue avec exactement la même projection en
  // x et en y : le plan proche oblique ne modifie que la troisième ligne de la
  // matrice, jamais les deux premières ni la quatrième. Le pixel cherché est
  // donc au même endroit à l'écran, et un `textureLoad` à la position du
  // fragment est **exact** — aucun filtrage, aucun demi-pixel de dérive.
  return vec4<f32>(textureLoad(src, vec2<i32>(frag.xy), 0).rgb, 1.0);
}
