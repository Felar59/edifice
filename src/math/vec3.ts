/** Vecteurs 3D. Objets simples et lisibles : à cette échelle, le coût est nul. */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z })

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export function normalize(a: Vec3): Vec3 {
  const l = len(a)
  return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 }
}

/** Rotation de `a` autour d'un axe unitaire, formule de Rodrigues. */
export function rotateAxis(a: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const d = dot(axis, a)
  const cr = cross(axis, a)
  return {
    x: a.x * c + cr.x * s + axis.x * d * (1 - c),
    y: a.y * c + cr.y * s + axis.y * d * (1 - c),
    z: a.z * c + cr.z * s + axis.z * d * (1 - c),
  }
}
