/**
 * Les objets lancés.
 *
 * **Le calcul est en Rust**, compilé vers WebAssembly ; ce fichier n'est plus qu'un guichet.
 * Il fait naître les cubes, prête au noyau son tableau de corps, et rend au moteur de rendu
 * des matrices. Tout ce qui ressemble à de la physique — la chute, les rebonds, le
 * frottement, le basculement, les cubes entre eux — vit dans `physique/src/lib.rs`.
 *
 * ## Pourquoi ce morceau-là, et pourquoi maintenant
 *
 * C'est le seul endroit du moteur dont le coût dépend du **nombre d'objets** plutôt que du
 * nombre de pixels, donc le seul qui gagne à quitter la page. Et c'est aussi celui dont on
 * voulait faire davantage : l'ancienne version faisait tourner les cubes à vitesse constante
 * autour d'un axe tiré au hasard et les arrêtait net en touchant le sol. Un cube est
 * maintenant un solide — il a une inertie, il rebondit sur ses arêtes, il bascule, il frotte,
 * il se pose à plat, il se cogne aux autres.
 *
 * ## Ce qui reste de ce côté-ci
 *
 * Le lancer, parce qu'il part du visiteur et doit franchir les coutures comme n'importe quel
 * déplacement ; la durée de vie ; et la traduction entre l'identifiant d'une cellule et son
 * indice. Rien qui coûte par image.
 */

import { create, fromBasis, type Mat4 } from '../math/mat4'
import { add, cross, normalize, scale, type Vec3 } from '../math/vec3'
import { advance, resolveAgainstCell } from '../world/motion'
import type { Cell, World } from '../world/types'
import type { Player } from './player'
import { STRIDE, type Physics } from './physique'

/** Le côté d'un cube lancé. Le noyau connaît la même valeur ; les deux doivent s'accorder. */
export const CUBE_SIZE = 0.34
const HALF = CUBE_SIZE / 2

const THROW_SPEED = 8.5
const LIFETIME = 26
const MAX_COUNT = 24

/**
 * Un cube est un corps centré : ses « pieds » et son « crâne » sont à égale distance de son
 * centre. Ne sert plus qu'au point d'apparition, la collision étant passée en Rust.
 */
const CUBE_BODY = { radius: HALF, eyeHeight: HALF, headroom: HALF, up: { x: 0, y: 1, z: 0 } }

function clampInside(cell: Cell, p: Vec3): Vec3 {
  return resolveAgainstCell(cell, p, CUBE_BODY).pos
}

export class Projectiles {
  private count_ = 0
  private readonly ages: number[] = []

  constructor(private readonly physics: Physics) {}

  get count(): number {
    return this.count_
  }

  clear(): void {
    this.count_ = 0
    this.ages.length = 0
  }

  throwFrom(player: Player, world: World): void {
    // Le point d'apparition doit franchir les coutures comme n'importe quel déplacement.
    // Naïvement, on fait naître l'objet cinquante centimètres devant les yeux pour ne pas le
    // poser dans la tête du visiteur — mais collé à une ouverture, ces cinquante centimètres
    // tombent **au-delà** de la bouche, c'est-à-dire hors de la cellule. L'objet naîtrait
    // alors dans le vide derrière le mur, sans pouvoir jamais rentrer : la traversée exige de
    // partir du bon côté du plan.
    const carried = [{ ...player.forward }, { ...player.up }]
    const spawn = advance(world, player.cell, player.pos, scale(player.forward, 0.5), carried, clampInside)
    const forward = carried[0]!
    const up = carried[1]!
    const right = normalize(cross(forward, up))
    const pos = add(spawn.pos, scale(up, -0.18))
    const velocity = scale(forward, THROW_SPEED)

    // Le tableau est un anneau : le plus vieux cède sa place. Le noyau ne connaît que le
    // nombre de corps actifs, et ils sont toujours au début.
    const slot = this.count_ < MAX_COUNT ? this.count_++ : this.shiftOut()
    const bodies = this.physics.bodies()
    const at = slot * STRIDE

    bodies[at] = pos.x
    bodies[at + 1] = pos.y
    bodies[at + 2] = pos.z
    // Orientation de départ : celle du regard, en quaternion. Une base de trois vecteurs
    // n'aurait pas survécu aux milliers de rotations qui suivent.
    const q = quatOfBasis(right, cross(right, forward), scale(forward, -1))
    bodies[at + 3] = q[0]
    bodies[at + 4] = q[1]
    bodies[at + 5] = q[2]
    bodies[at + 6] = q[3]
    bodies[at + 7] = velocity.x
    bodies[at + 8] = velocity.y
    bodies[at + 9] = velocity.z
    // Un peu de rotation prise au lancer, oblique pour rester lisible sous tous les angles.
    bodies[at + 10] = right.x * 2.2 + up.x * 1.3
    bodies[at + 11] = right.y * 2.2 + up.y * 1.3
    bodies[at + 12] = right.z * 2.2 + up.z * 1.3
    bodies[at + 13] = this.physics.cellIndex(spawn.cell)
    bodies[at + 14] = 0
    bodies[at + 15] = 0
    this.ages[slot] = 0
  }

  /** Retire le plus ancien en tassant le tableau, et rend la place libérée. */
  private shiftOut(): number {
    const bodies = this.physics.bodies()
    bodies.copyWithin(0, STRIDE, this.count_ * STRIDE)
    this.ages.shift()
    return this.count_ - 1
  }

  update(dt: number, world: World): void {
    void world
    if (this.count_ === 0) return

    this.physics.step(dt, this.count_)

    // La durée de vie se compte ici : le noyau n'a pas à savoir qu'un cube disparaît.
    const bodies = this.physics.bodies()
    for (let i = this.count_ - 1; i >= 0; i--) {
      this.ages[i] = (this.ages[i] ?? 0) + dt
      if (this.ages[i]! <= LIFETIME) continue
      bodies.copyWithin(i * STRIDE, (i + 1) * STRIDE, this.count_ * STRIDE)
      this.ages.splice(i, 1)
      this.count_--
    }
  }

  /**
   * L'état brut, pour l'auto-test.
   *
   * La liste de rendu ne porte qu'une matrice, alors que l'invariant qui compte met en jeu
   * la vitesse : c'est l'angle entre les axes de l'objet et sa trajectoire qui doit rester
   * continu en traversant une couture.
   */
  inspect(): { cell: string; pos: Vec3; vel: Vec3; ex: Vec3; ey: Vec3; ez: Vec3 }[] {
    const bodies = this.physics.bodies()
    const out = []
    for (let i = 0; i < this.count_; i++) {
      const at = i * STRIDE
      const q: Quat = [bodies[at + 3]!, bodies[at + 4]!, bodies[at + 5]!, bodies[at + 6]!]
      out.push({
        cell: this.physics.cellName(bodies[at + 13]!),
        pos: { x: bodies[at]!, y: bodies[at + 1]!, z: bodies[at + 2]! },
        vel: { x: bodies[at + 7]!, y: bodies[at + 8]!, z: bodies[at + 9]! },
        ex: turn(q, { x: 1, y: 0, z: 0 }),
        ey: turn(q, { x: 0, y: 1, z: 0 }),
        ez: turn(q, { x: 0, y: 0, z: 1 }),
      })
    }
    return out
  }

  toRenderList(): { cell: string; model: Mat4 }[] {
    return this.inspect().map((c) => ({
      cell: c.cell,
      model: fromBasis(create(), c.ex, c.ey, c.ez, c.pos),
    }))
  }
}

type Quat = [number, number, number, number]

/** Un vecteur tourné par un quaternion. */
function turn(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const u = { x, y, z }
  const uv = u.x * v.x + u.y * v.y + u.z * v.z
  const uu = u.x * u.x + u.y * u.y + u.z * u.z
  const c = cross(u, v)
  return {
    x: 2 * uv * u.x + v.x * (w * w - uu) + 2 * w * c.x,
    y: 2 * uv * u.y + v.y * (w * w - uu) + 2 * w * c.y,
    z: 2 * uv * u.z + v.z * (w * w - uu) + 2 * w * c.z,
  }
}

/**
 * Le quaternion d'une base directe. Méthode de Shepperd : on part de la plus grande des
 * quatre composantes, faute de quoi une racine carrée de presque zéro amplifie le bruit.
 */
function quatOfBasis(ex: Vec3, ey: Vec3, ez: Vec3): Quat {
  const trace = ex.x + ey.y + ez.z
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    return [(ey.z - ez.y) / s, (ez.x - ex.z) / s, (ex.y - ey.x) / s, 0.25 * s]
  }
  if (ex.x > ey.y && ex.x > ez.z) {
    const s = Math.sqrt(1 + ex.x - ey.y - ez.z) * 2
    return [0.25 * s, (ey.x + ex.y) / s, (ez.x + ex.z) / s, (ey.z - ez.y) / s]
  }
  if (ey.y > ez.z) {
    const s = Math.sqrt(1 + ey.y - ex.x - ez.z) * 2
    return [(ey.x + ex.y) / s, 0.25 * s, (ez.y + ey.z) / s, (ez.x - ex.z) / s]
  }
  const s = Math.sqrt(1 + ez.z - ex.x - ey.y) * 2
  return [(ez.x + ex.z) / s, (ez.y + ey.z) / s, 0.25 * s, (ex.y - ey.x) / s]
}
