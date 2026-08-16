/**
 * Un rayon dans un espace cousu.
 *
 * C'est le pendant du déplacement, pour le regard. Le visiteur avance en sous-pas de quatre
 * centimètres parce que la collision est une correction de position — on avance, on regarde
 * si l'on est entré dans quelque chose, on ressort. Un rayon n'a pas ce problème : une
 * cellule est une boîte, un bloc est une boîte, une bouche est un rectangle, et tout cela se
 * résout **exactement**, d'un coup, par intersection. Marcher le rayon serait à la fois plus
 * lent et moins juste — un pas de quatre centimètres rate un chambranle sur deux.
 *
 * La couture ne demande rien de particulier, et c'est encore une fois la promesse du modèle
 * qui tient : quand le rayon rencontre une ouverture avant de rencontrer un mur, on
 * transforme son origine et sa direction, on change de cellule, et l'on recommence. La
 * longueur, elle, s'accumule d'un bout à l'autre — c'est une vraie distance, et c'est ce qui
 * permettra de dire « trop loin pour l'atteindre » sans mentir.
 *
 * ## À quoi cela sert
 *
 * À toucher. Rien dans le musée ne peut être visé, pressé, ramassé ni allumé sans cela : les
 * onze machines sont toutes derrière ce verrou. Le premier usage est le plus modeste — savoir
 * ce qu'on regarde, et à quelle distance — mais c'est le même code qui servira à poser la
 * main sur un clavier de terminal à travers deux portes.
 *
 * ## Les deux salles qui ne sont pas leur boîte
 *
 * Le tunnel-vrille, dont la section tourne, et l'escalier, dont le sol monte : leurs parois
 * ne sont nulle part dans leurs bornes, et une intersection analytique n'a rien à mordre. On
 * y **marche** donc le rayon, par pas de cinq centimètres, en demandant à chaque échantillon
 * s'il est encore dedans — puis on affine par dichotomie, une douzaine de fois, ce qui ramène
 * l'erreur à quelques microns. C'est le seul endroit où l'on procède par tâtonnement, et
 * c'était le prix à payer pour que le rayon ne mente nulle part : un rayon qui traverse un
 * mur sans le voir est pire qu'un rayon qui s'arrête trop tôt, puisqu'il désigne une salle
 * qu'on ne peut pas atteindre.
 */

import { transformDir, transformPoint } from '../math/mat4'
import { add, dot, len, normalize, scale, sub, type Vec3 } from '../math/vec3'
import { ceilingHeight, rampHeight } from './spiral'
import { frameAt, toLocal } from './twist'
import type { Block, Cell, Mouth, World } from './types'

/** Ce que le rayon a rencontré. */
export interface RayHit {
  /** La cellule où se trouve le point touché — pas forcément celle d'où l'on a tiré. */
  cell: string
  point: Vec3
  /** La normale de la surface, tournée vers le rayon. */
  normal: Vec3
  /** La longueur du trajet, coutures comprises. */
  distance: number
  crossings: number
  /** Le bloc touché, si c'en est un et non une paroi. */
  block?: Block
}

/**
 * Au-delà, on renonce.
 *
 * Deux coutures face à face donnent un couloir infini, et un rayon tiré dedans y tournerait
 * sans fin. La portée y met un terme, et le compte de cellules traversées en met un second :
 * une distance peut s'épuiser lentement dans une salle immense, le compte, lui, est sûr.
 */
const CELLS = 24
const SKIN = 1e-4

export function castRay(
  world: World,
  cellId: string,
  origin: Vec3,
  direction: Vec3,
  reach = 40,
): RayHit | null {
  let cell = world.cells.get(cellId)
  if (!cell) return null

  let from = origin
  let dir = normalize(direction)
  if (len(dir) < 0.5) return null

  let travelled = 0
  let crossings = 0

  for (let hop = 0; hop < CELLS; hop++) {
    const left = reach - travelled
    if (left <= 0) return null

    const wall = exitOf(cell, from, dir, left)
    let stop = wall.t
    let normal = wall.normal
    let block: Block | undefined

    // Ce qui est plein au milieu de la pièce, et qu'on rencontre avant sa paroi.
    for (const b of cell.blocks ?? []) {
      const hit = enterBox(b.min, b.max, from, dir)
      if (!hit || hit.t >= stop) continue
      stop = hit.t
      normal = hit.normal
      block = b
    }

    // Puis les ouvertures. Une bouche ne s'ouvre que du côté visible, c'est-à-dire quand le
    // rayon la prend à revers de sa normale — la même règle qu'au franchissement.
    let cross: { t: number; passage: (typeof cell.passages)[number] } | null = null
    for (const passage of cell.passages) {
      const t = planeOf(passage.from, from, dir)
      if (t === null || t < -SKIN) continue
      if (!inside(passage.from, add(from, scale(dir, t)))) continue
      if (cross && t >= cross.t) continue
      cross = { t, passage }
    }

    // **L'ouverture l'emporte sur la paroi qu'elle perce, même si elle est derrière.**
    //
    // Le plan d'une couture est au fond de l'ébrasement, donc *au-delà* de la face de la
    // paroi : comparer les deux distances ferait toujours gagner le mur, et l'on ne
    // traverserait jamais rien. Ce qui décide n'est pas laquelle est la plus proche, c'est
    // de savoir si le rayon est passé **par le trou**. Il l'est quand la bouche regarde du
    // même côté que la surface rencontrée et que son rectangle est touché.
    const through =
      cross !== null &&
      (block
        ? block.door === cross.passage.from && Math.abs(cross.t - stop) < 1
        : dot(cross.passage.from.normal, normal) > 0.9) &&
      cross.t >= stop - SKIN

    if (!through || !cross) {
      if (stop > left) return null
      return {
        cell: cell.id,
        point: add(from, scale(dir, stop)),
        normal,
        distance: travelled + stop,
        crossings,
        ...(block ? { block } : {}),
      }
    }

    if (cross.t > left) return null
    const t = cross.passage.transform
    const impact = add(from, scale(dir, cross.t))
    travelled += cross.t
    from = add(transformPoint(t, impact), scale(cross.passage.to.normal, SKIN))
    dir = normalize(transformDir(t, dir))
    const next = world.cells.get(cross.passage.to.cell)
    if (!next) return null
    cell = next
    crossings++
  }

  return null
}

/**
 * La sortie de la boîte, vue de l'intérieur.
 *
 * Une salle dont la forme n'est pas sa boîte — un tube vrillé, un escalier tournant — n'a pas
 * de paroi que le rayon puisse rencontrer ici : on renvoie l'infini, et le rayon n'y verra
 * que les blocs et les ouvertures.
 */
function exitOf(cell: Cell, from: Vec3, dir: Vec3, limit: number): { t: number; normal: Vec3 } {
  if (cell.twist || cell.spiral) return marchOut(cell, from, dir, limit)

  const min = [cell.min.x, cell.min.y, cell.min.z]
  const max = [cell.max.x, cell.max.y, cell.max.z]
  const o = [from.x, from.y, from.z]
  const d = [dir.x, dir.y, dir.z]

  let best = Infinity
  let axis = 0
  let sign = 1
  for (const k of [0, 1, 2]) {
    if (Math.abs(d[k]!) < 1e-9) continue
    const face = d[k]! > 0 ? max[k]! : min[k]!
    const t = (face - o[k]!) / d[k]!
    if (t < 0 || t >= best) continue
    best = t
    axis = k
    // La normale d'une paroi regarde vers l'intérieur de la pièce, donc à l'inverse du rayon.
    sign = d[k]! > 0 ? -1 : 1
  }

  const n = [0, 0, 0]
  n[axis] = sign
  return { t: best, normal: { x: n[0]!, y: n[1]!, z: n[2]! } }
}

/**
 * La sortie d'une salle dont la forme n'est pas sa boîte, trouvée à tâtons.
 *
 * Cinq centimètres de pas, puis douze dichotomies : l'erreur tombe sous les vingt microns,
 * ce qui est très en dessous de tout ce qu'on lui demandera. Le pas est le vrai paramètre —
 * plus grossier, il enjamberait un pilier étroit ; plus fin, il coûterait sans rien gagner,
 * puisque la dichotomie fait déjà tout le travail de précision.
 *
 * La normale est celle de la contrainte qui a cédé, et elle se lit dans le repère local :
 * dans un tube qui a tourné d'un quart de tour, « le plafond » n'est plus en haut.
 */
function marchOut(cell: Cell, from: Vec3, dir: Vec3, limit: number): { t: number; normal: Vec3 } {
  const STRIDE = 0.05
  const inside = (t: number): boolean => within(cell, add(from, scale(dir, t)))

  // **On ne sort que de ce dans quoi on est entré.** Le plan d'une couture est au fond de son
  // ébrasement, donc en dehors du volume de la salle : un rayon qui vient d'entrer commence
  // vingt-cinq centimètres avant le tube, à un endroit qui n'est pas dedans. Le prendre pour
  // une sortie arrêtait le rayon sur le seuil, et la salle entière restait invisible.
  let entered = false
  let last = 0
  for (let t = STRIDE; t <= limit + STRIDE; t += STRIDE) {
    const at = Math.min(t, limit)
    if (inside(at)) {
      entered = true
      last = at
      if (at >= limit) return { t: Infinity, normal: { x: 0, y: 1, z: 0 } }
      continue
    }
    if (!entered) continue
    let lo = last
    let hi = at
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      if (inside(mid)) lo = mid
      else hi = mid
    }
    return { t: lo, normal: normalOut(cell, add(from, scale(dir, hi))) }
  }
  return { t: Infinity, normal: { x: 0, y: 1, z: 0 } }
}

/** Le point est-il dans le volume habitable de la salle ? */
function within(cell: Cell, p: Vec3): boolean {
  if (cell.twist) {
    const local = toLocal(cell.twist, p)
    const half = cell.twist.halfSize
    return (
      local.s >= 0 &&
      local.s <= cell.twist.length &&
      Math.abs(local.u) <= half &&
      Math.abs(local.v) <= half
    )
  }
  if (cell.spiral) {
    if (p.x < cell.min.x || p.x > cell.max.x || p.z < cell.min.z || p.z > cell.max.z) return false
    return p.y >= rampHeight(cell.spiral, p) && p.y <= ceilingHeight(cell.spiral, p)
  }
  return true
}

/** La normale de la face franchie, déduite de la contrainte qui a cédé. */
function normalOut(cell: Cell, out: Vec3): Vec3 {
  if (cell.twist) {
    const local = toLocal(cell.twist, out)
    const frame = frameAt(cell.twist, local.s)
    const half = cell.twist.halfSize
    if (Math.abs(local.u) > half) return scale(frame.right, local.u > 0 ? -1 : 1)
    if (Math.abs(local.v) > half) return scale(frame.up, local.v > 0 ? -1 : 1)
    return scale(cell.twist.axis, local.s > cell.twist.length ? -1 : 1)
  }
  if (cell.spiral) {
    if (out.y < rampHeight(cell.spiral, out)) return { x: 0, y: 1, z: 0 }
    if (out.y > ceilingHeight(cell.spiral, out)) return { x: 0, y: -1, z: 0 }
    if (out.x < cell.min.x) return { x: 1, y: 0, z: 0 }
    if (out.x > cell.max.x) return { x: -1, y: 0, z: 0 }
    return { x: 0, y: 0, z: out.z < cell.min.z ? 1 : -1 }
  }
  return { x: 0, y: 1, z: 0 }
}

/** L'entrée dans une boîte pleine, vue de l'extérieur. */
function enterBox(
  min: Vec3,
  max: Vec3,
  from: Vec3,
  dir: Vec3,
): { t: number; normal: Vec3 } | null {
  const lo = [min.x, min.y, min.z]
  const hi = [max.x, max.y, max.z]
  const o = [from.x, from.y, from.z]
  const d = [dir.x, dir.y, dir.z]

  let near = -Infinity
  let far = Infinity
  let axis = 0
  let sign = 1
  for (const k of [0, 1, 2]) {
    if (Math.abs(d[k]!) < 1e-9) {
      if (o[k]! < lo[k]! || o[k]! > hi[k]!) return null
      continue
    }
    let t0 = (lo[k]! - o[k]!) / d[k]!
    let t1 = (hi[k]! - o[k]!) / d[k]!
    let s = 1
    if (t0 > t1) {
      const swap = t0
      t0 = t1
      t1 = swap
      s = -1
    }
    if (t0 > near) {
      near = t0
      axis = k
      sign = s
    }
    far = Math.min(far, t1)
    if (near > far) return null
  }
  if (far < 0 || near < 0) return null

  const n = [0, 0, 0]
  n[axis] = sign
  return { t: near, normal: { x: n[0]!, y: n[1]!, z: n[2]! } }
}

/** Où le rayon coupe le plan d'une bouche, s'il l'aborde par sa face visible. */
function planeOf(m: Mouth, from: Vec3, dir: Vec3): number | null {
  const facing = dot(m.normal, dir)
  // On ne franchit que du côté visible vers le côté caché : le rayon doit descendre la
  // normale, pas la remonter.
  if (facing > -1e-9) return null
  return dot(m.normal, sub(m.center, from)) / facing
}

/** Le point tombe-t-il dans le rectangle de la bouche ? */
function inside(m: Mouth, at: Vec3): boolean {
  const rel = sub(at, m.center)
  return Math.abs(dot(rel, m.right)) <= m.halfWidth && Math.abs(dot(rel, m.up)) <= m.halfHeight
}
