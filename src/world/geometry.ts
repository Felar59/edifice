/**
 * Construction des maillages de cellules.
 *
 * Rien de sophistiqué : des quads axés, avec la possibilité de percer une paroi
 * d'une ouverture rectangulaire. Le trou est un vrai trou dans la géométrie —
 * poser le quad du portail par-dessus le mur donnerait un conflit de profondeur,
 * et c'est précisément le genre de scintillement qui tue l'illusion.
 */

import type { F32 } from '../f32'
import { add, cross, len, normalize, scale, sub, type Vec3 } from '../math/vec3'

/** position (3) · normale (3) · uv (2) · couleur (3) */
export const FLOATS_PER_VERTEX = 11

export type Color = readonly [number, number, number]

export interface Hole {
  center: Vec3
  halfWidth: number
  halfHeight: number
}

export interface WallSpec {
  /** Coin de la paroi. */
  origin: Vec3
  /** Arête « horizontale » complète (longueur = largeur de la paroi). */
  right: Vec3
  /** Arête « verticale » complète. */
  up: Vec3
  color: Color
  /** Au plus une ouverture par paroi — c'est tout ce dont ce prototype a besoin. */
  hole?: Hole
}

/**
 * Un morceau de paroi, décrit en coordonnées paramétriques (s, t) ∈ [0,1]²
 * sur la paroi complète. Les uv sont exprimés en **unités du monde** pour que
 * le quadrillage du nuanceur reste continu d'un morceau à l'autre.
 */
function pushSubQuad(
  out: number[],
  spec: WallSpec,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
): void {
  const wRight = len(spec.right)
  const wUp = len(spec.up)
  if ((s1 - s0) * wRight < 1e-4 || (t1 - t0) * wUp < 1e-4) return // morceau dégénéré

  const n = normalize(cross(spec.right, spec.up))
  const corner = (s: number, t: number): Vec3 =>
    add(add(spec.origin, scale(spec.right, s)), scale(spec.up, t))

  const p00 = corner(s0, t0)
  const p10 = corner(s1, t0)
  const p11 = corner(s1, t1)
  const p01 = corner(s0, t1)

  const u0 = s0 * wRight
  const u1 = s1 * wRight
  const v0 = t0 * wUp
  const v1 = t1 * wUp

  const [r, g, b] = spec.color
  const push = (p: Vec3, u: number, v: number): void => {
    out.push(p.x, p.y, p.z, n.x, n.y, n.z, u, v, r, g, b)
  }

  push(p00, u0, v0); push(p10, u1, v0); push(p11, u1, v1)
  push(p00, u0, v0); push(p11, u1, v1); push(p01, u0, v1)
}

/** Une paroi, éventuellement percée. */
export function pushWall(out: number[], spec: WallSpec): void {
  if (!spec.hole) {
    pushSubQuad(out, spec, 0, 1, 0, 1)
    return
  }

  // Projeter le centre de l'ouverture dans les coordonnées paramétriques.
  const wRight = len(spec.right)
  const wUp = len(spec.up)
  const dirR = scale(spec.right, 1 / wRight)
  const dirU = scale(spec.up, 1 / wUp)
  const rel = sub(spec.hole.center, spec.origin)
  const cs = (rel.x * dirR.x + rel.y * dirR.y + rel.z * dirR.z) / wRight
  const ct = (rel.x * dirU.x + rel.y * dirU.y + rel.z * dirU.z) / wUp
  const hs = spec.hole.halfWidth / wRight
  const ht = spec.hole.halfHeight / wUp

  const s0 = Math.max(0, cs - hs)
  const s1 = Math.min(1, cs + hs)
  const t0 = Math.max(0, ct - ht)
  const t1 = Math.min(1, ct + ht)

  pushSubQuad(out, spec, 0, 1, 0, t0)   // sous l'ouverture
  pushSubQuad(out, spec, 0, 1, t1, 1)   // au-dessus
  pushSubQuad(out, spec, 0, s0, t0, t1) // à gauche
  pushSubQuad(out, spec, s1, 1, t0, t1) // à droite
}

export interface RoomHoles {
  /** Ouverture sur la paroi z = min.z (normale intérieure +Z). */
  north?: Hole
  /** Ouverture sur la paroi z = max.z (normale intérieure -Z). */
  south?: Hole
  /** Ouverture sur la paroi x = min.x (normale intérieure +X). */
  west?: Hole
  /** Ouverture sur la paroi x = max.x (normale intérieure -X). */
  east?: Hole
}

export interface RoomPalette {
  floor: Color
  ceiling: Color
  wall: Color
}

/** Une pièce parallélépipédique vue de l'intérieur. */
export function buildRoom(min: Vec3, max: Vec3, pal: RoomPalette, holes: RoomHoles = {}): F32 {
  const out: number[] = []
  const dx = max.x - min.x
  const dy = max.y - min.y
  const dz = max.z - min.z

  // Sol : normale +Y, donc right × up = +Y avec right = +X et up = -Z.
  pushWall(out, {
    origin: { x: min.x, y: min.y, z: max.z },
    right: { x: dx, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -dz },
    color: pal.floor,
  })
  // Plafond : normale -Y.
  pushWall(out, {
    origin: { x: min.x, y: max.y, z: min.z },
    right: { x: dx, y: 0, z: 0 },
    up: { x: 0, y: 0, z: dz },
    color: pal.ceiling,
  })
  // Paroi nord (z = min.z), normale +Z : right = +X, up = +Y.
  pushWall(out, {
    origin: { x: min.x, y: min.y, z: min.z },
    right: { x: dx, y: 0, z: 0 },
    up: { x: 0, y: dy, z: 0 },
    color: pal.wall,
    ...(holes.north ? { hole: holes.north } : {}),
  })
  // Paroi sud (z = max.z), normale -Z : right = -X, up = +Y.
  pushWall(out, {
    origin: { x: max.x, y: min.y, z: max.z },
    right: { x: -dx, y: 0, z: 0 },
    up: { x: 0, y: dy, z: 0 },
    color: pal.wall,
    ...(holes.south ? { hole: holes.south } : {}),
  })
  // Paroi ouest (x = min.x), normale +X : right = -Z, up = +Y.
  pushWall(out, {
    origin: { x: min.x, y: min.y, z: max.z },
    right: { x: 0, y: 0, z: -dz },
    up: { x: 0, y: dy, z: 0 },
    color: pal.wall,
    ...(holes.west ? { hole: holes.west } : {}),
  })
  // Paroi est (x = max.x), normale -X : right = +Z, up = +Y.
  pushWall(out, {
    origin: { x: max.x, y: min.y, z: min.z },
    right: { x: 0, y: 0, z: dz },
    up: { x: 0, y: dy, z: 0 },
    color: pal.wall,
    ...(holes.east ? { hole: holes.east } : {}),
  })

  return new Float32Array(out)
}

/** Un cube centré sur l'origine, pour l'objet qu'on lance à travers la couture. */
export function buildCube(size: number, color: Color): F32 {
  const out: number[] = []
  const h = size / 2
  const faces: { o: Vec3; r: Vec3; u: Vec3 }[] = [
    { o: { x: -h, y: -h, z: h }, r: { x: size, y: 0, z: 0 }, u: { x: 0, y: size, z: 0 } },  // +Z
    { o: { x: h, y: -h, z: -h }, r: { x: -size, y: 0, z: 0 }, u: { x: 0, y: size, z: 0 } }, // -Z
    { o: { x: h, y: -h, z: h }, r: { x: 0, y: 0, z: -size }, u: { x: 0, y: size, z: 0 } },  // +X
    { o: { x: -h, y: -h, z: -h }, r: { x: 0, y: 0, z: size }, u: { x: 0, y: size, z: 0 } }, // -X
    { o: { x: -h, y: h, z: h }, r: { x: size, y: 0, z: 0 }, u: { x: 0, y: 0, z: -size } },  // +Y
    { o: { x: -h, y: -h, z: -h }, r: { x: size, y: 0, z: 0 }, u: { x: 0, y: 0, z: size } }, // -Y
  ]
  for (const f of faces) pushWall(out, { origin: f.o, right: f.r, up: f.u, color })
  return new Float32Array(out)
}
