/**
 * Les cloisons qui ne bougent que quand on ne les regarde pas.
 *
 * C'est la troisième variante des murs mobiles, et la seule qui vaille : les deux autres —
 * une cloison qui va et vient selon une horloge, un fond de couloir qui recule — se
 * franchissent avec du timing, et une porte à passer au bon moment fait basculer le musée
 * dans un autre genre. Ici il n'y a rien à réussir. On avance, le couloir est comme il est ;
 * on se retourne, et il n'est plus le même. Le visiteur n'a jamais vu un mur bouger, et c'est
 * exactement pour cela qu'il ne peut pas s'en défendre.
 *
 * ## La règle, et pourquoi elle est stricte
 *
 * **Aucun mouvement visible, même du coin de l'œil.** Une cloison qui se met en marche parce
 * qu'on a tourné la tête d'un degré de trop détruit tout l'effet d'un coup : il suffit de
 * l'apercevoir une fois pour comprendre qu'il y a un mécanisme, et à partir de là on ne
 * regarde plus la salle, on surveille les murs. Le champ testé est donc **plus large que
 * celui de la caméra** — une marge d'un huitième de tour tout autour — et une cloison ne
 * bouge que si aucun de ses huit sommets n'y tombe. Se tromper du bon côté ne coûte qu'une
 * cloison qui ne bouge pas ; se tromper de l'autre coûte l'aile entière.
 *
 * **Et jamais sur le visiteur.** Une cloison dont la course passerait par l'endroit où il se
 * tient attend. Sans quoi on se retrouverait poussé par un mur qu'on n'a pas vu venir, ce qui
 * n'est plus troublant mais injuste — et la collision, elle, s'en tire très bien : voir la
 * reprise des butées dans `resolveAgainstCell`.
 *
 * ## Ce qui bouge
 *
 * Chaque cloison a deux places possibles, sa place de repos et sa place avancée, et rien
 * entre les deux : le déplacement est **instantané** parce qu'il est par définition invisible.
 * Une interpolation ne servirait qu'à risquer d'être vue en chemin.
 */

import { dot, len, normalize, sub, type Vec3 } from '../math/vec3'
import type { Cell, Mover, World } from './types'

/**
 * Le demi-angle du champ surveillé, en cosinus.
 *
 * Zéro virgule un correspond à environ quatre-vingt-quatre degrés de part et d'autre du
 * regard, soit près du tour complet de l'écran plus une marge franche. C'est volontairement
 * généreux : voir ci-dessus.
 */
const WATCHED = 0.1

/** Distance en deçà de laquelle une cloison ne se déplace pas, quoi qu'on regarde. */
const TOO_CLOSE = 3

export interface Eye {
  cell: string
  pos: Vec3
  forward: Vec3
}

/**
 * Fait bouger ce qui peut bouger, une fois par image, **avant** le visiteur.
 *
 * L'ordre compte : déplacée après lui, une cloison le trouverait déjà à l'intérieur d'elle-
 * même. Déplacée avant, la résolution ordinaire le fait ressortir par le plus court chemin,
 * qui pour une cloison mince est toujours l'une de ses deux grandes faces — il est poussé de
 * côté, jamais écrasé.
 */
export function tickMovers(world: World, eye: Eye): void {
  for (const cell of world.cells.values()) {
    for (const mover of cell.movers ?? []) {
      if (cell.id === eye.cell && watched(mover, eye)) continue
      if (cell.id === eye.cell && wouldReach(mover, eye.pos)) continue
      if (mover.target === mover.placed) continue
      place(mover, mover.target)
    }
  }
}

/**
 * Tire au sort une nouvelle configuration pour une salle, s'il y a lieu.
 *
 * Le tirage est **séparé du déplacement**, et c'est ce qui rend la salle jouable : on décide
 * où les cloisons devront être, puis elles s'y rendent quand elles le peuvent. Une cloison
 * regardée garde donc sa consigne en attente au lieu de la perdre, et le couloir finit
 * toujours par se reconfigurer — simplement pas sous les yeux de qui le traverse.
 */
export function shuffle(cell: Cell, roll: () => number): void {
  for (const mover of cell.movers ?? []) {
    mover.target = roll() < 0.5 ? 0 : 1
  }
}

/** Pose la cloison à l'une de ses deux places, géométrie et collision ensemble. */
function place(mover: Mover, at: 0 | 1): void {
  mover.placed = at
  mover.offset = at === 0 ? { x: 0, y: 0, z: 0 } : { ...mover.travel }
  mover.block.min = {
    x: mover.rest.min.x + mover.offset.x,
    y: mover.rest.min.y + mover.offset.y,
    z: mover.rest.min.z + mover.offset.z,
  }
  mover.block.max = {
    x: mover.rest.max.x + mover.offset.x,
    y: mover.rest.max.y + mover.offset.y,
    z: mover.rest.max.z + mover.offset.z,
  }
}

/** Pose toutes les cloisons d'un monde à leur place de repos. */
export function restMovers(world: World): void {
  for (const cell of world.cells.values()) {
    for (const mover of cell.movers ?? []) place(mover, 0)
  }
}

/**
 * L'un des sommets de la cloison — à sa place actuelle **ou à celle qu'elle vise** — tombe-t-il
 * dans le champ surveillé ?
 *
 * Les deux places comptent, et c'est le détail qui fait toute la différence : tester la seule
 * place actuelle laisse une cloison invisible bondir dans le champ. On ne verrait pas le
 * mouvement, mais on verrait le mur **apparaître**, ce qui est pire.
 */
function watched(mover: Mover, eye: Eye): boolean {
  for (const at of [0, 1] as const) {
    const shift = at === 0 ? { x: 0, y: 0, z: 0 } : mover.travel
    const lo = {
      x: mover.rest.min.x + shift.x,
      y: mover.rest.min.y + shift.y,
      z: mover.rest.min.z + shift.z,
    }
    const hi = {
      x: mover.rest.max.x + shift.x,
      y: mover.rest.max.y + shift.y,
      z: mover.rest.max.z + shift.z,
    }
    for (const x of [lo.x, hi.x]) {
      for (const y of [lo.y, hi.y]) {
        for (const z of [lo.z, hi.z]) {
          const to = sub({ x, y, z }, eye.pos)
          const d = len(to)
          if (d < TOO_CLOSE) return true
          if (dot(normalize(to), normalize(eye.forward)) > WATCHED) return true
        }
      }
    }
  }
  return false
}

/** La cloison, une fois posée, occuperait-elle la place du visiteur ? */
function wouldReach(mover: Mover, at: Vec3): boolean {
  const shift = mover.target === 0 ? { x: 0, y: 0, z: 0 } : mover.travel
  const room = 0.6
  return (
    at.x > mover.rest.min.x + shift.x - room &&
    at.x < mover.rest.max.x + shift.x + room &&
    at.y > mover.rest.min.y + shift.y - room &&
    at.y < mover.rest.max.y + shift.y + room &&
    at.z > mover.rest.min.z + shift.z - room &&
    at.z < mover.rest.max.z + shift.z + room
  )
}
