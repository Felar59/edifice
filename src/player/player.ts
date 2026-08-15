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

import { advance, localUp, resolveAgainstCell, type Body } from '../world/motion'
import { getLandmarks } from '../world/world'
import type { World } from '../world/types'
import { add, cross, dot, len, normalize, rotateAxis, scale, sub, v3, type Vec3 } from '../math/vec3'

/**
 * Le corps du visiteur.
 *
 * Un mètre quatre-vingts, l'œil à un mètre soixante-cinq. Ces quinze centimètres de
 * crâne ne sont pas un détail : ce sont eux qui heurtent le linteau, et donc eux qui
 * empêchent d'entrer dans une porte en pleine détente.
 */
const BODY: Body = { radius: 0.35, eyeHeight: 1.65, headroom: 0.15 }

const WALK = 3.4
const SPRINT = 6.8

/**
 * Gravité, en mètres par seconde carrée.
 *
 * Presque le double du réel. C'est délibéré : à 9,81 un saut d'un demi-mètre dure près
 * d'une seconde, ce qui donne une impression de flottement lunaire. Les jeux à la
 * première personne tournent tous autour de vingt.
 */
const GRAVITY = 18
/** De quoi culminer à un peu plus d'un demi-mètre. */
const JUMP_SPEED = 4.6
/** Vitesse de chute plafonnée, pour ne pas traverser un sol en une image. */
const MAX_FALL = 28
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
 * Ce ne sont pas des raccourcis de confort : ce sont les situations qui trahissent un
 * portail mal fait. Les avoir à portée de touche est ce qui permet de vérifier en dix
 * secondes, à chaque modification, que rien n'a régressé.
 *
 * Ils sont **calculés à partir du monde**, jamais écrits en dur. Le plan des coutures a
 * déjà bougé deux fois — quand les parois ont pris de l'épaisseur, puis quand le monde
 * est devenu une rotonde — et à chaque fois les repères figés se sont mis à mesurer
 * autre chose sans rien signaler.
 */
let cached: Preset[] | null = null

export function presets(): Preset[] {
  if (cached) return cached
  const marks = getLandmarks()

  /** Une pose à `metres` devant la couture de référence, regardant vers elle. */
  const before = (metres: number, pitch = 0): { cell: string; pos: Vec3; forward: Vec3 } => ({
    cell: marks.hub,
    pos: add(marks.seamCenter, scale(marks.seamNormal, metres)),
    forward: { x: -marks.seamNormal.x, y: pitch, z: -marks.seamNormal.z },
  })

  /** La même, décalée le long de la porte. */
  const beside = (metres: number, sideways: number, forward: Vec3) => ({
    cell: marks.hub,
    pos: add(
      add(marks.seamCenter, scale(marks.seamNormal, metres)),
      scale(marks.seamRight, sideways),
    ),
    forward,
  })

  cached = [
    { name: 'Nez collé à la couture', ...before(0.12) },
    {
      name: 'Regard rasant',
      ...beside(0.06, 2.2, {
        x: -marks.seamRight.x * 0.96 - marks.seamNormal.x * 0.28,
        y: 0,
        z: -marks.seamRight.z * 0.96 - marks.seamNormal.z * 0.28,
      }),
    },
    { name: 'Pile dans l’embrasure', ...before(0.001) },
    // Le couloir infini : les deux bouts du tunnel donnant sur la rotonde, on voit la
    // rotonde à travers le tunnel, puis le tunnel à travers la rotonde, sans fin.
    { name: 'Récursion — le couloir infini', ...before(13.4) },
    {
      name: 'Vue en biais depuis le coin',
      ...beside(5, 3.4, {
        x: -marks.seamNormal.x * 0.83 - marks.seamRight.x * 0.55,
        y: -0.1,
        z: -marks.seamNormal.z * 0.83 - marks.seamRight.z * 0.55,
      }),
    },
    {
      name: 'Depuis l’aile, vers sa porte',
      cell: marks.wingCell,
      pos: marks.wingPos,
      forward: marks.wingForward,
    },
    // Assez près pour qu'un cube lancé franchisse l'ouverture avant de retomber, assez
    // loin pour qu'on le voie ensuite atterrir de l'autre côté.
    { name: 'Devant l’ouverture, pour lancer', ...before(2.2) },
    { name: 'Tangage vers le bas', ...before(4, -0.62) },
    { name: 'Tangage vers le haut', ...before(4, 0.55) },
    { name: 'À un cheveu de la couture', ...before(0.0005) },
    // Un dixième de micron : cet état n'est **pas** atteignable en marchant, puisqu'on
    // franchit dès qu'un pas arrive à un dixième de millimètre du plan. On le garde
    // quand même : c'est un contrôle de robustesse du découpage de silhouette, et c'est
    // lui qui avait révélé la dégénérescence du plan proche oblique.
    { name: 'Au micron de la couture', ...before(0.000001) },
    // Debout dans l'embrasure, mais **sans regarder la couture**. Ces deux vues
    // attrapent le défaut du raccourci « on peint tout l'écran quand on est près de
    // l'ouverture » : il ignorait la direction du regard et recouvrait toute l'image
    // avec la vue d'une caméra qui regarde hors de la pièce d'en face.
    {
      name: 'Dans l’embrasure, regard de côté',
      ...beside(0.13, 0, {
        x: -marks.seamRight.x,
        y: -0.08,
        z: -marks.seamRight.z,
      }),
    },
    {
      name: 'Dans l’embrasure, dos tourné',
      ...beside(0.13, 0, { ...marks.seamNormal }),
    },
    // Le volume impossible : un coffre de deux mètres cinquante posé au milieu de la
    // salle, une porte à hauteur d'homme dans sa face, et une nef de seize mètres
    // derrière. Tout est dans la même image — la boîte, sa porte, et ce qui n'y tient pas.
    {
      name: 'Le volume impossible',
      cell: marks.chestCell,
      pos: marks.chestPos,
      forward: marks.chestForward,
    },
  ]
  return cached
}

export class Player {
  cell: string
  pos: Vec3
  forward: Vec3
  up: Vec3
  crossings = 0
  /** Vitesse le long de la verticale locale : négative en chute. */
  vertical = 0
  /** Les pieds touchent le sol, donc on peut sauter. */
  grounded = false

  constructor() {
    // On entre par le centre de la rotonde : c'est de là qu'on voit la couronne des
    // huit portes, chacune de sa teinte.
    const marks = getLandmarks()
    this.cell = marks.hub
    this.pos = { ...marks.hubCenter }
    this.forward = normalize({ x: -marks.seamNormal.x, y: 0, z: -marks.seamNormal.z })
    this.up = v3(0, 1, 0)
  }

  goTo(preset: Preset, world?: World): void {
    this.cell = preset.cell
    this.pos = { ...preset.pos }
    this.forward = normalize(preset.forward)
    // Une téléportation n'a parcouru aucun chemin : sa verticale ne peut pas être
    // transportée, elle doit être lue sur place. Dans un tube vrillé, la verticale du
    // monde n'a aucun sens.
    const cell = world?.cells.get(preset.cell)
    this.up = cell ? localUp(cell, this.pos, v3(0, 1, 0)) : v3(0, 1, 0)
    this.vertical = 0
    this.grounded = false
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
    // La gravité s'applique d'abord, et **à chaque image**, y compris à l'arrêt.
    // C'est ce qui maintient `grounded` : le petit déplacement vers le bas est
    // rattrapé par la résolution de collision, qui signale le sol. Tester
    // l'appui au sol séparément demanderait un second sondage, et le drapeau
    // clignoterait d'une image sur l'autre — de quoi rendre le saut capricieux.
    if (this.grounded && (keys.has('Space') || keys.has('KeyE'))) {
      this.vertical = JUMP_SPEED
      this.grounded = false
    }
    this.vertical = Math.max(this.vertical - GRAVITY * dt, -MAX_FALL)

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

    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT : WALK
    const horizontal =
      ax === 0 && az === 0
        ? { x: 0, y: 0, z: 0 }
        : scale(normalize(add(scale(fwdH, az), scale(rightH, ax))), speed * dt)

    // Un seul déplacement, horizontal et vertical réunis : c'est ce qui permet à un
    // saut en diagonale de franchir une porte correctement, le découpage en sous-pas
    // traitant les deux composantes ensemble.
    this.move(world, add(horizontal, scale(this.up, this.vertical * dt)))
  }

  /**
   * Avance de `metres` dans la direction du regard, projetée à l'horizontale.
   *
   * Sert au balayage du franchissement : pour mesurer une transition, il faut la
   * parcourir par le même chemin que le visiteur, et non téléporter l'œil de part
   * et d'autre. Une position au-delà d'une couture mais déclarée dans la cellule de
   * départ est un état que le jeu ne produit jamais — la mesurer ne dit rien.
   */
  walk(world: World, metres: number): void {
    let fwdH = sub(this.forward, scale(this.up, dot(this.forward, this.up)))
    if (len(fwdH) < 1e-4) fwdH = cross(this.up, this.right())
    this.move(world, scale(normalize(fwdH), metres))
  }

  /** Oriente le regard sans bouger, en conservant la verticale locale. */
  face(direction: Vec3): void {
    this.forward = normalize(direction)
    this.renormalise()
  }

  private move(world: World, delta: Vec3): void {
    if (len(delta) < 1e-12) return

    let landed = false
    let bumped = false

    // La direction du regard et la verticale locale voyagent avec le corps.
    const carried = [this.forward, this.up]
    const result = advance(world, this.cell, this.pos, delta, carried, (cell, p) => {
      const resolved = resolveAgainstCell(cell, p, BODY)
      if (resolved.floor) landed = true
      if (resolved.ceiling) bumped = true
      return resolved.pos
    })
    this.forward = carried[0]!
    this.up = carried[1]!
    this.cell = result.cell
    this.pos = result.pos
    this.crossings += result.crossings

    this.grounded = landed
    if (landed && this.vertical < 0) this.vertical = 0
    if (bumped && this.vertical > 0) this.vertical = 0

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
