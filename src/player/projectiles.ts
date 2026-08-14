/**
 * Les cubes qu'on lance à travers la couture.
 *
 * C'est le test le plus convaincant de l'étape, et le moins coûteux : un objet qui
 * franchit l'ouverture, atterrit de l'autre côté et reste visible **à travers**
 * l'ouverture prouve d'un coup que la géométrie, le déplacement et le rendu
 * partagent bien la même transformation. Un portail purement visuel se trahit ici
 * en une seconde.
 *
 * Aucun traitement particulier n'est nécessaire côté rendu : un objet est dessiné
 * dans la cellule où il se trouve, et si cette cellule est vue à travers une
 * couture, l'objet apparaît dedans naturellement.
 *
 * L'orientation est stockée comme une **base de trois vecteurs**, et non comme un
 * axe et un angle. C'est plus encombrant, et c'est ce qui permet de la faire
 * voyager : tout ce qui a une direction doit être transformé en traversant une
 * couture, orientation comprise. La version précédente ne transportait que la
 * vitesse, si bien qu'un cube changeait brusquement d'orientation en franchissant
 * une porte — il reprenait sa rotation dans l'ancien repère.
 */

import { create, fromBasis, type Mat4 } from '../math/mat4'
import { add, cross, dot, len, normalize, rotateAxis, scale, sub, v3, type Vec3 } from '../math/vec3'
import { advance, resolveAgainstCell } from '../world/motion'
import type { Cell, World } from '../world/types'
import type { Player } from './player'

export const CUBE_SIZE = 0.34
const HALF = CUBE_SIZE / 2
const GRAVITY = 11
const THROW_SPEED = 8.5
/** Vitesse de rotation propre, en radians par seconde. */
const SPIN = 4.5
const LIFETIME = 26
const MAX_COUNT = 24

interface Projectile {
  cell: string
  pos: Vec3
  vel: Vec3
  /** Base d'orientation : les colonnes du repère de l'objet. */
  ex: Vec3
  ey: Vec3
  ez: Vec3
  /** Axe de la rotation propre, exprimé dans le repère du monde. */
  axis: Vec3
  age: number
  resting: boolean
}

export class Projectiles {
  private readonly list: Projectile[] = []

  get count(): number {
    return this.list.length
  }

  clear(): void {
    this.list.length = 0
  }

  throwFrom(player: Player, world: World): void {
    if (this.list.length >= MAX_COUNT) this.list.shift()

    // Le point d'apparition doit franchir les coutures comme n'importe quel
    // déplacement. Naïvement, on fait naître l'objet cinquante centimètres devant
    // les yeux pour ne pas le poser dans la tête du visiteur — mais collé à une
    // ouverture, ces cinquante centimètres tombent **au-delà** de la bouche,
    // c'est-à-dire hors de la cellule. L'objet naît alors dans le vide derrière le
    // mur, et il ne peut plus jamais rentrer : la traversée exige de partir du bon
    // côté du plan.
    const carried = [{ ...player.forward }, { ...player.up }]
    const spawn = advance(
      world,
      player.cell,
      player.pos,
      scale(player.forward, 0.5),
      carried,
      clampInside,
    )
    const forward = carried[0]!
    const up = carried[1]!
    const right = normalize(cross(forward, up))

    this.list.push({
      cell: spawn.cell,
      pos: add(spawn.pos, scale(up, -0.18)),
      vel: scale(forward, THROW_SPEED),
      ex: right,
      ey: cross(right, forward),
      ez: scale(forward, -1),
      // Un axe oblique, pour que la rotation reste lisible sous tous les angles.
      axis: normalize(add(right, scale(up, 0.6))),
      age: 0,
      resting: false,
    })
  }

  update(dt: number, world: World): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!
      p.age += dt
      if (p.age > LIFETIME) {
        this.list.splice(i, 1)
        continue
      }
      if (p.resting) continue

      p.vel = add(p.vel, v3(0, -GRAVITY * dt, 0))

      // Rotation propre, appliquée à la base entière.
      const angle = SPIN * dt
      p.ex = rotateAxis(p.ex, p.axis, angle)
      p.ey = rotateAxis(p.ey, p.axis, angle)
      p.ez = rotateAxis(p.ez, p.axis, angle)
      orthonormalise(p)

      const delta = scale(p.vel, dt)
      if (len(delta) < 1e-6) continue

      let touched = false
      // Tout ce qui a une direction doit voyager : la vitesse, la base d'orientation
      // et l'axe de la rotation propre. En oublier un seul se voit immédiatement —
      // c'est exactement ce qui faisait tourner les cubes de travers après une
      // traversée.
      const carried = [p.vel, p.ex, p.ey, p.ez, p.axis]
      const result = advance(world, p.cell, p.pos, delta, carried, (cell, candidate) => {
        const resolved = clampInside(cell, candidate)
        if (
          Math.abs(resolved.x - candidate.x) > 1e-9 ||
          Math.abs(resolved.y - candidate.y) > 1e-9 ||
          Math.abs(resolved.z - candidate.z) > 1e-9
        ) {
          touched = true
        }
        return resolved
      })

      p.vel = carried[0]!
      p.ex = carried[1]!
      p.ey = carried[2]!
      p.ez = carried[3]!
      p.axis = carried[4]!
      p.cell = result.cell
      p.pos = result.pos
      if (result.crossings > 0) orthonormalise(p)

      if (touched) {
        // Aucune prétention à la physique : le cube s'immobilise. Ce qui compte ici
        // est la traversée, pas le rebond.
        p.vel = scale(p.vel, 0.25)

        // Mais il ne s'immobilise que **posé**. Sans cette condition, un cube qui
        // frôle deux fois le montant d'une porte perd assez de vitesse pour être
        // déclaré au repos en pleine embrasure, et reste suspendu en l'air.
        const floor = world.cells.get(p.cell)?.min.y ?? -Infinity
        if (p.pos.y <= floor + HALF + 1e-3 && len(p.vel) < 0.6) {
          p.resting = true
          p.vel = v3(0, 0, 0)
        }
      }
    }
  }

  /**
   * L'état brut, pour l'auto-test.
   *
   * La liste de rendu ne porte qu'une matrice, alors que l'invariant qui compte met
   * en jeu la vitesse : c'est l'angle entre les axes de l'objet et sa trajectoire
   * qui doit rester continu en traversant une couture.
   */
  inspect(): { cell: string; pos: Vec3; vel: Vec3; ex: Vec3; ey: Vec3; ez: Vec3 }[] {
    return this.list.map((p) => ({
      cell: p.cell,
      pos: p.pos,
      vel: p.vel,
      ex: p.ex,
      ey: p.ey,
      ez: p.ez,
    }))
  }

  toRenderList(): { cell: string; model: Mat4 }[] {
    return this.list.map((p) => ({
      cell: p.cell,
      model: fromBasis(create(), p.ex, p.ey, p.ez, p.pos),
    }))
  }
}

/**
 * Remise d'équerre de la base d'orientation, par Gram-Schmidt.
 *
 * Les rotations successives et les transformations de couture sont rigides en
 * théorie ; en pratique l'arrondi s'accumule, et une base qui dérive fait
 * lentement cisailler le cube. Trois produits vectoriels suffisent à l'éviter.
 */
function orthonormalise(p: Projectile): void {
  p.ex = normalize(p.ex)
  p.ey = normalize(sub(p.ey, scale(p.ex, dot(p.ey, p.ex))))
  p.ez = cross(p.ex, p.ey)
  p.axis = normalize(p.axis)
}

function clampInside(cell: Cell, p: Vec3): Vec3 {
  const flat = resolveAgainstCell(cell, p, HALF)
  return {
    x: flat.x,
    y: Math.min(Math.max(flat.y, cell.min.y + HALF), cell.max.y - HALF),
    z: flat.z,
  }
}
