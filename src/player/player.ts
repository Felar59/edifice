/**
 * Le visiteur.
 *
 * L'orientation n'est pas stockée en angles d'Euler mais comme une direction de
 * regard plus une verticale locale. C'est un peu plus de travail tout de suite,
 * et c'est indispensable ensuite : une couture peut faire pivoter le monde
 * n'importe comment, et le tunnel-vrille comme la gravité par face demandent que
 * « le haut » cesse d'être une constante. Des angles d'Euler autour d'un +Y
 * global seraient à jeter au premier virage.
 */

import { advance, resolveAgainstCell } from '../world/motion'
import type { World } from '../world/types'
import { add, cross, dot, len, normalize, rotateAxis, scale, sub, v3, type Vec3 } from '../math/vec3'

const RADIUS = 0.35
const WALK = 3.4
const SPRINT = 6.8
const LOOK_SENSITIVITY = 0.0022
/** Marge d'inclinaison, pour ne jamais aligner le regard avec la verticale. */
const PITCH_LIMIT = 0.06

export interface Preset {
  name: string
  cell: string
  pos: Vec3
  forward: Vec3
}

/**
 * Les points de vue du test de torture.
 *
 * Ce ne sont pas des raccourcis de confort : ce sont les six situations qui
 * trahissent un portail mal fait. Les avoir à portée de touche est ce qui permet
 * de vérifier en dix secondes, à chaque modification, que rien n'a régressé.
 */
export const PRESETS: Preset[] = [
  { name: 'Nez collé à la couture', cell: 'hall', pos: v3(0, 1.65, -4.88), forward: v3(0, 0, -1) },
  { name: 'Regard rasant', cell: 'hall', pos: v3(2.2, 1.65, -4.94), forward: v3(-0.96, 0, -0.28) },
  { name: 'Pile dans l’embrasure', cell: 'hall', pos: v3(0, 1.65, -4.999), forward: v3(0, 0, -1) },
  { name: 'Récursion (couloir infini)', cell: 'hall', pos: v3(0, 1.65, 4.4), forward: v3(0, 0, -1) },
  { name: 'Vue en biais depuis le coin', cell: 'hall', pos: v3(3.6, 1.65, 3.6), forward: v3(-0.55, -0.1, -0.83) },
  { name: 'Depuis la grande salle', cell: 'salle', pos: v3(38, 0.15, 28), forward: v3(-1, 0, 0) },
  // Assez près pour qu'un cube lancé franchisse l'ouverture avant de retomber,
  // assez loin pour qu'on le voie ensuite atterrir de l'autre côté.
  { name: 'Devant l’ouverture, pour lancer', cell: 'hall', pos: v3(0, 1.65, -2.2), forward: v3(0, 0, -1) },
  // Les trois points de vue ajoutés après les premiers essais au clavier. Le
  // tangage faussait le repère de la caméra, et l'approche au cheveu près vidait
  // l'image : trois défauts que les compteurs seuls ne pouvaient pas voir.
  { name: 'Tangage vers le bas', cell: 'hall', pos: v3(0, 1.65, 2.0), forward: v3(0, -0.62, -0.78) },
  { name: 'Tangage vers le haut', cell: 'hall', pos: v3(0, 1.65, 2.0), forward: v3(0, 0.55, -0.84) },
  // Deux distances, parce que deux défauts distincts se cachent là.
  // À un dixième de millimètre, le quad de l'ouverture est plus proche que le plan
  // proche et se fait écrêter : c'est le mode plein écran qui sauve l'image.
  { name: 'À un cheveu de la couture', cell: 'hall', pos: v3(0, 1.65, -4.9999), forward: v3(0, 0, -1) },
  // Au micron, c'est le plan proche oblique qui dégénère : la troisième ligne de la
  // matrice devient l'opposée de la quatrième et tout atterrit sur le plan lointain.
  { name: 'Au micron de la couture', cell: 'hall', pos: v3(0, 1.65, -4.999999), forward: v3(0, 0, -1) },
  // Debout dans l'embrasure, mais **sans regarder la couture**. Ces deux vues
  // attrapent le défaut du raccourci « on peint tout l'écran quand on est près de
  // l'ouverture » : il ignorait la direction du regard et recouvrait toute l'image
  // avec la vue d'une caméra qui regarde hors de la salle d'en face. Debout entre
  // les deux pièces, l'une des deux devenait un grand aplat gris.
  { name: 'Dans l’embrasure, regard de côté', cell: 'hall', pos: v3(0, 1.65, -4.995), forward: v3(1, 0, -0.08) },
  { name: 'Dans l’embrasure, dos tourné', cell: 'hall', pos: v3(0, 1.65, -4.995), forward: v3(0, 0, 1) },
]

export class Player {
  cell: string
  pos: Vec3
  forward: Vec3
  up: Vec3
  crossings = 0

  constructor() {
    const p = PRESETS[3]!
    this.cell = p.cell
    this.pos = { ...p.pos }
    this.forward = normalize(p.forward)
    this.up = v3(0, 1, 0)
  }

  goTo(preset: Preset): void {
    this.cell = preset.cell
    this.pos = { ...preset.pos }
    this.forward = normalize(preset.forward)
    this.up = v3(0, 1, 0)
    this.renormalise()
  }

  right(): Vec3 {
    return normalize(cross(this.forward, this.up))
  }

  /** Rotation du regard : lacet autour de la verticale locale, tangage autour du côté. */
  look(dx: number, dy: number): void {
    this.forward = normalize(rotateAxis(this.forward, this.up, -dx * LOOK_SENSITIVITY))

    const r = this.right()
    const candidate = normalize(rotateAxis(this.forward, r, -dy * LOOK_SENSITIVITY))
    // Interdire de dépasser la verticale : au-delà, le lacet s'inverse et la vue
    // se met à rouler.
    const alignment = dot(candidate, this.up)
    if (Math.abs(alignment) < Math.cos(PITCH_LIMIT)) this.forward = candidate
  }

  update(dt: number, world: World, keys: Set<string>): void {
    // Base horizontale : le regard projeté sur le plan perpendiculaire à la
    // verticale locale. C'est ce qui fait qu'on ne décolle pas en regardant en l'air.
    let fwdH = sub(this.forward, scale(this.up, dot(this.forward, this.up)))
    if (len(fwdH) < 1e-4) fwdH = cross(this.up, this.right())
    fwdH = normalize(fwdH)
    const rightH = normalize(cross(fwdH, this.up))

    let ax = 0
    let az = 0
    if (keys.has('KeyW') || keys.has('ArrowUp')) az += 1
    if (keys.has('KeyS') || keys.has('ArrowDown')) az -= 1
    if (keys.has('KeyD') || keys.has('ArrowRight')) ax += 1
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ax -= 1
    if (ax === 0 && az === 0) return

    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT : WALK
    const dir = normalize(add(scale(fwdH, az), scale(rightH, ax)))
    const delta = scale(dir, speed * dt)

    // La direction du regard et la verticale locale voyagent avec le corps.
    const carried = [this.forward, this.up]
    const result = advance(world, this.cell, this.pos, delta, carried, (cell, p) =>
      resolveAgainstCell(cell, p, RADIUS),
    )
    this.forward = carried[0]!
    this.up = carried[1]!
    this.cell = result.cell
    this.pos = result.pos
    this.crossings += result.crossings

    if (result.crossings > 0) this.renormalise()
  }

  /**
   * Remise à l'unité des deux vecteurs, contre l'erreur d'arrondi accumulée au fil
   * des traversées.
   *
   * **Et rien de plus.** La version précédente projetait aussi le regard
   * perpendiculairement à la verticale, « pour remettre le repère d'équerre » — ce
   * qui écrasait le tangage. Conséquence : à chaque franchissement de porte, le
   * regard se redressait brutalement à l'horizontale. Le même défaut vidait les
   * préréglages inclinés de leur inclinaison, au point que les deux points de vue
   * de tangage du test produisaient des images identiques au bit près.
   *
   * Le regard n'a **aucune raison** d'être perpendiculaire à la verticale : c'est
   * précisément ce que veut dire regarder en haut ou en bas. Seul le repère de la
   * caméra doit être orthonormé, et il est reconstruit à chaque image à partir de
   * ces deux vecteurs — voir `src/render/camera.ts`.
   */
  private renormalise(): void {
    this.up = normalize(this.up)
    this.forward = normalize(this.forward)
  }
}
