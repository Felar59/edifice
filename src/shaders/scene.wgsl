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
// **Portées de l'ancien moteur du portfolio**, dont les textures étaient bonnes, et qui les
// calculait pixel par pixel sur le processeur. Ici elles se calculent par fragment sur la
// carte : mêmes recettes, mêmes proportions, mais sans image en mémoire, sans pixellisation
// de près, et sans répétition visible — les coordonnées étant en mètres et continues, un mur
// de vingt mètres ne répète pas une tuile, il déroule un motif.
//
// Trois principes hérités, et ce sont eux qui font la différence entre une matière et un
// aplat teinté :
//
// - **un grain fin partout.** Sans lui, une surface plane a l'air d'une image de synthèse de
//   1995. Il s'efface avec la distance, sinon il grésillerait ;
// - **une variation par élément.** Chaque bloc de pierre, chaque lame de parquet a son ton
//   propre, tiré d'un haché de sa position. C'est ce qui casse la régularité ;
// - **des joints creux, et une arête éclairée juste dessous.** Un joint seul fait un dessin ;
//   un joint plus son arête fait un relief.
//
// Les dérivées d'écran sont **données** aux matières, jamais calculées par elles : WGSL les
// interdit sous une condition non uniforme, et tout ce fichier est fait de conditions.
// ---------------------------------------------------------------------------

/** Haché entier vers [0,1). Celui de l'ancien moteur, à l'identique. */
fn hash2(x : f32, y : f32) -> f32 {
  var h = u32(i32(x) * 668265261) ^ u32(i32(y) * 374761393);
  h ^= h >> 15u;
  h *= 2246822519u;
  h ^= h >> 13u;
  h *= 3266489917u;
  h ^= h >> 16u;
  return f32(h >> 8u) / 16777216.0;
}

fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i.x, i.y);
  let b = hash2(i.x + 1.0, i.y);
  let c = hash2(i.x, i.y + 1.0);
  let d = hash2(i.x + 1.0, i.y + 1.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p : vec2<f32>) -> f32 {
  var sum = 0.0;
  var norm = 0.0;
  var amp = 1.0;
  var at = p;
  for (var i = 0; i < 4; i++) {
    sum += amp * vnoise(at);
    norm += amp;
    amp *= 0.55;
    at *= 2.0;
  }
  return sum / norm;
}

/** fbm « turbulent » : c'est la valeur absolue qui donne au marbre ses veines. */
fn turbulence(p : vec2<f32>) -> f32 {
  var sum = 0.0;
  var norm = 0.0;
  var amp = 1.0;
  var at = p;
  for (var i = 0; i < 4; i++) {
    sum += amp * abs(vnoise(at) * 2.0 - 1.0);
    norm += amp;
    amp *= 0.5;
    at *= 2.0;
  }
  return sum / norm;
}

/**
 * Le grain fin, qui s'efface avec la distance.
 *
 * Sans lui les surfaces planes ont l'air d'une image de synthèse de 1995 ; sans son
 * effacement, elles grésillent dès qu'un pixel couvre plus d'un centimètre, faute de
 * mip-map. On le fait donc disparaître exactement là où il commencerait à bouger.
 */
fn grain(p : vec2<f32>, amount : f32, blur : f32) -> f32 {
  let fade = 1.0 - smoothstep(0.004, 0.02, blur);
  if (fade <= 0.0) { return 0.0; }
  return (hash2(floor(p.x * 320.0), floor(p.y * 320.0)) - 0.5) * amount * fade;
}

/** Une rainure creuse, adoucie à la largeur d'un pixel. */
fn groove(x : f32, period : f32, width : f32, blur : f32) -> f32 {
  let d = abs(fract(x / period - 0.5) - 0.5) * period;
  return 1.0 - smoothstep(width, width + blur * 1.5, d);
}

fn surface(matter : f32, uv : vec2<f32>, base : vec3<f32>, blur : vec2<f32>) -> vec3<f32> {
  let m = i32(matter + 0.5);
  let fine = grain(uv, 0.03, max(blur.x, blur.y));

  // 1 — Marbre veiné. Le veinage vient d'une sinusoïde déformée par de la turbulence : là où
  // la sinusoïde passe par zéro, on trace une veine. Deux familles se superposent — des
  // veines principales franches, et un réseau secondaire plus fin et plus pâle. La veine est
  // une **couleur**, pas un éclaircissement : une pierre veinée ne brille pas.
  if (m == 1) {
    let t1 = turbulence(uv * 2.6);
    let s1 = abs(sin((uv.x * 2.6 + uv.y * 1.6 + t1 * 1.6) * 3.14159265));
    let v1 = 1.0 - smoothstep(0.0, 0.16, s1);

    let t2 = turbulence(uv * 6.0 + vec2<f32>(5.0, 0.0));
    let s2 = abs(sin((uv.x * 4.7 - uv.y * 3.4 + t2 * 1.9) * 3.14159265));
    let v2 = (1.0 - smoothstep(0.0, 0.10, s2)) * 0.45;

    let amount = clamp(v1 + v2, 0.0, 1.0) * 0.55;
    let vein = base * 0.62;
    let mottle = 0.975 + 0.05 * fbm(uv * 4.0);

    // Le chanfrein du bord de dalle, tous les mètres.
    let cell = abs(fract(uv) - vec2<f32>(0.5));
    let edge = (1.0 - smoothstep(0.0, 0.02, 0.5 - max(cell.x, cell.y))) * 0.16;
    return (mix(base * mottle, vein, amount) + fine) * (1.0 - edge);
  }

  // 2 — Parquet mosaïque : des carrés de lames alternant à quatre-vingt-dix degrés, comme
  // dans les vieilles galeries. Chaque lame a son ton et son fil.
  if (m == 2) {
    let BLOCK = 0.6;
    let PLANK = 0.15;
    let b = floor(uv / BLOCK);
    let horiz = (i32(b.x) + i32(b.y)) % 2 == 0;
    let inside = uv - b * BLOCK;

    var plank = 0.0;
    var across = 0.0;
    var along = 0.0;
    if (horiz) {
      plank = floor(inside.y / PLANK);
      across = fract(inside.y / PLANK);
      along = inside.x / BLOCK;
    } else {
      plank = floor(inside.x / PLANK);
      across = fract(inside.x / PLANK);
      along = inside.y / BLOCK;
    }

    let seedX = b.x * 4.0 + plank;
    let seedY = b.y * 4.0 + select(1.0, 0.0, horiz);
    let tone = 0.80 + 0.40 * hash2(seedX, seedY * 31.0 + 7.0);
    let fil = 0.86 + 0.28 * fbm(vec2<f32>(along * 9.0 + seedX * 3.7, across * 2.0 + seedY * 1.3));

    let joint = max(1.0 - smoothstep(0.0, 0.09, across), 1.0 - smoothstep(0.0, 0.09, 1.0 - across));
    let corner = min(min(inside.x, BLOCK - inside.x), min(inside.y, BLOCK - inside.y));
    let bedge = 1.0 - smoothstep(0.0, 0.012, corner);

    var k = tone * fil;
    k = mix(k, k * 0.55, joint * 0.9);
    k = mix(k, k * 0.62, bedge * 0.7);
    // Le vernis : un très léger dégradé le long de la lame.
    k *= 1.0 + 0.05 * (along - 0.5);
    return base * k + fine;
  }

  // 3 — Moquette dense : des fibres orientées, des taches lentes, aucun joint. C'est
  // l'absence de ligne qui la fait reconnaître sans qu'on y pense.
  if (m == 3) {
    let fibers = fbm(vec2<f32>(uv.x * 60.0, uv.y * 22.0));
    let blotch = fbm(uv * 4.0);
    return base * (0.80 + 0.30 * fibers + 0.10 * blotch) + grain(uv, 0.05, max(blur.x, blur.y));
  }

  // 4 — Mur de galerie : plinthe, lambris à panneaux, chapeau, plâtre, cimaise.
  //
  // Les hauteurs sont en **mètres réels** et non en fractions de la paroi, contrairement à
  // l'original : une cimaise est à deux mètres vingt du sol dans une salle de quatre mètres
  // comme dans une salle de sept, et la faire monter avec le plafond donnait un lambris de
  // deux mètres de haut.
  if (m == 4) {
    let h = uv.y;
    // Le bois n'est pas le mur en plus sombre : c'est une autre matière, plus chaude.
    // L'ancien moteur prenait les deux tons en paramètre ; ici on tire le second du premier,
    // ce qui garde le lambris cohérent avec la salle sans qu'on ait à le déclarer.
    let wood = base * vec3<f32>(0.52, 0.36, 0.24);

    if (h < 0.14) {
      // Plinthe : plus sombre, plus lisse.
      return wood * 0.72 + fine;
    }
    if (h < 1.0) {
      // Lambris : un panneau creux tous les quatre-vingt-dix centimètres, avec son biseau.
      let cell = fract(uv.x / 0.9);
      let innerX = smoothstep(0.10, 0.145, cell) * (1.0 - smoothstep(0.855, 0.90, cell));
      let innerY = smoothstep(0.20, 0.26, h) * (1.0 - smoothstep(0.88, 0.94, h));
      let recess = innerX * innerY;
      let vein = 0.88 + 0.24 * fbm(vec2<f32>(uv.x * 3.0 + 11.0, h * 26.0));
      let bevel = 0.20 * (1.0 - smoothstep(0.20, 0.30, h)) - 0.18 * smoothstep(0.84, 0.94, h);
      return wood * vein * (mix(1.0, 0.80, recess) + bevel * recess) + fine;
    }
    if (h < 1.06) {
      // Chapeau du lambris : arête claire, puis ombre.
      let t = (h - 1.0) / 0.06;
      return wood * (1.25 - 0.55 * t) + fine;
    }

    // Plâtre, sali très légèrement vers le bas, et la cimaise à deux mètres vingt.
    let dirt = 1.0 - 0.10 * (1.0 - smoothstep(1.06, 2.2, h));
    let mottle = 0.94 + 0.12 * fbm(vec2<f32>(uv.x * 6.0, h * 6.0));
    var k = base * mottle * dirt;
    let d = abs(h - 2.2);
    if (d < 0.018) {
      k = mix(k, wood * 1.25, 1.0 - d / 0.018);
    } else if (h > 2.2 && h < 2.26) {
      k *= 1.0 - 0.22 * (1.0 - (h - 2.218) / 0.042);
    }
    return k + fine;
  }

  // 5 — Pierre de taille en appareil régulier. Une assise sur deux décalée d'un demi-bloc,
  // des joints creux, et **une arête éclairée juste sous le joint horizontal** : c'est elle
  // qui donne le relief, le joint seul ne ferait qu'un dessin.
  if (m == 5) {
    let ROW = 0.55;
    let BLOCK = 1.1;
    let ry = uv.y / ROW;
    let row = floor(ry);
    let fy = ry - row;
    let offset = select(0.5, 0.0, (i32(row) % 2) == 0);
    let rx = uv.x / BLOCK + offset;
    let col = floor(rx);
    let fx = rx - col;

    let tone = 0.90 + 0.16 * hash2(col, row);
    let n = fbm(vec2<f32>(uv.x * 8.0 + col * 3.0, uv.y * 16.0));
    var k = tone * (0.92 + 0.16 * n);

    let jx = (0.5 - abs(fx - 0.5)) * 2.0;
    let jy = (0.5 - abs(fy - 0.5)) * 2.0;
    let joint = max(1.0 - smoothstep(0.0, 0.055, jx), 1.0 - smoothstep(0.0, 0.10, jy));
    k = mix(k, k * 0.52, joint);
    if (fy < 0.12) {
      k *= 1.0 + 0.10 * (1.0 - fy / 0.12);
    }
    return base * k + fine;
  }

  // 6 — Plafond à caissons : un cadre plat, une gorge, un fond en retrait, et l'ombre portée
  // sur deux côtés seulement. Le relief est feint, mais il tient parce qu'il est éclairé
  // toujours du même côté.
  if (m == 6) {
    let cell = fract(uv / 1.2);
    let e = min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y));
    let inner = smoothstep(0.09, 0.13, e);
    let depth = mix(1.06, 0.86, inner);
    let shade = 0.14 * (1.0 - smoothstep(0.09, 0.15, min(cell.x, cell.y)));
    let n = 0.97 + 0.06 * fbm(uv * 6.0);
    return base * (depth * n - shade) + fine;
  }

  // 7 — Béton banché. La trace des planches de coffrage tous les vingt-cinq centimètres, les
  // trous de banche en grille, et des coulures. La matière de la direction artistique du
  // musée : brute, monumentale, sans ornement.
  if (m == 7) {
    let board = floor(uv.y / 0.25);
    let tone = 0.94 + 0.08 * hash2(board, 3.0);
    let mottle = 0.92 + 0.14 * fbm(uv * 1.6) + 0.05 * fbm(uv * 9.0);
    let seam = groove(uv.y, 0.25, 0.005, blur.y);
    let lip = 1.0 + 0.06 * (1.0 - smoothstep(0.0, 0.04, fract(uv.y / 0.25) * 0.25));
    let hole = fract(uv / 1.5) - vec2<f32>(0.5);
    let tie = 1.0 - smoothstep(0.010, 0.017, length(hole) * 1.5);
    return base * tone * mottle * lip * (1.0 - 0.16 * seam) * (1.0 - 0.45 * tie) + fine;
  }

  // 8 — Tôle rivetée. Des panneaux de deux mètres sur un, leurs rivets le long des joints, et
  // le brossé du métal. C'est la file des rivets qui dit « métal », pas le grain.
  if (m == 8) {
    let CELL = vec2<f32>(2.0, 1.0);
    let panel = floor(uv / CELL);
    let tone = 0.84 + 0.24 * hash2(panel.x, panel.y);
    let brushed = 0.94 + 0.14 * fbm(vec2<f32>(uv.x * 70.0, uv.y * 2.0));
    let inner = abs(fract(uv / CELL) - vec2<f32>(0.5)) * 2.0;
    let seam = smoothstep(0.9, 0.985, max(inner.x, inner.y));
    let stud = fract(uv / vec2<f32>(0.25, 1.0)) - vec2<f32>(0.5);
    let rivet = (1.0 - smoothstep(0.14, 0.24, abs(stud.x))) * smoothstep(0.78, 0.9, inner.y);
    return base * tone * brushed * (1.0 - 0.45 * seam) * (1.0 + 0.3 * rivet) + fine;
  }

  // 9 — Plâtre tendu, avec un filet de rive discret. Un aplat parfaitement uni fait un trou
  // blanc au-dessus de la tête ; le filet donne au regard une trame à laquelle s'accrocher.
  if (m == 9) {
    let n = 0.97 + 0.05 * fbm(uv * 1.6);
    let fillet = groove(uv.x, 2.4, 0.006, blur.x) + groove(uv.y, 2.4, 0.006, blur.y);
    return base * n * (1.0 - 0.06 * clamp(fillet, 0.0, 1.0)) + fine;
  }

  // 10 — Verrière : verre dépoli entre meneaux d'acier. Deux meneaux par carreau seulement,
  // et fins — une grille dense fait un plafond d'usine, pas une verrière.
  if (m == 10) {
    let pane = fract(uv / 1.2);
    let bar = max(
      1.0 - smoothstep(0.0, 0.022, min(pane.x, 1.0 - pane.x)),
      1.0 - smoothstep(0.0, 0.022, min(pane.y, 1.0 - pane.y)),
    );
    let glow = 0.94 + 0.10 * (1.0 - abs(pane.x - 0.5) * 2.0) * (1.0 - abs(pane.y - 0.5) * 2.0);
    let frost = 0.96 + 0.07 * fbm(uv * 10.0);
    return mix(base * frost * glow, vec3<f32>(0.52, 0.51, 0.50), bar);
  }

  // 0 — Neutre : le quadrillage d'un mètre, qui est un outil de mise au point avant d'être un
  // décor. Sans repère régulier, impossible de juger à l'œil si l'image vue à travers une
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
