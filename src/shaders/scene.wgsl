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
  fogBand  : vec4<f32>,   // x : sol de la cellule ; y : plafond, pour la brume basse
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
  /** L'identifiant de matière, constant sur toute une surface. */
  @location(5) matter : f32,
};

@vertex
fn vs(
  @location(0) pos : vec3<f32>,
  @location(1) nrm : vec3<f32>,
  @location(2) uv  : vec2<f32>,
  @location(3) col : vec3<f32>,
  @location(4) mat : f32,
) -> VSOut {
  var out : VSOut;
  let w = u.model * vec4<f32>(pos, 1.0);
  out.clip = u.viewProj * w;
  out.world = w.xyz;
  out.local = w.xyz - u.lattice.xyz;
  out.normal = (u.model * vec4<f32>(nrm, 0.0)).xyz;
  out.uv = uv;
  out.color = col;
  out.matter = mat;
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

// ---------------------------------------------------------------------------
// Les matières.
//
// Tout est calculé ici, à partir des seules coordonnées de surface — pas une image, pas un
// octet à charger. C'est ainsi que l'ancien moteur du portfolio faisait ses murs de galerie
// et ses sols de marbre, et la méthode vaut mieux que jamais : ce qui se calcule ne pèse
// rien au téléchargement, ne pixellise pas de près, et se décline à volonté.
//
// Les coordonnées sont en **mètres**, ce qui permet de raisonner en tailles réelles : une
// dalle de marbre fait un mètre, une lame de parquet douze centimètres, une planche de
// coffrage vingt-cinq. Une cimaise tombe donc toujours à quatre-vingt-dix centimètres,
// quelle que soit la salle où on la pose.
// ---------------------------------------------------------------------------

/** Bruit de valeur haché : reproductible, sans table, et assez bon pour de la matière. */
fn hash21(p : vec2<f32>) -> f32 {
  var h = fract(p * vec2<f32>(0.1031, 0.1030));
  h += dot(h, h.yx + 33.33);
  return fract((h.x + h.y) * h.x);
}

fn noise21(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p : vec2<f32>) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var at = p;
  for (var i = 0; i < 4; i++) {
    sum += amp * noise21(at);
    at *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Une rainure, adoucie à la largeur d'un pixel.
 *
 * L'adoucissement lui est **donné**, il ne le calcule pas. Les dérivées d'écran — `fwidth`
 * et sa famille — sont interdites sous une condition qui n'est pas uniforme, et tout ce
 * fichier est fait de conditions sur la matière. On les prend donc une fois pour toutes en
 * tête de nuanceur, là où le flot est uniforme, et on les fait descendre.
 */
fn groove(x : f32, period : f32, width : f32, blur : f32) -> f32 {
  let d = abs(fract(x / period - 0.5) - 0.5) * period;
  return 1.0 - smoothstep(width, width + blur * 1.5, d);
}

fn surface(matter : f32, uv : vec2<f32>, base : vec3<f32>, blur : vec2<f32>) -> vec3<f32> {
  let m = i32(matter + 0.5);

  // 1 — Marbre. Des veines lentes et un joint tous les mètres. Le veinage est du bruit
  // replié sur lui-même : c'est ce qui lui donne ses filets nets au milieu des nuages.
  if (m == 1) {
    // Les veines d'une pierre ne brillent pas : elles **assombrissent**. Éclaircies, elles
    // se lisaient comme des éclairs peints sur le sol.
    let vein = fbm(uv * 0.55);
    let filament = abs(sin((uv.x + uv.y * 0.6) * 1.6 + vein * 5.0));
    let veins = pow(1.0 - clamp(filament, 0.0, 1.0), 9.0);
    let grain = fbm(uv * 9.0) * 0.05;
    let joint = max(groove(uv.x, 1.0, 0.012, blur.x), groove(uv.y, 1.0, 0.012, blur.y));
    return base * (0.97 + grain - veins * 0.22) * (1.0 - 0.22 * joint);
  }

  // 2 — Parquet. Lames de douze centimètres, décalées, chacune de son ton, avec le fil du
  // bois dans le sens de la lame.
  if (m == 2) {
    let strip = floor(uv.y / 0.12);
    let shift = fract(strip * 0.37) * 0.8;
    let plank = floor((uv.x + shift) / 0.85);
    let tone = 0.82 + hash21(vec2<f32>(plank, strip)) * 0.34;
    let fibre = 0.94 + fbm(vec2<f32>(uv.x * 3.0, uv.y * 42.0)) * 0.14;
    let joints = max(groove(uv.y, 0.12, 0.006, blur.y), groove(uv.x + shift, 0.85, 0.008, blur.x));
    return base * tone * fibre * (1.0 - 0.45 * joints);
  }

  // 3 — Moquette. Aucune ligne, seulement un grain fin : c'est l'absence de joint qui la
  // fait reconnaître sans qu'on y pense.
  if (m == 3) {
    let fluff = fbm(uv * 60.0) * 0.16 + fbm(uv * 13.0) * 0.1;
    return base * (0.9 + fluff);
  }

  // 4 — Mur de galerie : un lambris bas, sa cimaise, le plâtre au-dessus.
  if (m == 4) {
    let grain = fbm(uv * 5.0) * 0.05;
    if (uv.y < 0.82) {
      let panel = groove(uv.x, 0.9, 0.01, blur.x);
      return base * (0.44 + grain) * (1.0 - 0.4 * panel);
    }
    if (uv.y < 0.94) {
      return base * (0.68 + grain);
    }
    return base * (1.0 + grain);
  }

  // 5 — Pierre de taille. Des blocs d'un mètre sur cinquante, en assises décalées, chacun
  // d'un ton légèrement différent.
  if (m == 5) {
    let row = floor(uv.y / 0.5);
    let shift = select(0.0, 0.5, fract(row * 0.5) > 0.25);
    let block = floor((uv.x + shift) / 1.0);
    let tone = 0.88 + hash21(vec2<f32>(block, row)) * 0.22;
    let pit = fbm(uv * 16.0) * 0.09;
    let joints = max(groove(uv.y, 0.5, 0.018, blur.y), groove(uv.x + shift, 1.0, 0.018, blur.x));
    return base * (tone + pit) * (1.0 - 0.35 * joints);
  }

  // 6 — Plafond à caissons. Un cadre saillant, un fond en retrait : le relief est feint par
  // la lumière, et à cette distance personne ne va vérifier.
  if (m == 6) {
    let cell = abs(fract(uv / 1.2) - vec2<f32>(0.5)) * 2.0;
    let edge = max(cell.x, cell.y);
    let frame = smoothstep(0.72, 0.78, edge);
    let deep = smoothstep(0.0, 0.6, 1.0 - edge);
    return base * (0.72 + frame * 0.34 - deep * 0.18);
  }

  // 7 — Béton banché. Les planches du coffrage laissent leur trace tous les vingt-cinq
  // centimètres, et les trous de banche leur grille. C'est la matière de la direction
  // artistique du musée : brute, monumentale, sans ornement.
  if (m == 7) {
    let board = floor(uv.y / 0.25);
    let tone = 0.93 + hash21(vec2<f32>(board, 3.0)) * 0.1;
    let mottle = fbm(uv * 2.2) * 0.13 + fbm(uv * 11.0) * 0.05;
    let seam = groove(uv.y, 0.25, 0.006, blur.y);
    let hole = fract(uv / 1.5) - vec2<f32>(0.5);
    let tie = 1.0 - smoothstep(0.012, 0.02, length(hole) * 1.5);
    return base * (tone + mottle) * (1.0 - 0.18 * seam) * (1.0 - 0.5 * tie);
  }

  // 8 — Tôle rivetée. Des panneaux, leurs rivets, et le brossé du métal.
  if (m == 8) {
    let cell = vec2<f32>(2.0, 1.0);
    let panel = floor(uv / cell);
    let tone = 0.82 + hash21(panel) * 0.26;
    let brushed = 0.94 + fbm(vec2<f32>(uv.x * 70.0, uv.y * 2.0)) * 0.14;
    let inner = abs(fract(uv / cell) - vec2<f32>(0.5)) * 2.0;
    let seam = smoothstep(0.9, 0.985, max(inner.x, inner.y));
    // Les rivets courent le long du joint, comme sur une vraie tôle : c'est leur file qui
    // dit « métal », pas le grain.
    let stud = fract(uv / vec2<f32>(0.25, 1.0)) - vec2<f32>(0.5, 0.5);
    let near = smoothstep(0.78, 0.9, inner.y);
    let rivet = (1.0 - smoothstep(0.14, 0.24, abs(stud.x))) * near;
    return base * tone * brushed * (1.0 - 0.45 * seam) * (1.0 + 0.3 * rivet);
  }

  // 9 — Plâtre. Rien qu'un nuage très lent, à peine perceptible. C'est la matière la plus
  // difficile à réussir, parce qu'elle n'a aucun motif pour se rattraper : un plâtre plat
  // est un aplat, un plâtre trop marqué est du crépi.
  if (m == 9) {
    let cloud = fbm(uv * 0.6) * 0.06 + fbm(uv * 4.0) * 0.02;
    return base * (0.97 + cloud);
  }

  // 0 — Neutre : le quadrillage d'un mètre, qui est un outil de mise au point avant d'être
  // un décor. Sans repère régulier, impossible de juger à l'œil si l'image vue à travers une
  // couture est correctement alignée.
  let g = abs(fract(uv - vec2<f32>(0.5)) - vec2<f32>(0.5)) / blur;
  let line = 1.0 - min(min(g.x, g.y), 1.0);
  return base * (1.0 - 0.34 * line);
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

  // Les dérivées se prennent ici, en flot uniforme, et voyagent ensuite : WGSL les
  // interdit sous une condition, et toutes les matières en sont faites.
  var rgb = surface(in.matter, in.uv, in.color, fwidth(in.uv)) * light;

  // **Le brouillard, en exponentielle carrée et plus dense au ras du sol.**
  //
  // L'exponentielle simple part de zéro avec une pente immédiate : tout s'estompe un peu,
  // dès le premier mètre, et l'image entière prend un voile. Son carré démarre à plat, donc
  // ce qui est proche reste franc, puis se referme d'un coup — c'est ce qui fait un horizon
  // plutôt qu'un voile.
  //
  // La brume basse ajoute ce qu'aucune densité uniforme ne donne : une salle a un sol, et
  // l'air y est toujours plus épais qu'au plafond. Une demi-densité de plus en bas, une
  // demi-densité de moins en haut, et la profondeur se lit dans l'image sans qu'on ait rien
  // ajouté à la géométrie.
  let ground = u.fogBand.x;
  let ceiling = max(u.fogBand.y, ground + 0.001);
  let height = clamp((in.world.y - ground) / (ceiling - ground), 0.0, 1.0);
  let thickness = u.fog.w * mix(1.25, 0.85, height);
  let reach = dist * thickness;
  let fogAmount = clamp(1.0 - exp(-reach * reach), 0.0, 1.0);
  rgb = mix(rgb, u.fog.rgb, fogAmount);

  // Le format du canevas n'est pas sRGB : c'est à nous d'encoder. Tout le calcul
  // ci-dessus est linéaire — mélanger de la lumière dans un espace déjà encodé
  // donnerait des dégradés faux et une image bien trop sombre.
  // Les cibles intermédiaires reçoivent la même valeur encodée, si bien que le
  // nuanceur de portail se contente de recopier : aucune double correction.
  return vec4<f32>(pow(rgb, vec3<f32>(1.0 / 2.2)), 1.0);
}
