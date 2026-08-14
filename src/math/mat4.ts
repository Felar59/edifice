/**
 * Matrices 4×4, stockage colonne par colonne (l'ordre attendu par WGSL).
 * L'élément (ligne r, colonne c) est à l'indice c * 4 + r.
 *
 * Convention de l'espace de vue : main droite, la caméra regarde vers -Z.
 * Convention de l'espace de clip WebGPU : x, y ∈ [-1, 1] et **z ∈ [0, 1]**.
 * Ce dernier point est ce qui distingue le calcul du plan proche oblique
 * ci-dessous de la version OpenGL qu'on trouve partout.
 */

import type { F32 } from '../f32'
import type { Vec3 } from './vec3'

export type Mat4 = F32

export function create(): Mat4 {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

/** out = a · b */
export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4 + 0]!
    const b1 = b[c * 4 + 1]!
    const b2 = b[c * 4 + 2]!
    const b3 = b[c * 4 + 3]!
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r]! * b0 + a[1 * 4 + r]! * b1 + a[2 * 4 + r]! * b2 + a[3 * 4 + r]! * b3
    }
  }
  return out
}

/**
 * Repère orthonormé : les trois axes en colonnes, l'origine en quatrième.
 * C'est la forme sous laquelle on décrit une bouche de couture, et c'est ce qui
 * rend le calcul de la transformation entre deux coutures immédiat.
 */
export function fromBasis(out: Mat4, right: Vec3, up: Vec3, fwd: Vec3, pos: Vec3): Mat4 {
  out[0] = right.x; out[1] = right.y; out[2] = right.z; out[3] = 0
  out[4] = up.x;    out[5] = up.y;    out[6] = up.z;    out[7] = 0
  out[8] = fwd.x;   out[9] = fwd.y;   out[10] = fwd.z;  out[11] = 0
  out[12] = pos.x;  out[13] = pos.y;  out[14] = pos.z;  out[15] = 1
  return out
}

/**
 * Inverse d'une transformation rigide (rotation orthonormée + translation).
 * Exact et sans division — toutes les matrices que ce moteur inverse sont
 * rigides, donc l'inverse général n'a pas lieu d'être.
 */
export function invertRigid(out: Mat4, m: Mat4): Mat4 {
  // Transposée de la partie rotation.
  out[0] = m[0]!; out[1] = m[4]!; out[2] = m[8]!;  out[3] = 0
  out[4] = m[1]!; out[5] = m[5]!; out[6] = m[9]!;  out[7] = 0
  out[8] = m[2]!; out[9] = m[6]!; out[10] = m[10]!; out[11] = 0
  // -Rᵀ · t
  const tx = m[12]!, ty = m[13]!, tz = m[14]!
  out[12] = -(out[0]! * tx + out[4]! * ty + out[8]! * tz)
  out[13] = -(out[1]! * tx + out[5]! * ty + out[9]! * tz)
  out[14] = -(out[2]! * tx + out[6]! * ty + out[10]! * tz)
  out[15] = 1
  return out
}

/** Applique la transformation complète (rotation + translation) à un point. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return {
    x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
    y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
    z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
  }
}

/** N'applique que la rotation — pour les directions, les vitesses, les normales. */
export function transformDir(m: Mat4, v: Vec3): Vec3 {
  return {
    x: m[0]! * v.x + m[4]! * v.y + m[8]! * v.z,
    y: m[1]! * v.x + m[5]! * v.y + m[9]! * v.z,
    z: m[2]! * v.x + m[6]! * v.y + m[10]! * v.z,
  }
}

/** Translation extraite de la quatrième colonne. */
export function origin(m: Mat4): Vec3 {
  return { x: m[12]!, y: m[13]!, z: m[14]! }
}

/** Projection perspective pour WebGPU (z de clip dans [0, 1]). */
export function perspective(out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = far / (near - far)
  out[11] = -1
  out[14] = (far * near) / (near - far)
  return out
}

export function copy(out: Mat4, m: Mat4): Mat4 {
  out.set(m)
  return out
}

/**
 * Plan proche oblique — le détail qui sépare un portail correct d'un portail
 * amateur.
 *
 * Quand on approche le visage d'une couture, la caméra virtuelle de l'autre côté
 * se retrouve *devant* le mur qui contient la bouche de sortie : sans
 * précaution, on voit apparaître une tranche de ce mur, et l'illusion tombe.
 * La parade est de remplacer le plan proche de la projection par le plan de la
 * couture, en biais.
 *
 * `plane` est donné dans l'espace de vue de la caméra virtuelle, sous la forme
 * (a, b, c, d) avec la convention : le demi-espace conservé est celui où
 * a·x + b·y + c·z + d ≥ 0.
 *
 * Adapté de la méthode d'Eric Lengyel, corrigée pour un z de clip dans [0, 1] :
 * la version OpenGL qui circule partout suppose [-1, 1] et produit un plan
 * proche décalé si on la recopie telle quelle.
 */
export function obliqueNear(
  out: Mat4,
  proj: Mat4,
  plane: { x: number; y: number; z: number; w: number },
): Mat4 {
  copy(out, proj)

  // Coin du frustum le plus opposé au plan de coupe, en espace de vue.
  const qx = (Math.sign(plane.x) + proj[8]!) / proj[0]!
  const qy = (Math.sign(plane.y) + proj[9]!) / proj[5]!
  const qz = -1
  const qw = (1 + proj[10]!) / proj[14]!

  const d = plane.x * qx + plane.y * qy + plane.z * qz + plane.w * qw

  // Plan quasi parallèle à la direction du coin : la mise à l'échelle
  // exploserait. On garde la projection intacte, ce qui est le comportement
  // sûr — mieux vaut un plan proche standard qu'une matrice dégénérée.
  if (Math.abs(d) < 1e-6) return out

  const k = 1 / d
  // Troisième ligne de la matrice = k · plan. La bouche de la couture devient
  // ainsi exactement z = 0, c'est-à-dire le plan proche.
  out[2] = plane.x * k
  out[6] = plane.y * k
  out[10] = plane.z * k
  out[14] = plane.w * k
  return out
}
