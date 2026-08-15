/**
 * Le monde : **une rotonde et ses ailes.**
 *
 * La rotonde est la pièce d'accueil, à échelle humaine, percée de huit portes. Chaque
 * porte mène à une aile réservée à une des tricheries géométriques du lot 2, et les
 * ailes sont pour l'instant **vides** — on les remplira une par une, chacune avec son
 * propre problème à résoudre.
 *
 * Deux points de conception valent d'être expliqués.
 *
 * **Les deux extrémités du tunnel donnent toutes deux sur la rotonde.** Ce n'est pas
 * une coquetterie : cela referme une boucle. On entre par la porte nord, on parcourt
 * les dix-huit mètres, on ressort par la porte sud — et on se retrouve face à la porte
 * nord. Le couloir n'a donc pas de fin, ce qui préserve le cas de récursion le plus
 * dur du rendu de portails, celui qu'il faut garder sous les yeux en permanence.
 *
 * **Les ailes sont éloignées de centaines de mètres les unes des autres, et de la
 * rotonde.** Aucune ne se touche dans l'espace du monde. Ce n'est pas de l'économie de
 * place mais une précaution de mise au point : si deux cellules étaient voisines, une
 * erreur de transformation de couture pourrait passer inaperçue, masquée par une
 * coïncidence de position. Ici, la moindre erreur envoie le visiteur dans le vide.
 *
 * Chaque aile a sa propre température de lumière. Vu du centre de la rotonde, on a donc
 * une couronne d'ouvertures de huit teintes différentes — ce qui n'est pas seulement
 * joli : c'est le meilleur contrôle visuel de l'éclairage traversant, huit fois répété.
 */

import type { F32 } from '../f32'
import { create, fromBasis, invertRigid, multiply, type Mat4 } from '../math/mat4'
import { add, cross, neg, scale, type Vec3 } from '../math/vec3'
import {
  buildRoom,
  pushTubeCap,
  pushTwistedTube,
  pushWall,
  type Color,
  type Hole,
  type RoomHoles,
  type RoomPalette,
  type TubePalette,
} from './geometry'
import { mouthRadiance, type CellLighting, type Colour } from './light'
import { arcAt, frameAt, makeTwist, setVisitor, takeVisitChange, toWorld } from './twist'
import type { Cell, Mouth, Passage, World } from './types'

const DOOR_HALF_W = 0.9
const DOOR_HALF_H = 1.1

/**
 * Épaisseur de la paroi à l'endroit d'une porte, et donc profondeur de l'embrasure.
 *
 * Ce n'est pas une coquetterie d'architecte : c'est ce qui supprime la dernière zone
 * grise du franchissement. Avec des parois sans épaisseur, l'œil passe à quelques
 * millimètres d'un mur — donc plus près que le plan proche, donc le mur est
 * intégralement écrêté. Et comme rien ne se trouve derrière lui, toute la zone qu'il
 * occupait à l'écran devient la couleur d'effacement.
 *
 * Avec une embrasure, la surface la plus proche pendant toute la traversée est un
 * jambage, à des dizaines de centimètres. Plus rien n'entre dans le plan proche.
 *
 * Le plan de la couture est posé au **fond** de l'embrasure : on avance dans un court
 * tunnel, et c'est en son extrémité qu'on change de cellule.
 */
const REVEAL = 0.25

/** Le nom de la pièce d'accueil, référencé par l'auto-test et les outils. */
export const HUB = 'rotonde'

type Wall = 'north' | 'south' | 'east' | 'west'

interface Box {
  min: Vec3
  max: Vec3
}

/**
 * Une bouche posée sur une paroi, au fond de son embrasure.
 *
 * Les repères sont choisis pour que `right × up = normal` dans les quatre cas, la
 * normale pointant vers l'intérieur de la pièce. Se tromper ici retourne l'image sans
 * que rien ne le signale, d'où la vérification à la fin de `buildWorld`.
 */
function mouth(cell: string, id: string, box: Box, wall: Wall, lateral: number): Mouth {
  const y = box.min.y + DOOR_HALF_H
  const common = {
    id,
    cell,
    halfWidth: DOOR_HALF_W,
    halfHeight: DOOR_HALF_H,
    up: { x: 0, y: 1, z: 0 },
  }

  switch (wall) {
    case 'north':
      return {
        ...common,
        center: { x: lateral, y, z: box.min.z - REVEAL },
        right: { x: 1, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
      }
    case 'south':
      return {
        ...common,
        center: { x: lateral, y, z: box.max.z + REVEAL },
        right: { x: -1, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: -1 },
      }
    case 'west':
      return {
        ...common,
        center: { x: box.min.x - REVEAL, y, z: lateral },
        right: { x: 0, y: 0, z: -1 },
        normal: { x: 1, y: 0, z: 0 },
      }
    case 'east':
      return {
        ...common,
        center: { x: box.max.x + REVEAL, y, z: lateral },
        right: { x: 0, y: 0, z: 1 },
        normal: { x: -1, y: 0, z: 0 },
      }
  }
}

/** Repère d'une bouche, colonnes (right, up, normal, centre). */
function mouthFrame(m: Mouth): Mat4 {
  return fromBasis(create(), m.right, m.up, m.normal, m.center)
}

/**
 * Repère de la bouche de sortie, retourné d'un demi-tour autour de son axe vertical.
 * C'est ce demi-tour qui fait qu'on **sort** de la seconde bouche au lieu d'y entrer :
 * franchir une porte, ce n'est pas apparaître collé contre son dos.
 */
function mouthFrameFlipped(m: Mouth): Mat4 {
  return fromBasis(create(), neg(m.right), m.up, neg(m.normal), m.center)
}

/** T = F_to · demi-tour · F_from⁻¹ */
function passageTransform(from: Mouth, to: Mouth): Mat4 {
  return multiply(create(), mouthFrameFlipped(to), invertRigid(create(), mouthFrame(from)))
}

/**
 * Les deux sens d'une même couture.
 *
 * Chacun porte la lumière de la pièce vers laquelle il mène. C'est ce qui fait qu'on
 * voit la teinte de la pièce voisine se déposer au sol devant sa porte.
 */
function makePassages(
  a: Mouth,
  aLighting: CellLighting,
  b: Mouth,
  bLighting: CellLighting,
): [Passage, Passage] {
  return [
    { from: a, to: b, transform: passageTransform(a, b), radiance: mouthRadiance(b, bLighting) },
    { from: b, to: a, transform: passageTransform(b, a), radiance: mouthRadiance(a, aLighting) },
  ]
}

/**
 * Les quatre jambages d'une embrasure : un court tunnel qui va de la face intérieure de
 * la paroi jusqu'au plan de la couture, au fond.
 *
 * Ils remplacent l'encadrement peint qui décorait l'ouverture auparavant. C'est deux
 * gains pour le même travail : un vrai relief donne un bord net, ce dont on a besoin
 * pour juger à l'œil l'alignement de l'image vue à travers la couture ; et cela
 * supprime la seule géométrie coplanaire de la scène, ce qui permet de rapprocher le
 * plan proche sans craindre le conflit de profondeur.
 */
function pushReveal(out: number[], m: Mouth, color: Color): void {
  const w = m.halfWidth
  const h = m.halfHeight
  const R = m.right
  const U = m.up
  const face = add(m.center, scale(m.normal, REVEAL))
  const depth = scale(m.normal, -REVEAL)
  const corner = (s: number, t: number): Vec3 => add(add(face, scale(R, s)), scale(U, t))

  // L'orientation de chaque jambage est choisie pour que sa normale regarde vers
  // l'intérieur du tunnel — sinon le tri des faces arrière le rend invisible.
  const faces: { origin: Vec3; right: Vec3; up: Vec3 }[] = [
    { origin: corner(-w, -h), right: depth, up: scale(U, 2 * h) }, // jambage gauche
    { origin: corner(w, -h), right: scale(U, 2 * h), up: depth }, // jambage droit
    { origin: corner(-w, h), right: depth, up: scale(R, 2 * w) }, // linteau
    { origin: corner(-w, -h), right: scale(R, 2 * w), up: depth }, // seuil
  ]
  for (const f of faces) pushWall(out, { origin: f.origin, right: f.right, up: f.up, color })
}

/**
 * Le trou à percer dans la paroi.
 *
 * Il est sur la **face intérieure**, alors que la bouche de la couture est au fond de
 * l'embrasure : il faut donc revenir de la profondeur de l'embrasure.
 */
function holeOf(m: Mouth): Hole {
  return {
    center: add(m.center, scale(m.normal, REVEAL)),
    halfWidth: m.halfWidth,
    halfHeight: m.halfHeight,
  }
}

/** Une teinte assombrie, pour composer une palette de parois à partir d'une couleur. */
function tinted(tint: Colour, level: number): Color {
  return [
    level * (0.5 + tint[0] * 0.5),
    level * (0.5 + tint[1] * 0.5),
    level * (0.5 + tint[2] * 0.5),
  ]
}

function paletteFor(tint: Colour): RoomPalette {
  return { floor: tinted(tint, 0.5), ceiling: tinted(tint, 0.62), wall: tinted(tint, 0.8) }
}

/**
 * L'éclairage d'une aile : une lampe au centre, plus une applique au-dessus de chaque
 * porte, côté aile.
 *
 * Les appliques ne sont pas décoratives. Sans elles, une aile n'a rien à transmettre :
 * la lumière franchissant son ouverture se réduit à son ambiance, dix fois trop faible
 * pour se voir. On croirait alors voir la lumière traverser alors qu'on verrait
 * seulement la pièce voisine *à travers* l'ouverture, ce qui est autre chose.
 */
function lightingFor(box: Box, tint: Colour, mouths: Mouth[]): CellLighting {
  const centre = {
    x: (box.min.x + box.max.x) / 2,
    y: box.max.y - 0.5,
    z: (box.min.z + box.max.z) / 2,
  }
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)

  return {
    ambient: [tint[0] * 0.075, tint[1] * 0.075, tint[2] * 0.075],
    lights: [
      { position: centre, colour: tint, intensity: 8, radius: span },
      ...mouths.map((m) => ({
        position: add(add(m.center, scale(m.normal, REVEAL + 0.7)), { x: 0, y: 1.4, z: 0 }),
        colour: tint,
        intensity: 5,
        radius: 7,
      })),
    ],
  }
}

/**
 * L'éclairage du tube : des lampes posées sur l'axe même.
 *
 * Sur l'axe, donc à équidistance des quatre faces, qu'elles éclairent également quelle
 * que soit l'orientation de la section. Les placer au « plafond » n'aurait aucun sens
 * ici : le plafond devient un mur au fil de la vrille.
 */
function tubeLighting(tint: Colour): CellLighting {
  const lamps = [1.5, 5.5, 9.5, 13.5, 17.5, 20.5]
  return {
    ambient: [tint[0] * 0.06, tint[1] * 0.06, tint[2] * 0.06],
    lights: lamps.map((s) => ({
      position: toWorld(VRILLE, { s, u: 0, v: 0 }),
      colour: tint,
      intensity: 4.5,
      radius: 6,
    })),
  }
}

/** Une aile : ce qu'elle mesure, où sa porte se trouve, et ce qui viendra dedans. */
interface Wing {
  id: string
  box: Box
  /** La paroi de l'aile où s'ouvre sa porte vers la rotonde. */
  wall: Wall
  lateral: number
  tint: Colour
  /** La paroi de la rotonde d'où l'on y accède, et à quelle abscisse. */
  hubWall: Wall
  hubLateral: number
  /** Ce que cette aile accueillera. Vide pour l'instant, et c'est voulu. */
  purpose: string
}

const HUB_BOX: Box = { min: { x: -7, y: 0, z: -7 }, max: { x: 7, y: 5, z: 7 } }

/**
 * Le tunnel-vrille.
 *
 * Vingt-deux mètres, une section carrée de quatre mètres quarante, un quart de tour. Le
 * quart de tour n'est pas choisi au hasard : c'est celui qui fait que le sol de l'entrée
 * devient exactement le mur de gauche.
 *
 * **On ne voit jamais le couloir tourner.** Depuis la rotonde, et par l'une ou l'autre
 * de ses deux portes, c'est un couloir droit et banal. La vrille ne se forme que devant
 * celui qui s'y engage, et seulement derrière lui : elle n'est visible qu'en se
 * retournant. Voir `src/world/twist.ts`, qui ne parle que de cela.
 *
 * Les six premiers mètres restent droits même une fois qu'on y est — un temps mort avant
 * que quoi que ce soit ne commence — et les trois derniers de même. Ces paliers ont aussi
 * une fonction technique : ils garantissent que chaque bouche est exactement à l'angle de
 * sa couture.
 *
 * La section est large : quatre mètres quarante, contre trois auparavant. Un couloir
 * étroit qui tourne devient étouffant, et surtout la torsion se lit mal quand les parois
 * sont à portée de main.
 */
const VRILLE = makeTwist({
  origin: { x: 101.5, y: 2.2, z: 100 },
  axis: { x: 0, y: 0, z: 1 },
  length: 22,
  halfSize: 2.2,
  turn: Math.PI / 2,
  straight: 6,
  runout: 3,
  blend: 3,
  up0: { x: 0, y: 1, z: 0 },
})

/** L'identifiant de l'aile qui accueille le tube. Le monde entier s'y réfère. */
const TWISTED = 'vrille'

/**
 * Un anneau tous les quinze centimètres : la vrille est plus rapide en son milieu qu'un
 * profil linéaire, et des facettes s'y verraient.
 */
const TUBE_STATIONS = 150

/**
 * Quatre faces franchement distinctes : une section carrée qui tourne d'un quart de tour
 * se superpose à elle-même, et sans ces couleurs la vrille serait parfaitement invisible.
 */
const TUBE_PALETTE: TubePalette = {
  floor: [0.58, 0.36, 0.2],
  ceiling: [0.2, 0.26, 0.24],
  left: [0.33, 0.47, 0.42],
  right: [0.47, 0.63, 0.57],
}

/**
 * Une bouche au bout du tube.
 *
 * Son repère est celui de la section qu'elle ferme, et non celui du monde : à la
 * sortie, le « haut » de la porte pointe vers le côté. C'est ce qui fait que la couture
 * vers la rotonde absorbe la vrille accumulée — on ressort debout, sans à-coup, parce
 * qu'une couture est une transformation rigide et qu'elle emporte le repère entier.
 *
 * Le centre est décalé du fond de l'embrasure, mais le repère reste celui de la section
 * du fond : sans cela l'embrasure serait construite avec une orientation d'un degré
 * différente de la paroi qu'elle perce, et le raccord se verrait.
 *
 * La section du fond **bouge** avec le visiteur, donc cette bouche aussi : tant qu'on
 * n'est pas entré dans le tunnel, sa porte de sortie est droite comme le couloir qu'elle
 * ferme, et elle ne prend son quart de tour qu'à mesure qu'on avance vers elle. Le palier
 * droit de fin garantit qu'elle l'a pris **entièrement** plusieurs mètres avant qu'on
 * l'atteigne : au moment du franchissement, la couture est exactement celle qui a été
 * construite, et rien ne bouge sous les pieds.
 */
function tubeMouth(id: string, atStart: boolean): Mouth {
  const s = atStart ? 0 : VRILLE.length
  const { right, up } = frameAt(VRILLE, s)
  const face = toWorld(VRILLE, { s, u: 0, v: -VRILLE.halfSize + DOOR_HALF_H })
  const normal = atStart ? VRILLE.axis : neg(VRILLE.axis)

  return {
    id,
    cell: TWISTED,
    center: add(face, scale(normal, -REVEAL)),
    right: atStart ? right : neg(right),
    up,
    normal,
    halfWidth: DOOR_HALF_W,
    halfHeight: DOOR_HALF_H,
  }
}

/** Une bouche du tube et le bout où elle se trouve, ce dernier fixant son orientation. */
interface MouthSlot {
  mouth: Mouth
  atStart: boolean
}

/** Ce qu'il faut refaire quand le visiteur avance dans le tube. */
interface TubeState {
  cell: Cell
  mouths: MouthSlot[]
  /** Les quatre passages dont une extrémité est une bouche du tube. */
  passages: Passage[]
  tint: Colour
}

let tube: TubeState | null = null
/** La géométrie du tube est-elle en retard sur l'état de la vrille ? */
let tubeStale = false

/**
 * Le tableau où le maillage du tube se refait, réutilisé d'une image sur l'autre.
 *
 * Quarante mille flottants reconstruits par image ne coûtent rien à calculer ; les
 * réallouer à chaque fois réveillerait le ramasse-miettes, et toujours au mauvais moment.
 */
const tubeScratch: number[] = []

/** Le maillage complet du tube, à l'état où la vrille se trouve. */
function tubeVerts(mouths: MouthSlot[], tint: Colour): number[] {
  const out = tubeScratch
  out.length = 0

  pushTwistedTube(out, VRILLE, TUBE_PALETTE, TUBE_STATIONS)
  for (const { mouth: m } of mouths) pushReveal(out, m, tinted(tint, 0.55))
  // Les deux fonds du tube, percés de leur porte.
  for (const { mouth: m, atStart } of mouths) {
    pushTubeCap(out, VRILLE, atStart, tinted(tint, 0.4), holeOf(m))
  }

  return out
}

/**
 * Dit au tunnel où se trouve le visiteur.
 *
 * C'est le seul point d'entrée : le visiteur avance, on le déclare, et tout ce qui
 * dépend de la vrille — la paroi, les deux bouches, les quatre coutures qui y touchent —
 * se remet d'aplomb ensemble. Les faire diverger, ne serait-ce qu'une image, donnerait
 * une porte dessinée à un endroit et franchie à un autre.
 *
 * Appelé par le **visiteur** seul. Un cube lancé traverse le tunnel sans rien y changer :
 * la vrille suit celui qui regarde, pas ce qui vole.
 *
 * Le déplacement a déjà déclaré chaque sous-pas ; ce qui se joue ici est la conséquence,
 * tirée une seule fois pour toute l'image.
 */
export function followVisitor(cellId: string, pos: Vec3): void {
  const state = tube
  if (!state) return

  setVisitor(VRILLE, cellId === state.cell.id ? arcAt(VRILLE, pos) : null)
  if (!takeVisitChange(VRILLE)) return

  // Les bouches sont **corrigées sur place** plutôt que remplacées : les passages, des
  // deux côtés de chaque couture, en gardent la référence, si bien que les corriger ici
  // les corrige partout d'un coup. Une bouche recréée laisserait derrière elle des
  // passages pointant vers l'ancienne — une porte dessinée à un endroit et franchie à un
  // autre, c'est-à-dire le pire genre de défaut.
  for (const { mouth: m, atStart } of state.mouths) {
    const fresh = tubeMouth(m.id, atStart)
    m.center = fresh.center
    m.right = fresh.right
    m.up = fresh.up
  }

  // Les transformations en découlent, et elles seules : la lumière que ces bouches
  // transmettent, elle, ne bouge pas. Les lampes du tube sont posées **sur son axe**, donc
  // à distance constante d'une bouche qui pivote autour de ce même axe, et la normale
  // d'une bouche est l'axe lui-même. Recalculer la radiance rendrait la même valeur.
  for (const passage of state.passages) {
    passage.transform = passageTransform(passage.from, passage.to)
  }

  tubeStale = true
}

/**
 * Refait le maillage du tube si la vrille a bougé, et renvoie la cellule à réenvoyer à la
 * carte graphique — ou `null` s'il n'y a rien à faire.
 *
 * Séparé de `followVisitor` parce que le déplacement se découpe en sous-pas, et qu'il
 * serait absurde de reconstruire quarante mille sommets vingt fois par image. L'état
 * suffit à tout ; la géométrie n'en est qu'une conséquence, qu'on tire une fois, au
 * moment de dessiner.
 */
export function refreshTwist(): Cell | null {
  const state = tube
  if (!state || !tubeStale) return null
  tubeStale = false

  const verts = tubeVerts(state.mouths, state.tint)
  // Le compte est le même d'une image sur l'autre — mêmes stations, mêmes découpes — mais
  // le supposer sans le dire donnerait un maillage tronqué le jour où ce ne serait plus
  // vrai, ce qui est exactement le genre de chose qu'on ne relie pas à sa cause.
  if (verts.length !== state.cell.verts.length) state.cell.verts = Float32Array.from(verts)
  else state.cell.verts.set(verts)

  return state.cell
}

/**
 * Les sept ailes, une par tricherie géométrique du lot 2.
 *
 * Les proportions ne sont pas arbitraires : chacune est déjà taillée pour ce qu'elle
 * accueillera, et surtout elles sont toutes différentes, de sorte qu'une capture
 * d'écran suffise à savoir où l'on se trouve.
 */
const WINGS: Wing[] = [
  {
    id: 'vrille',
    // Boîte englobante seulement : la collision d'un tube vrillé se fait dans son
    // repère redressé, pas contre ces bornes. Elles restent justes, une section carrée
    // pivotée débordant de son demi-côté fois racine de deux.
    box: { min: { x: 98.3, y: -1, z: 99.7 }, max: { x: 104.7, y: 5.4, z: 122.3 } },
    wall: 'north',
    lateral: 101.5,
    tint: [0.55, 0.8, 0.7],
    hubWall: 'north',
    hubLateral: -3.5,
    purpose: 'le tunnel-vrille : un quart de tour qui n’apparaît qu’en marchant, gravité comprise',
  },
  {
    id: 'gravite',
    box: { min: { x: 200, y: 0, z: 200 }, max: { x: 210, y: 10, z: 210 } },
    wall: 'west',
    lateral: 205,
    tint: [0.82, 0.87, 1],
    hubWall: 'north',
    hubLateral: 3.5,
    purpose: 'la gravité par face : un cube dont les six faces seront habitables',
  },
  {
    id: 'penrose',
    box: { min: { x: 300, y: 0, z: 300 }, max: { x: 308, y: 14, z: 308 } },
    wall: 'south',
    lateral: 304,
    tint: [1, 0.78, 0.42],
    hubWall: 'east',
    hubLateral: -3.5,
    purpose: 'l’escalier de Penrose : quatre volées qui ramènent au départ, plus haut',
  },
  {
    id: 'pave',
    box: { min: { x: 400, y: 0, z: 400 }, max: { x: 412, y: 12, z: 412 } },
    wall: 'east',
    lateral: 406,
    tint: [0.88, 0.55, 0.9],
    hubWall: 'east',
    hubLateral: 3.5,
    purpose: 'l’espace pavé : les faces opposées recollées, donc un monde sans bord',
  },
  {
    id: 'mobiles',
    box: { min: { x: 500, y: 0, z: 500 }, max: { x: 518, y: 3.6, z: 510 } },
    wall: 'north',
    lateral: 509,
    tint: [1, 0.52, 0.45],
    hubWall: 'south',
    hubLateral: 3.5,
    purpose: 'les murs mobiles, dont ceux qui ne bougent que hors du champ de vision',
  },
  {
    id: 'recursive',
    box: { min: { x: 600, y: 0, z: 600 }, max: { x: 612, y: 6, z: 612 } },
    wall: 'west',
    lateral: 606,
    tint: [0.5, 0.92, 0.95],
    hubWall: 'west',
    hubLateral: -3.5,
    purpose: 'la salle récursive : une maquette du musée qui se contient elle-même',
  },
  {
    id: 'regard',
    box: { min: { x: 700, y: 0, z: 700 }, max: { x: 708, y: 4, z: 720 } },
    wall: 'south',
    lateral: 704,
    tint: [0.96, 0.93, 0.6],
    hubWall: 'west',
    hubLateral: 3.5,
    purpose: 'la perspective forcée : la taille d’un objet fixée par sa place à l’écran',
  },
]

/**
 * La seconde extrémité du tunnel, qui redonne sur la rotonde et referme la boucle.
 * C'est elle qui rend le couloir infini, donc qui conserve le cas de récursion.
 */
const LOOP_BACK = { hubWall: 'south' as Wall, hubLateral: -3.5, wingWall: 'south' as Wall }

/**
 * Repères exportés pour les préréglages de points de vue et les outils.
 *
 * Rien ne doit écrire une coordonnée du monde en dur : le plan des coutures a déjà bougé
 * une fois, quand les parois ont pris de l'épaisseur, et tous les repères figés se sont
 * mis à mesurer autre chose sans rien signaler.
 */
export interface Landmarks {
  hub: string
  /** Le centre de la rotonde, à hauteur d'œil. */
  hubCenter: Vec3
  /** La bouche de référence, côté rotonde : celle qui mène au tunnel. */
  seamCenter: Vec3
  seamNormal: Vec3
  /** L'axe horizontal de cette bouche, pour composer des poses de côté. */
  seamRight: Vec3
  /** Une pose dans l'aile de référence, regardant vers sa porte. */
  wingCell: string
  wingPos: Vec3
  wingForward: Vec3
  /** La liste des ailes et de ce qu'elles accueilleront, pour l'affichage. */
  wings: { id: string; purpose: string }[]
}

let landmarks: Landmarks | null = null

export function getLandmarks(): Landmarks {
  if (!landmarks) throw new Error('buildWorld doit être appelé avant de lire les repères')
  return landmarks
}

export function buildWorld(): World {
  // La vrille est une constante de module, donc elle survit à la reconstruction du monde :
  // on la remet au repos, sans quoi un second monde naîtrait avec un tunnel déjà tordu par
  // le visiteur du précédent.
  setVisitor(VRILLE, null)
  takeVisitChange(VRILLE)
  tube = null
  tubeStale = false

  const hubMouths: { mouth: Mouth; wall: Wall }[] = []
  const wingData: { wing: Wing; mouths: Mouth[]; holes: RoomHoles; lighting: CellLighting }[] = []

  // --- Les bouches d'abord : l'éclairage en dépend --------------------------
  for (const wing of WINGS) {
    const twisted = wing.id === TWISTED
    const mouths = twisted
      ? [tubeMouth(`${TWISTED}.porte`, true), tubeMouth(`${TWISTED}.retour`, false)]
      : [mouth(wing.id, `${wing.id}.porte`, wing.box, wing.wall, wing.lateral)]
    const holes: RoomHoles = twisted ? {} : { [wing.wall]: [holeOf(mouths[0]!)] }

    wingData.push({
      wing,
      mouths,
      holes,
      lighting: twisted ? tubeLighting(wing.tint) : lightingFor(wing.box, wing.tint, mouths),
    })
    hubMouths.push({
      mouth: mouth(HUB, `${HUB}.vers-${wing.id}`, HUB_BOX, wing.hubWall, wing.hubLateral),
      wall: wing.hubWall,
    })
  }

  const loopHubMouth = mouth(
    HUB,
    `${HUB}.retour-vrille`,
    HUB_BOX,
    LOOP_BACK.hubWall,
    LOOP_BACK.hubLateral,
  )
  hubMouths.push({ mouth: loopHubMouth, wall: LOOP_BACK.hubWall })

  const hubTint: Colour = [1, 0.88, 0.72]
  const hubLighting: CellLighting = {
    ambient: [0.08, 0.075, 0.068],
    lights: [
      { position: { x: 0, y: 4.4, z: 0 }, colour: hubTint, intensity: 12, radius: 13 },
      { position: { x: -4.5, y: 3.4, z: -4.5 }, colour: hubTint, intensity: 4, radius: 8 },
      { position: { x: 4.5, y: 3.4, z: 4.5 }, colour: hubTint, intensity: 4, radius: 8 },
    ],
  }

  // --- Les passages ---------------------------------------------------------
  const hubPassages: Passage[] = []
  const wingPassages = new Map<string, Passage[]>()

  wingData.forEach((entry, index) => {
    const [fromHub, fromWing] = makePassages(
      hubMouths[index]!.mouth,
      hubLighting,
      entry.mouths[0]!,
      entry.lighting,
    )
    hubPassages.push(fromHub)
    wingPassages.set(entry.wing.id, [fromWing])
  })

  const vrille = wingData.find((entry) => entry.wing.id === TWISTED)!
  const [hubToLoop, loopToHub] = makePassages(
    loopHubMouth,
    hubLighting,
    vrille.mouths[1]!,
    vrille.lighting,
  )
  hubPassages.push(hubToLoop)
  wingPassages.get(TWISTED)!.push(loopToHub)

  // --- La géométrie ---------------------------------------------------------
  const hubHoles: RoomHoles = {}
  for (const { mouth: m, wall } of hubMouths) {
    ;(hubHoles[wall] ??= []).push(holeOf(m))
  }

  const accent: Color = [0.62, 0.36, 0.2]
  const hubExtra: number[] = []
  for (const { mouth: m } of hubMouths) pushReveal(hubExtra, m, accent)

  const cells: Cell[] = [
    {
      id: HUB,
      min: HUB_BOX.min,
      max: HUB_BOX.max,
      verts: concat(buildRoom(HUB_BOX.min, HUB_BOX.max, paletteFor(hubTint), hubHoles), hubExtra),
      passages: hubPassages,
      lighting: hubLighting,
    },
  ]

  for (const entry of wingData) {
    const twisted = entry.wing.id === TWISTED

    if (twisted) {
      // Le tube se construit par la même fonction que celle qui le refera à chaque pas du
      // visiteur : c'est ce qui garantit que l'état initial est un état comme un autre, et
      // non un cas particulier qui se mettrait un jour à diverger des suivants.
      const slots = entry.mouths.map((m, i) => ({ mouth: m, atStart: i === 0 }))
      const cell: Cell = {
        id: entry.wing.id,
        min: entry.wing.box.min,
        max: entry.wing.box.max,
        verts: Float32Array.from(tubeVerts(slots, entry.wing.tint)),
        passages: wingPassages.get(entry.wing.id)!,
        lighting: entry.lighting,
        twist: VRILLE,
      }
      tube = { cell, mouths: slots, passages: [], tint: entry.wing.tint }
      cells.push(cell)
      continue
    }

    const extra: number[] = []
    for (const m of entry.mouths) pushReveal(extra, m, tinted(entry.wing.tint, 0.55))

    cells.push({
      id: entry.wing.id,
      min: entry.wing.box.min,
      max: entry.wing.box.max,
      verts: concat(
        buildRoom(entry.wing.box.min, entry.wing.box.max, paletteFor(entry.wing.tint), entry.holes),
        extra,
      ),
      passages: wingPassages.get(entry.wing.id)!,
      lighting: entry.lighting,
    })
  }

  // Les quatre coutures qui touchent au tube, retenues pour être refaites à chaque pas :
  // les deux du tunnel, et les deux de la rotonde qui y mènent. Elles sont trouvées plutôt
  // qu'énumérées à la main, faute de quoi en ajouter une cinquième un jour laisserait une
  // porte figée au milieu d'un couloir qui tourne.
  if (tube) {
    tube.passages = cells
      .flatMap((cell) => cell.passages)
      .filter((p) => p.from.cell === TWISTED || p.to.cell === TWISTED)
  }

  // Vérification silencieuse mais utile : un repère de bouche doit être direct, sinon la
  // transformation retourne l'image sans que rien ne le signale.
  for (const cell of cells) {
    for (const passage of cell.passages) {
      const m = passage.from
      const n = cross(m.right, m.up)
      const err =
        Math.abs(n.x - m.normal.x) + Math.abs(n.y - m.normal.y) + Math.abs(n.z - m.normal.z)
      if (err > 1e-6) throw new Error(`Repère de bouche indirect sur ${m.id} (right × up ≠ normal)`)
    }
  }

  const reference = hubPassages[0]!
  landmarks = {
    hub: HUB,
    hubCenter: { x: 0, y: HUB_BOX.min.y + 1.65, z: 0 },
    seamCenter: reference.from.center,
    seamNormal: reference.from.normal,
    seamRight: reference.from.right,
    wingCell: reference.to.cell,
    // Deux mètres dans l'aile, tourné vers sa porte.
    wingPos: add(add(reference.to.center, scale(reference.to.normal, 2)), { x: 0, y: 0.55, z: 0 }),
    wingForward: neg(reference.to.normal),
    wings: WINGS.map((w) => ({ id: w.id, purpose: w.purpose })),
  }

  return { cells: new Map(cells.map((c) => [c.id, c])) }
}

function concat(a: F32, b: number[]): F32 {
  const out = new Float32Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
