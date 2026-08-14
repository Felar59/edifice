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
  /**
   * Ouvertures à percer, disjointes horizontalement.
   *
   * Plusieurs, désormais : la rotonde a deux portes sur la même paroi, et s'en tenir
   * à une seule aurait imposé une pièce centrale à quatre ailes au maximum.
   */
  holes?: Hole[]
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

/**
 * Une paroi, éventuellement percée de plusieurs ouvertures.
 *
 * Le découpage est celui qu'on ferait à la main sur un plan : des bandes pleine
 * hauteur entre les ouvertures, puis pour chacune le morceau au-dessus et celui en
 * dessous. Cela suppose les ouvertures **disjointes horizontalement**, ce qui est le
 * cas de deux portes sur un même mur ; le contraire est refusé bruyamment plutôt que
 * dessiné de travers.
 */
export function pushWall(out: number[], spec: WallSpec): void {
  const holes = spec.holes ?? []
  if (holes.length === 0) {
    pushSubQuad(out, spec, 0, 1, 0, 1)
    return
  }

  const wRight = len(spec.right)
  const wUp = len(spec.up)
  const dirR = scale(spec.right, 1 / wRight)
  const dirU = scale(spec.up, 1 / wUp)

  // Chaque ouverture, ramenée aux coordonnées paramétriques de la paroi.
  const spans = holes
    .map((hole) => {
      const rel = sub(hole.center, spec.origin)
      const cs = (rel.x * dirR.x + rel.y * dirR.y + rel.z * dirR.z) / wRight
      const ct = (rel.x * dirU.x + rel.y * dirU.y + rel.z * dirU.z) / wUp
      return {
        s0: Math.max(0, cs - hole.halfWidth / wRight),
        s1: Math.min(1, cs + hole.halfWidth / wRight),
        t0: Math.max(0, ct - hole.halfHeight / wUp),
        t1: Math.min(1, ct + hole.halfHeight / wUp),
      }
    })
    .sort((a, b) => a.s0 - b.s0)

  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.s0 < spans[i - 1]!.s1) {
      throw new Error(
        'ouvertures qui se chevauchent sur une même paroi : le découpage en bandes ne ' +
          'sait pas les traiter',
      )
    }
  }

  let cursor = 0
  for (const span of spans) {
    pushSubQuad(out, spec, cursor, span.s0, 0, 1)   // bande pleine hauteur avant
    pushSubQuad(out, spec, span.s0, span.s1, 0, span.t0)  // sous l'ouverture
    pushSubQuad(out, spec, span.s0, span.s1, span.t1, 1)  // au-dessus
    cursor = span.s1
  }
  pushSubQuad(out, spec, cursor, 1, 0, 1)           // bande pleine hauteur après
}

export interface RoomHoles {
  /** Ouvertures sur la paroi z = min.z (normale intérieure +Z). */
  north?: Hole[]
  /** Ouvertures sur la paroi z = max.z (normale intérieure -Z). */
  south?: Hole[]
  /** Ouvertures sur la paroi x = min.x (normale intérieure +X). */
  west?: Hole[]
  /** Ouvertures sur la paroi x = max.x (normale intérieure -X). */
  east?: Hole[]
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
    ...(holes.north ? { holes: holes.north } : {}),
  })
  // Paroi sud (z = max.z), normale -Z : right = -X, up = +Y.
  pushWall(out, {
    origin: { x: max.x, y: min.y, z: max.z },
    right: { x: -dx, y: 0, z: 0 },
    up: { x: 0, y: dy, z: 0 },
    color: pal.wall,
    ...(holes.south ? { holes: holes.south } : {}),
  })
  // Paroi ouest (x = min.x), normale +X : right = -Z, up = +Y.
  pushWall(out, {
    origin: { x: min.x, y: min.y, z: max.z },
    right: { x: 0, y: 0, z: -dz },
    up: { x: 0, y: dy, z: 0 },
    color: pal.wall,
    ...(holes.west ? { holes: holes.west } : {}),
  })
  // Paroi est (x = max.x), normale -X : right = +Z, up = +Y.
  pushWall(out, {
    origin: { x: max.x, y: min.y, z: min.z },
    right: { x: 0, y: 0, z: dz },
    up: { x: 0, y: dy, z: 0 },
    color: pal.wall,
    ...(holes.east ? { holes: holes.east } : {}),
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
