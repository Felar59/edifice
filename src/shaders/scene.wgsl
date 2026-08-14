struct Uniforms {
  viewProj : mat4x4<f32>,
  model    : mat4x4<f32>,
  camPos   : vec4<f32>,
  fog      : vec4<f32>,   // rgb = couleur du fond, a = densité
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world  : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
  @location(3) color  : vec3<f32>,
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
  out.normal = (u.model * vec4<f32>(nrm, 0.0)).xyz;
  out.uv = uv;
  out.color = col;
  return out;
}

const LIGHT_DIR = vec3<f32>(0.35, 0.86, 0.37);

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let toEye = u.camPos.xyz - in.world;
  let dist = length(toEye);

  // Éclairage deux faces : les parois sont des quads sans épaisseur, on ne veut
  // pas d'une face noire selon le côté d'où on la regarde.
  var n = normalize(in.normal);
  if (dot(n, toEye) < 0.0) { n = -n; }

  let diffuse = max(dot(n, normalize(LIGHT_DIR)), 0.0);
  let ambient = 0.34 + 0.16 * n.y;
  var rgb = in.color * (ambient + 0.66 * diffuse);

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
