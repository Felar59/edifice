import type { F32 } from '../f32'
import type { Mat4 } from '../math/mat4'
import type { Vec3 } from '../math/vec3'
import type { CellLighting, Colour } from './light'
import type { Twist } from './twist'

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

/**
 * Un **bloc plein** posé dans une cellule : de la matière, là où il n'y en avait pas.
 *
 * Jusqu'ici un corps savait rester dans une boîte ; il ne savait pas en contourner une.
 * C'est ce qui manquait pour poser quoi que ce soit au milieu d'une salle — un coffre,
 * un pilier, et plus tard une cloison qui coulisse.
 *
 * `door` est la bouche percée dans une de ses faces, s'il y en a une. Elle est retenue
 * ici en plus de vivre dans les passages de la cellule, parce que la collision a deux
 * questions distinctes à lui poser : « cette ouverture perce-t-elle une paroi de la
 * pièce ? » — non — et « laisse-t-elle entrer dans ce bloc ? » — oui.
 */
export interface Block {
  min: Vec3
  max: Vec3
  door?: Mouth
}

export interface Cell {
  id: string
  /** Boîte englobante intérieure, utilisée pour la collision de l'étape 1. */
  min: Vec3
  max: Vec3
  /** Ce qui est plein à l'intérieur, et qu'il faut contourner. */
  blocks?: Block[]
  /** Sommets entrelacés, voir `FLOATS_PER_VERTEX`. */
  verts: F32
  /** Les passages qui partent de cette cellule. */
  passages: Passage[]
  /** Lampes et ambiance propres à la cellule. */
  lighting: CellLighting
  /**
   * Si la cellule est un tube vrillé, sa description.
   *
   * Sa présence change deux choses : la collision se fait dans le repère redressé, et
   * les directions attachées au visiteur tournent au fil de sa progression le long de
   * l'axe.
   */
  twist?: Twist
}

export interface World {
  cells: Map<string, Cell>
}
