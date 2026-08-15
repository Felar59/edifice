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
import { arcAt, frameAt, setVisitor, toLocal, toWorld, transport, transportAngle } from './twist'
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
 *
 * `anchor` désigne le corps qui **fait autorité sur la vrille** — le visiteur, et lui
 * seul. Un cube lancé traverse le tunnel sans rien y changer.
 */
export function advance(
  world: World,
  cellId: string,
  pos: Vec3,
  delta: Vec3,
  carried: Vec3[],
  resolve: (cell: Cell, p: Vec3) => Vec3,
  anchor = false,
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
          // La vrille suit le visiteur **sous-pas par sous-pas**, avant qu'on ne décompose
          // quoi que ce soit dans son repère.
          //
          // Ne la mettre à jour qu'une fois par image semblait suffire — le retard vaut
          // alors un pas d'image, soit un centième de degré. Mais ce retard est
          // systématique, toujours du même côté, et il ne se voit pas dans l'angle : il
          // s'intègre. Le pas est décomposé dans un repère qui traîne derrière celui que
          // porte le visiteur, si bien qu'à chaque image il part de quelques dixièmes de
          // millimètre en travers. Sur la longueur du tunnel cela faisait cinquante-cinq
          // centimètres de déport, assez pour ne plus tenir dans la porte de sortie et
          // rester enfermé dedans.
          if (anchor) setVisitor(cell.twist, arcAt(cell.twist, current))

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
  const { radius } = body

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

  const lowest = cell.min.y + body.eyeHeight
  const highest = cell.max.y - body.headroom
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

  // Le sol est signalé à l'appelant : c'est ce qui autorise à sauter.
  return { pos: { x, y, z }, floor, ceiling }
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
