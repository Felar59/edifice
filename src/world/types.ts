import type { F32 } from '../f32'
import type { Mat4 } from '../math/mat4'
import type { Vec3 } from '../math/vec3'
import type { CellLighting, Colour } from './light'

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
  /**
   * Lumière que cette ouverture déverse dans `from.cell`, en provenance de
   * `to.cell` : c'est ainsi que l'éclairage traverse une couture.
   *
   * Ne compte que l'éclairage **direct** de la pièce d'en face — ses lampes et son
   * ambiance, pas ce que ses propres ouvertures lui apportent. Sans cette coupure,
   * deux salles reliées se renverraient la lumière indéfiniment.
   */
  radiance: Colour
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
  /** Lampes et ambiance propres à la cellule. */
  lighting: CellLighting
}

export interface World {
  cells: Map<string, Cell>
}
