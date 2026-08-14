import type { F32 } from '../f32'
import type { Mat4 } from '../math/mat4'
import type { Vec3 } from '../math/vec3'

/**
 * Une **bouche** de couture : une ouverture rectangulaire posée sur une paroi.
 *
 * `right`, `up` et `normal` forment un repère orthonormé direct
 * (`normal = right × up`). `normal` pointe **vers l'intérieur** de la cellule,
 * c'est-à-dire vers celui qui regarde l'ouverture depuis la pièce.
 */
export interface Mouth {
  /** Nom court et unique, pour que les diagnostics désignent la bonne bouche. */
  id: string
  /** Cellule dans laquelle cette bouche s'ouvre. */
  cell: string
  center: Vec3
  right: Vec3
  up: Vec3
  normal: Vec3
  halfWidth: number
  halfHeight: number
}

/**
 * Une **couture** vue depuis une de ses deux faces : la traversée d'ici vers
 * là-bas, avec la transformation qui va avec.
 *
 * Les deux faces d'une même couture donnent deux `Passage`, inverses l'un de
 * l'autre. C'est cette structure que le rendu et le déplacement consultent.
 */
export interface Passage {
  from: Mouth
  to: Mouth
  /** Transformation rigide de l'espace de `from.cell` vers celui de `to.cell`. */
  transform: Mat4
}

export interface Cell {
  id: string
  /** Boîte englobante intérieure, utilisée pour la collision de l'étape 1. */
  min: Vec3
  max: Vec3
  /** Sommets entrelacés, voir `FLOATS_PER_VERTEX`. */
  verts: F32
  /** Les passages qui partent de cette cellule. */
  passages: Passage[]
}

export interface World {
  cells: Map<string, Cell>
}
