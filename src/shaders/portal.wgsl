struct Uniforms {
  viewProj : mat4x4<f32>,
  // Silhouette de l'ouverture, déjà découpée devant l'œil par le processeur. Au
  // plus cinq sommets : un quadrilatère convexe coupé par un demi-espace en donne
  // quatre plus un.
  poly     : array<vec4<f32>, 5>,
  params   : vec4<f32>,   // x : 1 = image disponible, 0 = repli ; y : nombre de sommets
  fallback : vec4<f32>,   // couleur de repli, en linéaire
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var src : texture_2d<f32>;

// Éventail de triangles sur le polygone : (0, 1, 2), (0, 2, 3), (0, 3, 4).
// On dessine toujours neuf sommets ; les triangles en trop, quand le polygone en
// compte moins de cinq, sont rendus dégénérés en repliant leurs indices sur zéro.
@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
  let count = u32(u.params.y);
  let triangle = i / 3u;
  let corner = i % 3u;

  var index = 0u;
  if (corner == 1u) { index = triangle + 1u; }
  if (corner == 2u) { index = triangle + 2u; }
  if (index >= count) { index = 0u; }

  var clip = u.viewProj * vec4<f32>(u.poly[index].xyz, 1.0);

  // Borner la profondeur au plan proche, sans toucher au reste.
  //
  // La profondeur est **inversée** — le plan proche vaut `w`, le lointain zéro : c'est ce
  // qui donne au tampon flottant sa précision au loin, où deux surfaces distantes de
  // quelques millimètres se disputaient les pixels. La borne est donc un minimum contre
  // `w`, et non un maximum contre zéro : borner à zéro poserait le quad **sur le
  // lointain**, où il perd le test de profondeur contre tout, et l'ouverture cesserait
  // d'être dessinée juste avant qu'on la franchisse.
  //
  // Dès qu'on approche l'ouverture à moins de la distance du plan proche, son quad
  // se fait intégralement écrêter : il ne reste que le trou dans la paroi, donc une
  // image vide au moment du franchissement. Or `z` ne détermine que la profondeur —
  // la position à l'écran vient de `x`, `y` et `w`. La ramener à zéro pose donc le
  // sommet **sur** le plan proche sans le déplacer d'un pixel.
  //
  // Une tentative précédente éloignait plutôt le sommet le long de son rayon, ce qui
  // préserve aussi la projection. Mais un coin passé derrière l'œil ne peut pas être
  // éloigné vers l'avant, et les positions obtenues devenaient extravagantes quand
  // la profondeur frôlait zéro. Borner `z` évite les deux écueils ; le découpage
  // amont se charge des coins derrière l'œil.
  //
  // Conséquence assumée : sur ces quelques millimètres, l'ouverture gagne le test de
  // profondeur contre tout ce qui la précède. Rien ne peut s'y trouver — il faudrait
  // un objet coincé entre l'œil et une porte qu'on touche du nez.
  clip.z = min(clip.z, clip.w);
  return clip;
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
