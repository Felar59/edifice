struct Light {
  posRadius : vec4<f32>,   // xyz : position ; w : portée
  colour    : vec4<f32>,   // rgb : teinte ; a : intensité
};

// Une ouverture, vue comme une lampe rectangulaire portant la lumière de la pièce
// d'en face. C'est ce qui fait traverser l'éclairage d'une couture à l'autre.
struct MouthLight {
  centre : vec4<f32>,
  right  : vec4<f32>,   // demi-largeur, en longueur
  up     : vec4<f32>,   // demi-hauteur, en longueur
  colour : vec4<f32>,   // radiance sortante, en linéaire
};

struct Uniforms {
  viewProj : mat4x4<f32>,
  model    : mat4x4<f32>,
  camPos   : vec4<f32>,
  fog      : vec4<f32>,   // rgb = couleur du fond, a = densité
  ambient  : vec4<f32>,   // plancher de luminosité de la cellule
  params   : vec4<f32>,   // x : nombre de lampes ; y : nombre d'ouvertures
  lattice  : vec4<f32>,   // xyz : décalage de la copie, pour que l'éclairage se répète
  lights   : array<Light, 12>,
  mouths   : array<MouthLight, 8>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world  : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
  @location(3) color  : vec3<f32>,
  /**
   * La position ramenée dans la copie de référence du réseau.
   *
   * Elle vaut `world` partout ailleurs. Dans une salle qui se répète, chaque copie est
   * dessinée décalée du pas du réseau, et il faut l'éclairer **comme la copie centrale** —
   * sans quoi les lampes resteraient au même endroit du monde et les copies s'assombriraient
   * en s'éloignant, ce qui trahirait aussitôt la répétition.
   */
  @location(4) local  : vec3<f32>,
};

@vertex
fn vs(
  @location(0) pos : vec3<f32>,
  @location(1) nrm : vec3<f32>,
  @location(2) uv  : vec2<f32>,
  @location(3) col : vec3<f32>,
) -> VSOut {
  var out : VSOut;
  let w = u.model * vec4<f32>(pos, 1.0);
  out.clip = u.viewProj * w;
  out.world = w.xyz;
  out.local = w.xyz - u.lattice.xyz;
  out.normal = (u.model * vec4<f32>(nrm, 0.0)).xyz;
  out.uv = uv;
  out.color = col;
  return out;
}

const PI = 3.14159265;

// Décroissance en carré inverse, fermée par une fenêtre pour que la contribution
// tombe exactement à zéro à la portée. Sans elle il faudrait évaluer toutes les
// lampes du monde pour chaque fragment ; avec elle, celles de la cellule suffisent.
fn pointLight(p : vec3<f32>, n : vec3<f32>, l : Light) -> vec3<f32> {
  let toLight = l.posRadius.xyz - p;
  let d2 = dot(toLight, toLight);
  let radius = l.posRadius.w;
  let window = clamp(1.0 - d2 / (radius * radius), 0.0, 1.0);
  if (window <= 0.0) {
    return vec3<f32>(0.0);
  }
  let lambert = max(dot(n, toLight * inverseSqrt(max(d2, 1e-6))), 0.0);
  return l.colour.rgb * l.colour.a * lambert * window * window / (1.0 + d2);
}

// Une ouverture éclaire comme une source rectangulaire.
//
// On se contente du **point représentatif** : celui du rectangle le plus proche du
// fragment. C'est l'approximation classique des sources surfaciques, fausse de
// quelques pour cent sur les bords et indiscernable à l'œil — alors qu'intégrer
// vraiment sur le rectangle coûterait bien plus qu'on ne veut dépenser ici.
//
// L'atténuation est calibrée sur l'aire de l'ouverture : une grande porte éclaire
// plus loin qu'une petite, ce qui est le comportement attendu et qu'une simple
// lampe ponctuelle ne donnerait pas.
fn mouthLight(p : vec3<f32>, n : vec3<f32>, m : MouthLight) -> vec3<f32> {
  let halfWidth = length(m.right.xyz);
  let halfHeight = length(m.up.xyz);
  if (halfWidth < 1e-6 || halfHeight < 1e-6) {
    return vec3<f32>(0.0);
  }
  let r = m.right.xyz / halfWidth;
  let up = m.up.xyz / halfHeight;
  let facing = normalize(cross(r, up));   // pointe vers l'intérieur de la cellule

  // La lumière ne franchit l'ouverture que vers l'avant : rien pour ce qui est
  // derrière son plan.
  let d = p - m.centre.xyz;
  if (dot(d, facing) <= 0.0) {
    return vec3<f32>(0.0);
  }

  let closest = m.centre.xyz
    + r * clamp(dot(d, r), -halfWidth, halfWidth)
    + up * clamp(dot(d, up), -halfHeight, halfHeight);

  // Deux points, deux rôles.
  //
  // L'atténuation se cale sur le point le plus **proche** : c'est lui qui porte la
  // proximité, et une surface collée au montant doit recevoir beaucoup.
  //
  // La direction diffuse, elle, est prise à mi-chemin entre ce point et le centre de
  // l'ouverture. Le point le plus proche seul rase les surfaces : pour un fragment
  // de sol, il tombe au niveau du sol, la direction devient horizontale et le terme
  // de Lambert s'annule — une porte de deux mètres de haut n'éclairerait pas le sol
  // devant elle, ce qui est manifestement faux. Le centre seul se tromperait près des
  // bords. Le milieu des deux coûte une addition et se comporte bien partout.
  let toClosest = closest - p;
  let d2 = max(dot(toClosest, toClosest), 1e-6);

  let toSample = mix(closest, m.centre.xyz, 0.5) - p;
  let lambert = max(dot(n, normalize(toSample)), 0.0);

  let area = 4.0 * halfWidth * halfHeight;
  return m.colour.rgb * lambert * area / (area + 2.0 * PI * d2);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let toEye = u.camPos.xyz - in.world;
  let dist = length(toEye);

  // Éclairage deux faces : les parois sont des quads sans épaisseur, on ne veut pas
  // d'une face noire selon le côté d'où on la regarde.
  var n = normalize(in.normal);
  if (dot(n, toEye) < 0.0) { n = -n; }

  var light = u.ambient.rgb;

  let lightCount = u32(u.params.x);
  for (var i = 0u; i < lightCount; i++) {
    light += pointLight(in.local, n, u.lights[i]);
  }

  let mouthCount = u32(u.params.y);
  for (var i = 0u; i < mouthCount; i++) {
    light += mouthLight(in.local, n, u.mouths[i]);
  }

  var rgb = in.color * light;

  // Quadrillage d'un mètre, antialiasé par la dérivée d'écran.
  // Sans repère régulier, il est impossible de juger à l'œil si l'image vue à
  // travers une couture est correctement alignée — c'est l'outil de diagnostic
  // principal de cette étape.
  let g = abs(fract(in.uv - vec2<f32>(0.5)) - vec2<f32>(0.5)) / fwidth(in.uv);
  let line = 1.0 - min(min(g.x, g.y), 1.0);
  rgb = rgb * (1.0 - 0.34 * line);

  let fogAmount = clamp(1.0 - exp(-dist * u.fog.w), 0.0, 1.0);
  rgb = mix(rgb, u.fog.rgb, fogAmount);

  // Le format du canevas n'est pas sRGB : c'est à nous d'encoder. Tout le calcul
  // ci-dessus est linéaire — mélanger de la lumière dans un espace déjà encodé
  // donnerait des dégradés faux et une image bien trop sombre.
  // Les cibles intermédiaires reçoivent la même valeur encodée, si bien que le
  // nuanceur de portail se contente de recopier : aucune double correction.
  return vec4<f32>(pow(rgb, vec3<f32>(1.0 / 2.2)), 1.0);
}
