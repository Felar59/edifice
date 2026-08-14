/**
 * Les cubes qu'on lance à travers la couture.
 *
 * C'est le test le plus convaincant de l'étape, et le moins coûteux : un objet
 * qui franchit l'ouverture, atterrit de l'autre côté et reste visible **à
 * travers** l'ouverture prouve d'un coup que la géométrie, le déplacement et le
 * rendu partagent bien la même transformation. Un portail purement visuel se
 * trahit ici en une seconde.
 *
 * Aucun traitement particulier n'est nécessaire côté rendu : un objet est
 * dessiné dans la cellule où il se trouve, et si cette cellule est vue à travers
 * une couture, l'objet apparaît dedans naturellement.
 */

import { create, fromBasis, type Mat4 } from '../math/mat4'
import { add, cross, len, normalize, rotateAxis, scale, v3, type Vec3 } from '../math/vec3'
import { advance, resolveAgainstCell } from '../world/motion'
import type { Cell, World } from '../world/types'
import type { Player } from './player'

export const CUBE_SIZE = 0.34
const HALF = CUBE_SIZE / 2
const GRAVITY = 11
const THROW_SPEED = 8.5
const LIFETIME = 26
const MAX_COUNT = 24

interface Projectile {
  cell: string
  pos: Vec3
  vel: Vec3
  axis: Vec3
  angle: number
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
    // c'est-à-dire hors de la cellule. L'objet naît alors dans le vide derrière
    // le mur, et il ne peut plus jamais rentrer : la traversée exige de partir du
    // bon côté du plan.
    const carried = [{ ...player.forward }, { ...player.up }]
    const spawn = advance(world, player.cell, player.pos, scale(player.forward, 0.5), carried, clampInside)
    const forward = carried[0]!
    const up = carried[1]!

    this.list.push({
      cell: spawn.cell,
      pos: add(spawn.pos, scale(up, -0.18)),
      vel: scale(forward, THROW_SPEED),
      axis: rotateAxis(normalize(cross(forward, up)), forward, 0.7),
      angle: 0,
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
      const delta = scale(p.vel, dt)
      if (len(delta) < 1e-6) continue

      let touched = false
      const carried = [p.vel]
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
      p.cell = result.cell
      p.pos = result.pos
      p.angle += dt * 4.5

      if (touched) {
        // Aucune prétention à la physique : le cube s'immobilise. Ce qui compte
        // ici est la traversée, pas le rebond.
        p.vel = scale(p.vel, 0.25)
        if (len(p.vel) < 0.6) {
          p.resting = true
          p.vel = v3(0, 0, 0)
        }
      }
    }
  }

  toRenderList(): { cell: string; model: Mat4 }[] {
    return this.list.map((p) => ({
      cell: p.cell,
      model: fromBasis(
        create(),
        rotateAxis(v3(1, 0, 0), p.axis, p.angle),
        rotateAxis(v3(0, 1, 0), p.axis, p.angle),
        rotateAxis(v3(0, 0, 1), p.axis, p.angle),
        p.pos,
      ),
    }))
  }
}

function clampInside(cell: Cell, p: Vec3): Vec3 {
  const flat = resolveAgainstCell(cell, p, HALF)
  return {
    x: flat.x,
    y: Math.min(Math.max(flat.y, cell.min.y + HALF), cell.max.y - HALF),
    z: flat.z,
  }
}
