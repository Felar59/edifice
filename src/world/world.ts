/**
 * Le monde de l'étape 1 : **deux pièces, deux coutures.**
 *
 * Deux, et pas une, volontairement. Avec une seule couture on ne teste que le
 * cas facile : la bouche de sortie est derrière la caméra virtuelle, donc jamais
 * visible, donc aucune récursion. En reliant les deux parois opposées de chaque
 * pièce, on obtient un couloir **infini** qui alterne les deux salles — c'est le
 * cas le plus dur du rendu de portails, et il vaut mieux l'avoir sous les yeux
 * dès le premier jour que le découvrir plus tard.
 *
 * Les deux pièces sont volontairement dissemblables :
 *   — tailles différentes (10 × 4 × 10 contre 16 × 8 × 16), donc une pièce plus
 *     grande dedans que dehors, gratuitement ;
 *   — altitudes différentes ;
 *   — éloignées de trente mètres et pivotées d'un quart de tour, pour qu'aucune
 *     coïncidence de position ne puisse masquer une erreur de transformation.
 */

import type { F32 } from '../f32'
import { create, fromBasis, invertRigid, multiply, type Mat4 } from '../math/mat4'
import { add, cross, neg, scale, type Vec3 } from '../math/vec3'
import { buildRoom, pushWall, type Color, type Hole } from './geometry'
import type { Cell, Mouth, Passage, World } from './types'

const DOOR_HALF_W = 0.9
const DOOR_HALF_H = 1.1

/**
 * Épaisseur de la paroi à l'endroit d'une porte, et donc profondeur de
 * l'embrasure.
 *
 * Ce n'est pas une coquetterie d'architecte : c'est ce qui supprime la dernière
 * zone grise du franchissement. Avec des parois sans épaisseur, l'œil passe à
 * quelques millimètres d'un mur — donc plus près que le plan proche, donc le mur
 * est intégralement écrêté. Et comme rien ne se trouve derrière lui, toute la zone
 * qu'il occupait à l'écran devient la couleur d'effacement.
 *
 * Avec une embrasure, la surface la plus proche pendant toute la traversée est un
 * jambage, à des dizaines de centimètres. Plus rien n'entre dans le plan proche.
 *
 * Le plan de la couture est posé au **fond** de l'embrasure : on avance dans un
 * court tunnel, et c'est en son extrémité qu'on change de cellule.
 */
const REVEAL = 0.25

/** Repère d'une bouche, colonnes (right, up, normal, centre). */
function mouthFrame(m: Mouth): Mat4 {
  return fromBasis(create(), m.right, m.up, m.normal, m.center)
}

/**
 * Repère de la bouche de sortie, retourné d'un demi-tour autour de son axe
 * vertical. C'est ce demi-tour qui fait qu'on **sort** de la seconde bouche au
 * lieu d'y entrer : franchir une porte, ce n'est pas apparaître collé contre son
 * dos.
 */
function mouthFrameFlipped(m: Mouth): Mat4 {
  return fromBasis(create(), neg(m.right), m.up, neg(m.normal), m.center)
}

/** T = F_to · demi-tour · F_from⁻¹ */
function passageTransform(from: Mouth, to: Mouth): Mat4 {
  const inv = invertRigid(create(), mouthFrame(from))
  return multiply(create(), mouthFrameFlipped(to), inv)
}

function makePassages(a: Mouth, b: Mouth): [Passage, Passage] {
  return [
    { from: a, to: b, transform: passageTransform(a, b) },
    { from: b, to: a, transform: passageTransform(b, a) },
  ]
}

/**
 * Les quatre jambages de l'embrasure : un court tunnel qui va de la face
 * intérieure de la paroi jusqu'au plan de la couture, au fond.
 *
 * Ils remplacent l'encadrement peint qui décorait l'ouverture auparavant. C'est
 * deux gains pour le même travail : un vrai relief donne un bord net, ce dont on
 * a besoin pour juger à l'œil l'alignement de l'image vue à travers la couture ;
 * et cela supprime la seule géométrie coplanaire de la scène, ce qui permet de
 * rapprocher le plan proche sans craindre le conflit de profondeur.
 */
function pushReveal(out: number[], m: Mouth, color: Color): void {
  const w = m.halfWidth
  const h = m.halfHeight
  const R = m.right
  const U = m.up
  // Face intérieure de la paroi : l'embrasure s'enfonce de là vers la couture.
  const face = add(m.center, scale(m.normal, REVEAL))
  const depth = scale(m.normal, -REVEAL)
  const corner = (s: number, t: number): Vec3 => add(add(face, scale(R, s)), scale(U, t))

  // L'orientation de chaque jambage est choisie pour que sa normale regarde vers
  // l'intérieur du tunnel — sinon le tri des faces arrière le rend invisible.
  const faces: { origin: Vec3; right: Vec3; up: Vec3 }[] = [
    { origin: corner(-w, -h), right: depth, up: scale(U, 2 * h) },        // jambage gauche
    { origin: corner(w, -h), right: scale(U, 2 * h), up: depth },         // jambage droit
    { origin: corner(-w, h), right: depth, up: scale(R, 2 * w) },         // linteau
    { origin: corner(-w, -h), right: scale(R, 2 * w), up: depth },        // seuil
  ]
  for (const f of faces) pushWall(out, { origin: f.origin, right: f.right, up: f.up, color })
}

/**
 * Le trou à percer dans la paroi.
 *
 * Il est sur la **face intérieure**, alors que la bouche de la couture est au fond
 * de l'embrasure : il faut donc revenir de la profondeur de l'embrasure.
 */
function holeOf(m: Mouth): Hole {
  return {
    center: add(m.center, scale(m.normal, REVEAL)),
    halfWidth: m.halfWidth,
    halfHeight: m.halfHeight,
  }
}

export function buildWorld(): World {
  // --- Cellule « hall » : petite, claire, à échelle humaine. ----------------
  const hallMin: Vec3 = { x: -5, y: 0, z: -5 }
  const hallMax: Vec3 = { x: 5, y: 4, z: 5 }

  // Chaque bouche est au fond de son embrasure, donc en retrait de la face
  // intérieure de la paroi — vers l'extérieur de la pièce, à l'opposé de sa normale.
  const hallNorth: Mouth = {
    id: 'hall.nord',
    cell: 'hall',
    center: { x: 0, y: DOOR_HALF_H, z: hallMin.z - REVEAL },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    halfWidth: DOOR_HALF_W,
    halfHeight: DOOR_HALF_H,
  }
  const hallSouth: Mouth = {
    id: 'hall.sud',
    cell: 'hall',
    center: { x: 0, y: DOOR_HALF_H, z: hallMax.z + REVEAL },
    right: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: -1 },
    halfWidth: DOOR_HALF_W,
    halfHeight: DOOR_HALF_H,
  }

  // --- Cellule « salle » : plus grande, plus basse, plus froide. ------------
  const salleMin: Vec3 = { x: 30, y: -1.5, z: 20 }
  const salleMax: Vec3 = { x: 46, y: 6.5, z: 36 }
  const salleDoorY = salleMin.y + DOOR_HALF_H

  const salleWest: Mouth = {
    id: 'salle.ouest',
    cell: 'salle',
    center: { x: salleMin.x - REVEAL, y: salleDoorY, z: 28 },
    right: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    halfWidth: DOOR_HALF_W,
    halfHeight: DOOR_HALF_H,
  }
  const salleEast: Mouth = {
    id: 'salle.est',
    cell: 'salle',
    center: { x: salleMax.x + REVEAL, y: salleDoorY, z: 28 },
    right: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    normal: { x: -1, y: 0, z: 0 },
    halfWidth: DOOR_HALF_W,
    halfHeight: DOOR_HALF_H,
  }

  // Vérification silencieuse mais utile : un repère de bouche doit être direct,
  // sinon la transformation retourne l'image sans que rien ne le signale.
  for (const m of [hallNorth, hallSouth, salleWest, salleEast]) {
    const n = cross(m.right, m.up)
    const err = Math.abs(n.x - m.normal.x) + Math.abs(n.y - m.normal.y) + Math.abs(n.z - m.normal.z)
    if (err > 1e-6) throw new Error(`Repère de bouche indirect sur ${m.id} (right × up ≠ normal)`)
  }

  const [hallNorthToSalle, salleWestToHall] = makePassages(hallNorth, salleWest)
  const [hallSouthToSalle, salleEastToHall] = makePassages(hallSouth, salleEast)

  const accent: Color = [0.62, 0.36, 0.2]

  const hallVerts = buildRoom(
    hallMin,
    hallMax,
    { floor: [0.3, 0.29, 0.27], ceiling: [0.42, 0.41, 0.39], wall: [0.55, 0.53, 0.5] },
    { north: holeOf(hallNorth), south: holeOf(hallSouth) },
  )
  const salleVerts = buildRoom(
    salleMin,
    salleMax,
    { floor: [0.24, 0.25, 0.28], ceiling: [0.34, 0.36, 0.4], wall: [0.44, 0.46, 0.5] },
    { west: holeOf(salleWest), east: holeOf(salleEast) },
  )

  const hallExtra: number[] = []
  pushReveal(hallExtra, hallNorth, accent)
  pushReveal(hallExtra, hallSouth, accent)
  const salleExtra: number[] = []
  pushReveal(salleExtra, salleWest, accent)
  pushReveal(salleExtra, salleEast, accent)

  const hall: Cell = {
    id: 'hall',
    min: hallMin,
    max: hallMax,
    verts: concat(hallVerts, hallExtra),
    passages: [hallNorthToSalle, hallSouthToSalle],
  }
  const salle: Cell = {
    id: 'salle',
    min: salleMin,
    max: salleMax,
    verts: concat(salleVerts, salleExtra),
    passages: [salleWestToHall, salleEastToHall],
  }

  return { cells: new Map([[hall.id, hall], [salle.id, salle]]) }
}

function concat(a: F32, b: number[]): F32 {
  const out = new Float32Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
