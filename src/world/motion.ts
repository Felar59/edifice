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
import { frameAt, toLocal, toWorld, transport, transportAngle } from './twist'
import { ceilingHeight, rampHeight } from './spiral'
import type { Block, Cell, Mouth, Passage, World } from './types'

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

/**
 * Le volume d'un corps, décrit **relativement à son point de référence** — l'œil pour
 * le visiteur, le centre pour un cube.
 *
 * Un point suffisait tant que rien ne montait ni ne descendait. Dès qu'on saute, il
 * faut un volume : c'est le crâne qui heurte le linteau, et ce sont les pieds qui
 * touchent le sol. Sans cette hauteur, on entrerait dans une porte en pleine détente,
 * la tête dans le mur.
 */
export interface Body {
  /** Demi-largeur horizontale. */
  radius: number
  /** Distance du point de référence aux pieds. */
  eyeHeight: number
  /** Distance du point de référence au sommet du crâne. */
  headroom: number
  /**
   * La verticale du corps — celle qui va de ses pieds vers son crâne.
   *
   * Un corps n'a plus de haut absolu depuis qu'une salle peut avoir six sols. Elle vaut
   * (0, 1, 0) partout ailleurs, et le chemin de collision ordinaire n'en tient donc aucun
   * compte : c'est la salle qui décide si la question se pose.
   */
  up: Vec3
}

/** Ce que la résolution de collision a rencontré, en plus de la position corrigée. */
export interface Resolved {
  pos: Vec3
  /** Les pieds ont touché le sol de la cellule. */
  floor: boolean
  /** Le crâne a touché le plafond. */
  ceiling: boolean
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

    // Dans un tube vrillé, le pas est exprimé dans le **repère local**, pas dans celui
    // du monde.
    //
    // Marcher en ligne droite dans le monde à travers un tube qui tourne dérive
    // latéralement dans le repère du tube : les coordonnées locales d'un déplacement
    // rectiligne tournent à mesure que le repère tourne. On finissait plaqué contre une
    // paroi au bout de deux allers-retours, hors d'atteinte de la porte.
    //
    // Marcher droit dans un couloir, c'est augmenter l'abscisse le long de l'axe sans
    // changer sa place dans la section. Ce qui décrit une hélice dans le monde — et
    // c'est bien ce qu'on fait quand on suit un couloir qui vrille.
    const candidate = cell.twist
      ? (() => {
          const local = toLocal(cell.twist, current)
          const frame = frameAt(cell.twist, local.s)
          return toWorld(cell.twist, {
            s: local.s + dot(seg, cell.twist.axis),
            u: local.u + dot(seg, frame.right),
            v: local.v + dot(seg, frame.up),
          })
        })()
      : add(current, seg)

    const next = resolve(cell, candidate)

    // Dans un tube vrillé, tout ce qui est attaché au corps tourne avec le repère
    // local, d'un angle proportionnel au chemin parcouru le long de l'axe.
    //
    // Appliqué à chaque sous-pas — donc tous les quatre centimètres — c'est un dixième
    // de degré : imperceptible sur le coup, décisif au bout du tunnel. Et c'est bien
    // une rotation continue, jamais un saut : c'est pour cela qu'on ne sent rien.
    //
    // Le reste du déplacement tourne aussi. Sans quoi, en marchant de côté, on suivrait
    // une droite du monde pendant que le tube pivote autour de soi.
    if (cell.twist) {
      const angle = transportAngle(
        cell.twist,
        toLocal(cell.twist, current).s,
        toLocal(cell.twist, next).s,
      )
      if (angle !== 0) {
        for (let k = 0; k < carried.length; k++) {
          carried[k] = transport(cell.twist, angle, carried[k]!)
        }
        remaining = transport(cell.twist, angle, remaining)
      }
    }

    current = next
    remaining = sub(remaining, seg)
  }

  return { cell: cell.id, pos: current, crossings }
}

/**
 * Collision contre la boîte de la cellule, avec une exception devant chaque ouverture
 * — sans quoi la paroi qui contient la porte arrêterait net celui qui cherche à la
 * franchir.
 *
 * L'exception n'est accordée que si le corps **passe** réellement par l'ouverture :
 * à sa demi-largeur moins le rayon près, et le crâne sous le linteau. C'est ce dernier
 * point qui fait qu'on ne franchit pas une porte en pleine détente, la tête dans le
 * mur — on se cogne, ce qui est le comportement attendu.
 */
export function resolveAgainstCell(cell: Cell, p: Vec3, body: Body): Resolved {
  if (cell.twist) return resolveInsideTube(cell, p, body)
  // Une salle aux six sols se résout autrement — sauf quand on s'y tient d'aplomb, où
  // elle est une pièce comme une autre. C'est ce qui fait que sa porte ne s'ouvre que
  // dans ce cas, et c'est voulu : voir `resolveOnFace`.
  if (cell.gravity && !upright(body.up)) return resolveOnFace(cell, p, body)
  const { radius } = body

  /**
   * Cette bouche perce-t-elle une **paroi de la pièce** ?
   *
   * La suite raisonne sur les quatre parois de la cellule et lève leur butée devant
   * chaque ouverture. Or toutes les bouches ne sont pas des portes : celle d'un coffre
   * posé au milieu de la salle, celle qui referme un escalier sur lui-même, ont bien une
   * normale horizontale mais ne percent aucun mur. Les prendre pour des portes lèverait
   * la butée de la paroi qui leur fait face, et l'on sortirait de la pièce par un mur
   * plein en s'alignant sur un objet situé quatre mètres avant. C'est arrivé.
   *
   * Le critère est géométrique et ne se laisse pas oublier : une porte est **au bord**,
   * au fond de l'embrasure qu'elle perce, donc hors de la boîte. Tout ce qui est au
   * milieu n'en est pas une.
   */
  const onTheHull = (m: Mouth): boolean => {
    const eps = 1e-3
    if (m.normal.x > 0.5) return m.center.x <= cell.min.x + eps
    if (m.normal.x < -0.5) return m.center.x >= cell.max.x - eps
    if (m.normal.z > 0.5) return m.center.z <= cell.min.z + eps
    if (m.normal.z < -0.5) return m.center.z >= cell.max.z - eps
    return false
  }

  // Le sol et le plafond **d'abord**, et c'est un ordre qui compte.
  //
  // Pendant un pas, la gravité fait descendre les pieds d'un cheveu sous le sol avant
  // que la collision ne les remonte. Juger la hauteur du corps sur cette position-là
  // revient à le croire enterré : le test « passe-t-il sous le linteau ? » concluait
  // que les pieds étaient sous le seuil, refusait le passage, et la paroi arrêtait net
  // quiconque marchait vers une porte. On marchait sur place, sans rien qui l'explique.
  let y = p.y
  let floor = false
  let ceiling = false

  const lowest = groundAt(cell, p) + body.eyeHeight
  // Le plafond d'un escalier tournant suit ses marches : la hauteur libre est partout la
  // même, sans quoi on sentirait le plafond s'éloigner d'un tour au passage du raccord.
  const highest = (cell.spiral ? ceilingHeight(cell.spiral, p) : cell.max.y) - body.headroom
  if (y <= lowest) {
    y = lowest
    floor = true
  }
  if (y >= highest) {
    y = highest
    ceiling = true
  }

  const feet = y - body.eyeHeight
  const head = y + body.headroom

  /** Le corps tient-il dans cette ouverture, en largeur comme en hauteur ? */
  const fits = (m: Mouth, lateral: number): boolean => {
    if (Math.abs(lateral - lateralCentre(m)) > m.halfWidth - radius) return false
    const bottom = m.center.y - m.halfHeight
    const top = m.center.y + m.halfHeight
    return feet >= bottom - 1e-4 && head <= top + 1e-4
  }

  let clampMinX = true
  let clampMaxX = true
  let clampMinZ = true
  let clampMaxZ = true

  for (const passage of cell.passages) {
    const m = passage.from
    if (!onTheHull(m)) continue
    if (Math.abs(m.normal.x) > 0.5) {
      if (fits(m, p.z)) {
        if (m.normal.x > 0) clampMinX = false
        else clampMaxX = false
      }
    } else if (Math.abs(m.normal.z) > 0.5) {
      if (fits(m, p.x)) {
        if (m.normal.z > 0) clampMinZ = false
        else clampMaxZ = false
      }
    }
  }

  // Filet de sécurité : même dans l'embrasure, on ne s'éloigne pas indéfiniment de la
  // cellule. Si la traversée échouait, le corps s'arrêterait au lieu de partir dans le
  // vide — un bug visible vaut mieux qu'un bug silencieux.
  const slack = 1.2
  let { x, z } = p
  x = Math.max(x, cell.min.x + (clampMinX ? radius : -slack))
  x = Math.min(x, cell.max.x - (clampMaxX ? radius : -slack))
  z = Math.max(z, cell.min.z + (clampMinZ ? radius : -slack))
  z = Math.min(z, cell.max.z - (clampMaxZ ? radius : -slack))

  // Une fois engagé dans une embrasure, on y reste : sans cette contrainte on pourrait
  // glisser latéralement et se retrouver dans l'épaisseur de la paroi, là où il n'y a
  // rien à voir.
  //
  // Encore faut-il savoir **de laquelle** il s'agit. Une première version appliquait la
  // contrainte de chaque bouche à la suite, ce qui allait tant qu'une paroi n'en portait
  // qu'une. Dès que la rotonde a eu deux portes sur le même mur, le corps engagé dans la
  // première se faisait happer devant la seconde : on partait vers une aile et on
  // arrivait dans une autre. On retient donc, par paroi, la bouche dont on est le plus
  // proche.
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
      if (!onTheHull(m) || !onThisFace(m)) continue
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

  // Puis ce qui est plein **au milieu** de la pièce, et qu'il faut contourner.
  let pos = { x, y, z }
  for (const block of cell.blocks ?? []) {
    const pushed = resolveAgainstBlock(block, pos, body)
    pos = pushed.pos
    if (pushed.floor) floor = true
  }

  // Le sol est signalé à l'appelant : c'est ce qui autorise à sauter.
  return { pos, floor, ceiling }
}

/**
 * Collision contre un bloc plein — l'inverse de tout le reste : on reste **dehors**.
 *
 * On sort par la face la plus proche, ce qui est la manière ordinaire de résoudre une
 * boîte et ce qui donne gratuitement le bon comportement dans les trois cas : on glisse
 * le long d'un côté, on se pose sur le dessus, et on ne se fait jamais éjecter vers le
 * bas — sortir par en dessous demande de descendre de toute la hauteur du corps plus
 * celle du bloc, donc cette issue-là n'est jamais la plus courte.
 *
 * L'exception de la porte suit celle des parois : on laisse entrer qui est aligné sur
 * l'ouverture et qui tient dessous. Dès qu'on cesse de l'être, l'embrasure n'est plus
 * profonde que de vingt-cinq centimètres et c'est donc elle, la sortie la plus proche —
 * on est reposé devant la porte plutôt qu'enfermé dans la matière.
 */
function resolveAgainstBlock(block: Block, p: Vec3, body: Body): { pos: Vec3; floor: boolean } {
  const r = body.radius
  const feet = p.y - body.eyeHeight
  const head = p.y + body.headroom

  // Le corps est ramené à son point de référence, et le bloc grossi d'autant : un
  // cylindre contre une boîte se traite comme un point contre une boîte élargie.
  const minX = block.min.x - r
  const maxX = block.max.x + r
  const minZ = block.min.z - r
  const maxZ = block.max.z + r

  if (p.x <= minX || p.x >= maxX) return { pos: p, floor: false }
  if (p.z <= minZ || p.z >= maxZ) return { pos: p, floor: false }
  if (head <= block.min.y || feet >= block.max.y) return { pos: p, floor: false }

  const door = block.door
  if (door && fitsThroughBlockDoor(door, p, feet, head, r)) {
    // Assez engagé pour que la couture prenne le relais. Reste un filet : si le
    // franchissement échouait, on s'arrête au fond de l'embrasure au lieu de disparaître
    // dans la matière. Un défaut visible vaut mieux qu'un défaut silencieux.
    const depth = dot(door.normal, sub(p, door.center))
    if (depth >= -0.6) return { pos: p, floor: false }
  }

  // Les quatre issues latérales, plus le dessus. La plus courte gagne.
  const exits: { distance: number; pos: Vec3; floor: boolean }[] = [
    { distance: p.x - minX, pos: { ...p, x: minX }, floor: false },
    { distance: maxX - p.x, pos: { ...p, x: maxX }, floor: false },
    { distance: p.z - minZ, pos: { ...p, z: minZ }, floor: false },
    { distance: maxZ - p.z, pos: { ...p, z: maxZ }, floor: false },
    {
      distance: block.max.y - feet,
      pos: { ...p, y: block.max.y + body.eyeHeight },
      floor: true,
    },
  ]

  let best = exits[0]!
  for (const exit of exits) if (exit.distance < best.distance) best = exit
  return { pos: best.pos, floor: best.floor }
}

/** Le corps tient-il dans la porte d'un bloc, en largeur comme en hauteur ? */
function fitsThroughBlockDoor(
  door: Mouth,
  p: Vec3,
  feet: number,
  head: number,
  radius: number,
): boolean {
  const rel = sub(p, door.center)
  if (Math.abs(dot(rel, door.right)) > door.halfWidth - radius) return false
  const bottom = door.center.y - door.halfHeight
  const top = door.center.y + door.halfHeight
  return feet >= bottom - 1e-4 && head <= top + 1e-4
}

/**
 * La hauteur du sol sous un point — le fond de la boîte d'ordinaire, la rampe de
 * l'escalier tournant quand la cellule en porte un.
 *
 * La rampe passe **au milieu** des marches dessinées : le corps flotte d'une demi-marche
 * au plus, ce qui ne se voit pas puisqu'on ne voit pas ses pieds, et il marche continûment
 * au lieu de monter par bonds à chaque nez de marche.
 */
export function groundAt(cell: Cell, p: Vec3): number {
  return cell.spiral ? rampHeight(cell.spiral, p) : cell.min.y
}

/** L'axe du monde le plus proche d'une direction, et de quel côté. */
function dominant(v: Vec3): { axis: 0 | 1 | 2; sign: 1 | -1 } {
  const c = [v.x, v.y, v.z]
  let axis: 0 | 1 | 2 = 0
  if (Math.abs(c[1]!) > Math.abs(c[axis]!)) axis = 1
  if (Math.abs(c[2]!) > Math.abs(c[axis]!)) axis = 2
  return { axis, sign: c[axis]! >= 0 ? 1 : -1 }
}

/** Le corps est-il debout au sens du monde ? */
function upright(up: Vec3): boolean {
  return up.y > 0.999
}

/**
 * Collision dans une salle dont les six faces sont habitables, quand on ne se tient pas
 * sur celle du bas.
 *
 * C'est la même résolution que d'ordinaire, à une permutation d'axes près : la face vers
 * laquelle on tombe reçoit la hauteur du corps — les pieds d'un côté, le crâne de
 * l'autre — et les deux axes restants reçoivent son rayon. Rien de plus : une pièce
 * cubique se traite comme une pièce droite dès qu'on accepte que « le bas » soit un
 * paramètre.
 *
 * **Aucune exception d'ouverture ici, et ce n'est pas un oubli.** Les portes ne
 * s'ouvrent que pour qui se tient d'aplomb. Une couture est une transformation rigide :
 * elle emporte le repère du visiteur tel quel, si bien que sortir en se tenant sur un mur
 * ferait arriver dans la rotonde couché sur le côté, avec une gravité horizontale et rien
 * sous les pieds. Refuser est la seule réponse honnête — et la salle s'en charge
 * elle-même, puisque sa porte est au ras d'une arête : qui s'en approche entre dans la
 * bande d'accroche, bascule sur le sol du bas, et se retrouve debout devant elle.
 */
function resolveOnFace(cell: Cell, p: Vec3, body: Body): Resolved {
  const { axis, sign } = dominant(body.up)
  const min = [cell.min.x, cell.min.y, cell.min.z]
  const max = [cell.max.x, cell.max.y, cell.max.z]
  const c = [p.x, p.y, p.z]

  // Le sol est la face vers laquelle on tombe, donc celle que la verticale du corps fuit.
  const ground = sign > 0 ? min[axis]! : max[axis]!
  const above = sign > 0 ? max[axis]! : min[axis]!

  let floor = false
  let ceiling = false
  if ((c[axis]! - ground) * sign <= body.eyeHeight) {
    c[axis] = ground + sign * body.eyeHeight
    floor = true
  }
  if ((above - c[axis]!) * sign <= body.headroom) {
    c[axis] = above - sign * body.headroom
    ceiling = true
  }

  for (const k of [0, 1, 2]) {
    if (k === axis) continue
    c[k] = Math.min(Math.max(c[k]!, min[k]! + body.radius), max[k]! - body.radius)
  }

  return { pos: { x: c[0]!, y: c[1]!, z: c[2]! }, floor, ceiling }
}

/**
 * La face qui doit devenir le sol, si le pas engagé fait entrer dans une bande
 * d'accroche — ou `null` s'il n'y a pas lieu de basculer.
 *
 * La bascule ne coûte **aucun déplacement**, et c'est toute la finesse du réglage. On la
 * déclenche à l'instant où le corps arrive à une hauteur d'œil de la face voisine, ce qui
 * est exactement la distance à laquelle il se tiendra debout dessus. Le corps est donc
 * déjà en place : il ne reste qu'à faire tourner son repère. Déclencher plus tôt ou plus
 * tard obligerait à le déplacer d'autant, et l'à-coup se verrait.
 *
 * Il faut être posé, et marcher vers la face en question. On ne bascule pas en l'air, et
 * on ne bascule pas en frôlant : c'est un geste, pas un accident.
 */
export function faceChange(cell: Cell, p: Vec3, up: Vec3, wish: Vec3, body: Body): Vec3 | null {
  if (!cell.gravity) return null

  const { axis } = dominant(up)
  const min = [cell.min.x, cell.min.y, cell.min.z]
  const max = [cell.max.x, cell.max.y, cell.max.z]
  const at = [p.x, p.y, p.z]
  const toward = [wish.x, wish.y, wish.z]

  let best: { gap: number; axis: number; sign: number } | null = null
  for (const k of [0, 1, 2]) {
    if (k === axis) continue
    for (const side of [-1, 1]) {
      // On ne bascule que vers une face qu'on aborde franchement.
      if (toward[k]! * side < 0.1) continue
      const gap = side > 0 ? max[k]! - at[k]! : at[k]! - min[k]!
      if (gap > body.eyeHeight) continue
      // **Et pas devant une porte : on entre.** Sans cette clause, la bande d'accroche
      // fait grimper le mur juste avant qu'on atteigne l'ouverture, et la salle n'a plus
      // de sortie du tout — on tourne indéfiniment autour du cube. C'était le cas.
      if (facingADoor(cell, p, k, -side, body)) continue
      if (!best || gap < best.gap) best = { gap, axis: k, sign: -side }
    }
  }
  if (!best) return null

  // La nouvelle verticale sort de la face abordée, vers l'intérieur de la salle.
  const v = [0, 0, 0]
  v[best.axis] = best.sign
  return { x: v[0]!, y: v[1]!, z: v[2]! }
}

/**
 * Le corps est-il en face d'une ouverture percée dans la paroi visée ?
 *
 * On mesure sur le rectangle de la bouche, élargi du rayon du corps : il ne s'agit pas de
 * savoir si l'on passera, mais si l'on est en train d'y aller. Se retrouver couché sur un
 * mur à quinze centimètres du chambranle qu'on visait serait la pire des réponses.
 */
function facingADoor(cell: Cell, p: Vec3, axis: number, sign: number, body: Body): boolean {
  for (const passage of cell.passages) {
    const m = passage.from
    const n = [m.normal.x, m.normal.y, m.normal.z]
    if (Math.abs(n[axis]!) < 0.5 || Math.sign(n[axis]!) !== sign) continue

    const rel = sub(p, m.center)
    if (Math.abs(dot(rel, m.right)) > m.halfWidth + body.radius) continue
    if (Math.abs(dot(rel, m.up)) > m.halfHeight + body.radius) continue
    return true
  }
  return false
}

/**
 * La direction du bas, à un endroit donné d'une cellule.
 *
 * Pour une salle aux six sols, c'est la face dont on est le plus près — la règle qui vaut
 * pour ce qui n'a pas de tête : un cube lancé tombe vers la paroi la plus proche, ce qui
 * donne, sans code de plus, des objets qui s'accumulent sur les six faces.
 */
export function downAt(cell: Cell, p: Vec3): Vec3 {
  return underfoot(cell, p).down
}

/** Distance à la paroi vers laquelle on tombe. Zéro quand on la touche. */
export function faceGap(cell: Cell, p: Vec3): number {
  return underfoot(cell, p).gap
}

function underfoot(cell: Cell, p: Vec3): { down: Vec3; gap: number } {
  if (!cell.gravity) return { down: { x: 0, y: -1, z: 0 }, gap: p.y - cell.min.y }

  const min = [cell.min.x, cell.min.y, cell.min.z]
  const max = [cell.max.x, cell.max.y, cell.max.z]
  const at = [p.x, p.y, p.z]

  let axis = 0
  let sign = -1
  let gap = Infinity
  for (const k of [0, 1, 2]) {
    for (const side of [-1, 1]) {
      const distance = side > 0 ? max[k]! - at[k]! : at[k]! - min[k]!
      if (distance < gap) {
        gap = distance
        axis = k
        sign = side
      }
    }
  }
  const v = [0, 0, 0]
  v[axis] = sign
  return { down: { x: v[0]!, y: v[1]!, z: v[2]! }, gap }
}

/** L'abscisse d'une bouche le long de sa paroi. */
function lateralCentre(m: Mouth): number {
  return Math.abs(m.normal.x) > 0.5 ? m.center.z : m.center.x
}

/**
 * Collision dans un tube vrillé : on redresse, on résout, on retord.
 *
 * Tout le travail se fait dans le repère qui suit la vrille, où le tube redevient une
 * boîte droite. C'est ce qui permet de garder une résolution simple malgré une
 * géométrie qui se tord : la difficulté est absorbée par le changement de repère, pas
 * par le code de collision.
 */
function resolveInsideTube(cell: Cell, p: Vec3, body: Body): Resolved {
  const twist = cell.twist!
  const h = twist.halfSize
  const local = toLocal(twist, p)

  // La hauteur d'abord, comme dans une pièce droite, et pour la même raison : juger la
  // taille du corps sur une position non résolue le croirait enterré.
  let v = local.v
  let floor = false
  let ceiling = false
  const lowest = -h + body.eyeHeight
  const highest = h - body.headroom
  if (v <= lowest) {
    v = lowest
    floor = true
  }
  if (v >= highest) {
    v = highest
    ceiling = true
  }

  const feet = v - body.eyeHeight
  const head = v + body.headroom
  let u = Math.min(Math.max(local.u, -h + body.radius), h - body.radius)

  // Les deux bouts du tube, avec l'exception devant chaque porte.
  let s = local.s
  let openAtStart = false
  let openAtEnd = false

  for (const passage of cell.passages) {
    const m = passage.from
    const door = toLocal(twist, m.center)
    if (Math.abs(u - door.u) > m.halfWidth - body.radius) continue
    if (feet < door.v - m.halfHeight - 1e-4) continue
    if (head > door.v + m.halfHeight + 1e-4) continue

    // La normale d'une bouche de tube regarde vers l'intérieur : le long de l'axe à
    // l'entrée, à contresens à la sortie.
    if (dot(m.normal, twist.axis) > 0) openAtStart = true
    else openAtEnd = true
  }

  const slack = 1.2
  s = Math.max(s, openAtStart ? -slack : body.radius)
  s = Math.min(s, openAtEnd ? twist.length + slack : twist.length - body.radius)

  return { pos: toWorld(twist, { s, u, v }), floor, ceiling }
}

/**
 * La verticale locale à un endroit donné d'une cellule.
 *
 * Dans une pièce droite c'est celle qu'on transporte ; dans un tube vrillé elle se
 * déduit de la position. Sert à replacer proprement un visiteur téléporté, dont les
 * directions ne viennent d'aucun trajet.
 */
export function localUp(cell: Cell, p: Vec3, fallback: Vec3): Vec3 {
  if (!cell.twist) return fallback
  return frameAt(cell.twist, toLocal(cell.twist, p).s).up
}
