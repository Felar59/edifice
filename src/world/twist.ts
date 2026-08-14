/**
 * Le tunnel-vrille : un couloir dont la section pivote autour de l'axe de marche.
 *
 * On y entre normalement. Au fil des mètres, la section tourne — et la gravité avec
 * elle. On ne saute pas, on ne tombe pas, on ne sent aucune transition : on marche
 * tranquillement, et au bout du tunnel le sol de l'entrée est devenu le mur de gauche.
 * En se retournant, on voit la porte d'entrée **couchée sur le côté**.
 *
 * ## Pourquoi une cellule spéciale, et pas trente cellules pivotées
 *
 * L'espace cousu sait déjà faire tourner un repère : c'est exactement ce que fait une
 * couture. Découper le tunnel en trente segments reliés par des coutures de trois
 * degrés aurait donc marché sans une ligne de moteur en plus.
 *
 * Sauf au rendu. Regarder le tunnel dans sa longueur demanderait trente niveaux de
 * récursion de portails, chacun une passe plein écran. C'est hors de question. Le
 * tunnel est donc **une seule cellule**, dont le repère est une fonction continue de
 * la distance parcourue.
 *
 * ## Ce qui tourne, et ce qui ne tourne pas
 *
 * La position ne tourne pas : elle vit dans le repère du monde, et la géométrie est
 * construite vrillée. Marcher tout droit le long de l'axe est donc un déplacement
 * rectiligne ordinaire.
 *
 * Ce qui tourne, ce sont les **directions attachées au visiteur** — son regard, sa
 * verticale locale, sa vitesse — et elles tournent d'un petit angle à chaque sous-pas,
 * proportionnel au chemin parcouru le long de l'axe. C'est ce qui fait qu'on ne sent
 * rien : il n'y a jamais de saut, seulement une rotation continue trop lente pour être
 * perçue autrement que par ses conséquences.
 *
 * Traiter le regard autrement serait une erreur qui se verrait tout de suite. Si seule
 * la verticale tournait, l'angle entre le regard et le haut changerait au fil de la
 * marche : on avancerait tout droit et l'image piquerait lentement du nez.
 */

import { cross, dot, normalize, rotateAxis, scale, sub, type Vec3 } from '../math/vec3'

export interface Twist {
  /** Centre de la section d'entrée. */
  origin: Vec3
  /** Direction de l'axe, unitaire. */
  axis: Vec3
  /** Longueur du tube, le long de l'axe. */
  length: number
  /** Demi-côté de la section carrée. */
  halfSize: number
  /** Angle total de la vrille, en radians, réparti uniformément sur la longueur. */
  turn: number
  /** Repère de référence à l'entrée : le côté et le haut, perpendiculaires à l'axe. */
  right0: Vec3
  up0: Vec3
}

/** Coordonnées dans le repère qui suit la vrille. */
export interface Local {
  /** Distance parcourue le long de l'axe. */
  s: number
  /** Écart latéral, dans le repère tourné. */
  u: number
  /** Écart vertical, dans le repère tourné. */
  v: number
}

/**
 * L'angle de vrille atteint à une distance donnée.
 *
 * Borné aux deux extrémités : au-delà du tube, l'angle cesse d'évoluer.
 *
 * Ce n'est pas une précaution mais une nécessité. Les bouches des coutures sont posées
 * au fond de leur embrasure, donc **en retrait** des extrémités du tube, alors que leur
 * repère est celui de la section qu'elles ferment — c'est ce qui fait coïncider
 * l'embrasure et la paroi qu'elle perce. Sans ce bornage, la vrille continuerait dans
 * l'embrasure et le visiteur y accumulerait un degré et quart de plus que la bouche ne
 * le prévoit. La couture emporterait ce décalage dans la rotonde, où l'on se
 * retrouverait debout de travers — et un peu plus à chaque tour.
 */
export function angleAt(twist: Twist, s: number): number {
  const clamped = Math.min(Math.max(s, 0), twist.length)
  return (twist.turn * clamped) / twist.length
}

/** Le repère local à une distance donnée. */
export function frameAt(twist: Twist, s: number): { right: Vec3; up: Vec3 } {
  const angle = angleAt(twist, s)
  return {
    right: rotateAxis(twist.right0, twist.axis, angle),
    up: rotateAxis(twist.up0, twist.axis, angle),
  }
}

/** Du monde vers le repère qui suit la vrille. */
export function toLocal(twist: Twist, p: Vec3): Local {
  const rel = sub(p, twist.origin)
  const s = dot(rel, twist.axis)
  const { right, up } = frameAt(twist, s)
  return { s, u: dot(rel, right), v: dot(rel, up) }
}

/** Et retour. */
export function toWorld(twist: Twist, local: Local): Vec3 {
  const { right, up } = frameAt(twist, local.s)
  const p = { ...twist.origin }
  p.x += twist.axis.x * local.s + right.x * local.u + up.x * local.v
  p.y += twist.axis.y * local.s + right.y * local.u + up.y * local.v
  p.z += twist.axis.z * local.s + right.z * local.u + up.z * local.v
  return p
}

/**
 * La rotation à appliquer aux directions du visiteur quand il passe de `from` à `to`
 * le long de l'axe.
 *
 * C'est le cœur de l'effet. Appliquée à chaque sous-pas — donc tous les quatre
 * centimètres — elle est de l'ordre du dixième de degré : imperceptible sur le coup,
 * décisive au bout du tunnel.
 */
export function transportAngle(twist: Twist, from: number, to: number): number {
  return angleAt(twist, to) - angleAt(twist, from)
}

/** Fait tourner un vecteur de l'angle de vrille parcouru. */
export function transport(twist: Twist, angle: number, v: Vec3): Vec3 {
  return rotateAxis(v, twist.axis, angle)
}

/**
 * Construit une vrille à partir de son entrée et de sa direction.
 *
 * `up0` est redressé pour être perpendiculaire à l'axe : une base qui ne l'est pas
 * fausserait tout le reste en silence, et c'est le genre d'erreur qu'on met des heures
 * à retrouver.
 */
export function makeTwist(spec: {
  origin: Vec3
  axis: Vec3
  length: number
  halfSize: number
  turn: number
  up0: Vec3
}): Twist {
  const axis = normalize(spec.axis)
  const up0 = normalize(sub(spec.up0, scale(axis, dot(spec.up0, axis))))
  const right0 = cross(up0, axis)
  return { origin: spec.origin, axis, length: spec.length, halfSize: spec.halfSize, turn: spec.turn, right0, up0 }
}
