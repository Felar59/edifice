/**
 * Avancer dans un espace cousu.
 *
 * Le déplacement ne peut pas être appliqué d'un bloc : sur une seule image, un
 * corps peut franchir une couture, ressortir dans une autre cellule, y glisser
 * contre un mur, et éventuellement franchir une **seconde** couture. On découpe
 * donc le pas en sous-pas courts, et à chaque sous-pas on regarde d'abord si le
 * segment traverse une bouche, avant de résoudre la collision.
 *
 * L'ordre compte : tester la traversée **avant** la collision. Dans l'autre sens,
 * le mur qui contient l'ouverture arrêterait le corps juste avant le plan de la
 * couture, et on ne franchirait jamais rien.
 */

import { transformDir, transformPoint } from '../math/mat4'
import { add, dot, len, scale, sub, type Vec3 } from '../math/vec3'
import type { Cell, Mouth, Passage, World } from './types'

/** Longueur maximale d'un sous-pas, en mètres. */
const SUBSTEP = 0.04
/** Combien on pousse le corps au-delà du plan, pour ne pas rester pile dessus. */
const NUDGE = 1e-3
/**
 * Épaisseur autour du plan d'une bouche dans laquelle on refuse de s'arrêter.
 *
 * Pile dans le plan d'une ouverture, celle-ci est vue par la tranche : son
 * quadrilatère a une surface projetée nulle, donc rien à dessiner, alors que la
 * bonne image serait la pièce d'en face occupant tout le champ. Le cas est
 * géométriquement dégénéré et ne se répare pas — il se rend **inatteignable**.
 *
 * On franchit donc dès qu'un pas *arrive* à moins de un dixième de millimètre du
 * plan, sans attendre de l'avoir dépassé. Le décalage appliqué ensuite étant dix
 * fois plus grand, on ressort toujours franchement du bon côté.
 *
 * C'était un vrai défaut, et rare : un pas qui tombait pile sur le plan laissait le
 * corps dans sa cellule de départ, sans portail dessiné, donc devant un aplat gris.
 */
const PLANE_EPS = 1e-4
const MAX_ITERATIONS = 96

export interface Advance {
  cell: string
  pos: Vec3
  crossings: number
}

interface Crossing {
  passage: Passage
  t: number
}

/**
 * Première bouche traversée par le segment `from → from + seg`, s'il y en a une.
 *
 * Une bouche ne se franchit que dans un sens — du côté visible vers le côté caché.
 * L'autre sens est assuré par la bouche jumelle, qui est un passage distinct.
 */
function findCrossing(cell: Cell, from: Vec3, seg: Vec3): Crossing | null {
  let best: Crossing | null = null
  const to = add(from, seg)

  for (const passage of cell.passages) {
    const m = passage.from
    const d0 = dot(m.normal, sub(from, m.center))
    const d1 = dot(m.normal, sub(to, m.center))
    // On part du côté visible, et on arrive au plan ou au-delà.
    if (d0 <= PLANE_EPS || d1 > PLANE_EPS) continue

    const denom = d0 - d1
    if (denom < 1e-9) continue
    // Le paramètre visé est le plan lui-même, pas le seuil de déclenchement : borné
    // à un, puisque le pas peut s'arrêter juste avant de l'atteindre.
    const t = Math.min(1, d0 / denom)

    // Le point d'impact doit tomber **dans** l'ouverture, pas sur la paroi.
    const rel = sub(add(from, scale(seg, t)), m.center)
    if (Math.abs(dot(rel, m.right)) > m.halfWidth) continue
    if (Math.abs(dot(rel, m.up)) > m.halfHeight) continue

    if (!best || t < best.t) best = { passage, t }
  }
  return best
}

/**
 * Applique un déplacement, en franchissant autant de coutures qu'il le faut.
 *
 * `carried` contient les vecteurs à transporter d'un repère à l'autre — la
 * direction du regard, la verticale locale, la vitesse. Ils sont **modifiés sur
 * place** : oublier d'en transporter un se voit immédiatement, puisqu'on ressort
 * d'une couture en regardant dans la mauvaise direction.
 */
export function advance(
  world: World,
  cellId: string,
  pos: Vec3,
  delta: Vec3,
  carried: Vec3[],
  resolve: (cell: Cell, p: Vec3) => Vec3,
): Advance {
  let cell = world.cells.get(cellId)
  if (!cell) throw new Error(`Cellule inconnue : ${cellId}`)

  let current = pos
  let remaining = delta
  let crossings = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const total = len(remaining)
    if (total < 1e-7) break

    const stepLen = Math.min(total, SUBSTEP)
    const seg = scale(remaining, stepLen / total)

    const hit = findCrossing(cell, current, seg)
    if (hit) {
      const t = hit.passage.transform
      const impact = add(current, scale(seg, hit.t))

      // Le corps ressort **dans** la cellule de destination, à un millimètre du
      // plan : rester exactement dessus rendrait le prochain test ambigu.
      current = add(transformPoint(t, impact), scale(hit.passage.to.normal, NUDGE))

      for (let k = 0; k < carried.length; k++) carried[k] = transformDir(t, carried[k]!)

      // Ce qui restait du sous-pas, plus tout le reste, exprimé dans le nouveau repère.
      const leftover = add(scale(seg, 1 - hit.t), sub(remaining, seg))
      remaining = transformDir(t, leftover)

      const next = world.cells.get(hit.passage.to.cell)
      if (!next) throw new Error(`Cellule de destination inconnue : ${hit.passage.to.cell}`)
      cell = next
      crossings++
      continue
    }

    current = resolve(cell, add(current, seg))
    remaining = sub(remaining, seg)
  }

  return { cell: cell.id, pos: current, crossings }
}

/**
 * Collision contre la boîte de la cellule, avec une exception devant chaque
 * ouverture — sans quoi la paroi qui contient la porte arrêterait net celui qui
 * cherche à la franchir.
 *
 * L'exception n'est accordée que si le corps est réellement **en face** de
 * l'ouverture, à sa demi-largeur moins le rayon près : on ne passe pas en
 * écorchant le montant.
 */
export function resolveAgainstCell(cell: Cell, p: Vec3, radius: number): Vec3 {
  let clampMinX = true
  let clampMaxX = true
  let clampMinZ = true
  let clampMaxZ = true

  for (const passage of cell.passages) {
    const m = passage.from
    if (Math.abs(m.normal.x) > 0.5) {
      if (Math.abs(p.z - m.center.z) <= m.halfWidth - radius) {
        if (m.normal.x > 0) clampMinX = false
        else clampMaxX = false
      }
    } else if (Math.abs(m.normal.z) > 0.5) {
      if (Math.abs(p.x - m.center.x) <= m.halfWidth - radius) {
        if (m.normal.z > 0) clampMinZ = false
        else clampMaxZ = false
      }
    }
  }

  // Filet de sécurité : même dans l'embrasure, on ne s'éloigne pas indéfiniment
  // de la cellule. Si la traversée échouait, le corps s'arrêterait au lieu de
  // partir dans le vide — un bug visible vaut mieux qu'un bug silencieux.
  const slack = 1.2
  let { x, z } = p
  x = Math.max(x, cell.min.x + (clampMinX ? radius : -slack))
  x = Math.min(x, cell.max.x - (clampMaxX ? radius : -slack))
  z = Math.max(z, cell.min.z + (clampMinZ ? radius : -slack))
  z = Math.min(z, cell.max.z - (clampMaxZ ? radius : -slack))

  // Une fois engagé dans une embrasure, on y reste : sans cette contrainte on
  // pourrait glisser latéralement et se retrouver dans l'épaisseur de la paroi,
  // là où il n'y a rien à voir.
  //
  // Encore faut-il savoir **de laquelle** il s'agit. Une première version appliquait
  // la contrainte de chaque bouche à la suite, ce qui allait tant qu'une paroi n'en
  // portait qu'une. Dès que la rotonde a eu deux portes sur le même mur, le corps
  // engagé dans la première se faisait happer devant la seconde : on partait vers une
  // aile et on arrivait dans une autre. On retient donc, par paroi, la bouche dont on
  // est le plus proche.
  const engage = (
    beyond: boolean,
    onThisFace: (m: Mouth) => boolean,
    lateralOf: (m: Mouth) => number,
    current: number,
  ): number => {
    if (!beyond) return current

    let nearest: Mouth | null = null
    let smallestGap = Infinity
    for (const passage of cell.passages) {
      const m = passage.from
      if (!onThisFace(m)) continue
      const gap = Math.abs(current - lateralOf(m))
      if (gap < smallestGap) {
        smallestGap = gap
        nearest = m
      }
    }
    if (!nearest) return current

    const limit = nearest.halfWidth - radius
    const centre = lateralOf(nearest)
    return Math.min(Math.max(current, centre - limit), centre + limit)
  }

  z = engage(x < cell.min.x, (m) => m.normal.x > 0.5, (m) => m.center.z, z)
  z = engage(x > cell.max.x, (m) => m.normal.x < -0.5, (m) => m.center.z, z)
  x = engage(z < cell.min.z, (m) => m.normal.z > 0.5, (m) => m.center.x, x)
  x = engage(z > cell.max.z, (m) => m.normal.z < -0.5, (m) => m.center.x, x)

  return { x, y: p.y, z }
}
