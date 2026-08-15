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
import { add, cross, neg, normalize, scale, sub, type Vec3 } from '../math/vec3'
import {
  buildRoom,
  buildTwistedTube,
  pushBlock,
  pushTubeCap,
  pushWall,
  type Color,
  type Hole,
  type RoomHoles,
  type RoomPalette,
} from './geometry'
import { mouthRadiance, type CellLighting, type Colour } from './light'
import { frameAt, makeTwist, toWorld } from './twist'
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
function pushReveal(out: number[], m: Mouth, color: Color, sill = true): void {
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
  ]
  // Le seuil, lui, ne va pas de soi — voir l'appelant qui le refuse.
  if (sill) faces.push({ origin: corner(-w, -h), right: scale(R, 2 * w), up: depth })

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

/**
 * L'éclairage d'une salle aux six sols : une seule lampe, au **centre géométrique**.
 *
 * C'est la seule position qui ne désigne aucune face comme le bas. Une lampe au plafond,
 * comme partout ailleurs, dirait au visiteur où est le haut avant qu'il ait fait un pas —
 * et le lui dirait encore, à tort, quand il se tiendrait dessus. Les six faces reçoivent
 * ici exactement la même lumière, et les huit coins restent sombres : c'est la symétrie
 * qu'on veut faire sentir.
 */
function cubeLighting(box: Box, tint: Colour, mouths: Mouth[]): CellLighting {
  const centre = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  }
  const span = box.max.y - box.min.y

  return {
    ambient: [tint[0] * 0.06, tint[1] * 0.06, tint[2] * 0.06],
    lights: [
      { position: centre, colour: tint, intensity: 30, radius: span * 1.4 },
      ...mouths.map((m) => ({
        position: add(add(m.center, scale(m.normal, REVEAL + 0.7)), { x: 0, y: 1.4, z: 0 }),
        colour: tint,
        intensity: 5,
        radius: 7,
      })),
    ],
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
 * Les six premiers mètres sont **parfaitement droits**. Depuis le seuil, le couloir se
 * présente donc comme un couloir : droit, banal, rien à signaler. La vrille ne commence
 * qu'une fois qu'on s'y est engagé, et en fondu — elle arrive de nulle part. Une vrille
 * répartie sur toute la longueur se verrait dès l'entrée, et l'on saurait à quoi
 * s'attendre.
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
  up0: { x: 0, y: 1, z: 0 },
})

/**
 * **Le reliquaire** — le volume impossible du musée, et il l'est en boucle.
 *
 * Au centre de la salle, un coffre de deux mètres cinquante. Dans sa face, une porte
 * ordinaire, celle de partout ailleurs : un mètre quatre-vingts sur deux mètres vingt.
 * Elle occupe donc presque toute la face, et c'est là que le compte cesse d'y être —
 * une porte à hauteur d'homme dans une boîte à peine plus haute qu'elle.
 *
 * Et derrière cette porte, il n'y a pas d'autre salle : **il y a celle-ci**. Le coffre
 * débouche par la porte du mur du fond, à huit mètres de là. On entre dans une boîte de
 * deux mètres cinquante et l'on ressort dans la pièce de douze mètres où elle est posée.
 *
 * Le contenant contient donc son contenant. Cinquante-cinq fois son propre volume, ce qui
 * est déjà absurde, mais ce n'est pas le plus fort : ce qui l'est, c'est que le coffre ne
 * contient pas *une* salle plus grande, il contient **la sienne**. Une nef séparée, si
 * vaste soit-elle, reste une pièce qu'on n'avait jamais vue, et le visiteur peut toujours
 * se dire qu'elle est ailleurs. Là, il n'y a pas d'ailleurs : il regarde par la petite
 * porte et il voit, de dos, le sol qu'il foule et la boîte où il regarde.
 *
 * **Aucune tricherie d'échelle.** Les deux bouches ont exactement la même taille, la
 * transformation reste rigide, et le visiteur garde sa stature. On peut faire le tour du
 * coffre, le mesurer du regard, et rien ne change.
 */
/**
 * **La salle aux six sols** — la gravité par face.
 *
 * Un cube de dix mètres dont chaque paroi est un sol. On y entre debout, on marche vers
 * un mur, et à une hauteur d'homme de lui la gravité bascule : le mur devient le sol, la
 * salle pivote d'un quart de tour autour de soi, et l'on continue à marcher. De proche en
 * proche, les six faces sont habitables, plafond compris.
 *
 * **Les six faces sont de six teintes.** Sans cela on ne sait plus sur laquelle on se
 * tient ni d'où l'on vient — un cube uni tourné d'un quart de tour se superpose à
 * lui-même, exactement comme la section du tunnel-vrille.
 *
 * **La bordure peinte est la règle.** Elle marque la bande où le basculement se
 * déclenche, et sa largeur est celle de la hauteur d'œil du visiteur — ce qui n'est pas
 * un choix graphique mais la condition pour que la bascule ne déplace rien. Voir
 * `FaceGravity`.
 *
 * **La porte ne s'ouvre que pour qui se tient d'aplomb**, et la salle s'en charge
 * elle-même : la porte est au ras d'une arête, donc dans la bande d'accroche. Qui s'en
 * approche en marchant sur un mur bascule sur le sol du bas et se retrouve debout devant
 * elle. Il n'y a donc rien à interdire — la géométrie suffit.
 */
const GRAVITY_WING = 'gravite'
/** Largeur de la bande d'accroche. Égale à la hauteur d'œil du visiteur, obligatoirement. */
const GRIP = 1.65
/** La bordure, franchement plus claire que les six faces : c'est un mode d'emploi. */
const GRIP_COLOUR: Color = [0.86, 0.88, 0.92]
/**
 * Six teintes, une par face, et assez éloignées les unes des autres pour qu'un coup d'œil
 * suffise à savoir où l'on se tient. Deux faces opposées sont volontairement proches — le
 * sol et le plafond de l'entrée, les deux bleus — parce que ce sont elles qu'on confond le
 * moins, ayant marché sur l'une avant d'atteindre l'autre.
 */
const SIX_FLOORS: RoomPalette = {
  floor: [0.30, 0.38, 0.52],
  ceiling: [0.24, 0.30, 0.42],
  wall: [0.4, 0.4, 0.4],
  walls: {
    north: [0.52, 0.34, 0.30],
    south: [0.30, 0.46, 0.36],
    west: [0.50, 0.44, 0.28],
    east: [0.42, 0.32, 0.48],
  },
}

/** L'aile qui l'accueille : celle réservée à ce qui se contient soi-même. */
const RELIQUARY_WING = 'recursive'
/**
 * Le côté du coffre : deux mètres cinquante, trente centimètres de plus que sa porte.
 *
 * Deux mètres cinquante, et non deux mètres soixante — pour une raison qui n'a rien à
 * voir avec le dessin. Les matrices sont en flottants **32 bits**, et l'invariant qui
 * vérifie que les deux bouches d'une couture coïncident est exact au bit près. À six
 * cents mètres de l'origine, le pas du flottant vaut déjà un dixième de millimètre : une
 * demi-largeur de 1,30 m place la face du coffre sur une coordonnée non représentable, et
 * l'écart mesuré passe à 1,2 × 10⁻⁵ m — au-dessus du seuil, et à raison.
 *
 * Tout le musée tient donc sur une **grille au quart de mètre**, où sommes et différences
 * restent exactes. C'est une contrainte à connaître avant de poser une cote, pas après.
 */
const RELIQUARY_SIDE = 2.5
/** La paroi du coffre qu'on perce, et celle de la salle par où l'on en ressort. */
const RELIQUARY_FACE: Wall = 'west'
const RELIQUARY_EXIT_WALL: Wall = 'east'

/** Le coffre, posé au milieu de sa salle et sur son sol. */
function reliquaryIn(box: Box): Box {
  const half = RELIQUARY_SIDE / 2
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  return {
    min: { x: cx - half, y: box.min.y, z: cz - half },
    max: { x: cx + half, y: box.min.y + RELIQUARY_SIDE, z: cz + half },
  }
}

/** L'abscisse du milieu d'une boîte, le long de la paroi visée. */
function middleOf(box: Box, wall: Wall): number {
  return wall === 'north' || wall === 'south'
    ? (box.min.x + box.max.x) / 2
    : (box.min.z + box.max.z) / 2
}


/**
 * Une bouche percée dans la face d'un bloc plein.
 *
 * C'est la jumelle de `mouth`, à ceci près qu'on la regarde **de dehors** : la normale
 * sort du bloc au lieu d'entrer dans la pièce, et l'embrasure s'enfonce dans la matière
 * au lieu de la traverser. Les repères restent choisis pour que `right × up = normal`,
 * vérifié à la fin de `buildWorld`.
 */
function blockMouth(cell: string, id: string, box: Box, wall: Wall, lateral: number): Mouth {
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
        center: { x: lateral, y, z: box.min.z + REVEAL },
        right: { x: -1, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: -1 },
      }
    case 'south':
      return {
        ...common,
        center: { x: lateral, y, z: box.max.z - REVEAL },
        right: { x: 1, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
      }
    case 'west':
      return {
        ...common,
        center: { x: box.min.x + REVEAL, y, z: lateral },
        right: { x: 0, y: 0, z: 1 },
        normal: { x: -1, y: 0, z: 0 },
      }
    case 'east':
      return {
        ...common,
        center: { x: box.max.x - REVEAL, y, z: lateral },
        right: { x: 0, y: 0, z: -1 },
        normal: { x: 1, y: 0, z: 0 },
      }
  }
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
 */
function tubeMouth(id: string, atStart: boolean): Mouth {
  const s = atStart ? 0 : VRILLE.length
  const { right, up } = frameAt(VRILLE, s)
  const face = toWorld(VRILLE, { s, u: 0, v: -VRILLE.halfSize + DOOR_HALF_H })
  const normal = atStart ? VRILLE.axis : neg(VRILLE.axis)

  return {
    id,
    cell: 'vrille',
    center: add(face, scale(normal, -REVEAL)),
    right: atStart ? right : neg(right),
    up,
    normal,
    halfWidth: DOOR_HALF_W,
    halfHeight: DOOR_HALF_H,
  }
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
    purpose: 'le tunnel-vrille : un quart de tour sur dix-huit mètres, gravité comprise',
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
    purpose: 'le reliquaire : un coffre de deux mètres cinquante qui contient une nef',
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
  /** Une pose dans la salle du reliquaire, à quelques pas du coffre et face à sa porte. */
  chestCell: string
  chestPos: Vec3
  chestForward: Vec3
  /** Une pose dans la salle aux six sols, d'où l'on voit quatre de ses faces. */
  facesCell: string
  facesPos: Vec3
  facesForward: Vec3
  /** La liste des ailes et de ce qu'elles accueilleront, pour l'affichage. */
  wings: { id: string; purpose: string }[]
}

let landmarks: Landmarks | null = null

export function getLandmarks(): Landmarks {
  if (!landmarks) throw new Error('buildWorld doit être appelé avant de lire les repères')
  return landmarks
}

export function buildWorld(): World {
  const hubMouths: { mouth: Mouth; wall: Wall }[] = []
  const wingData: {
    wing: Wing
    mouths: Mouth[]
    holes: RoomHoles
    lighting: CellLighting
    /** Le coffre posé au milieu, pour l'aile qui en a un. */
    chest?: Box
  }[] = []

  // --- Les bouches d'abord : l'éclairage en dépend --------------------------
  //
  // La première de chaque aile est toujours celle qui donne sur la rotonde ; les
  // suivantes sont propres à l'aile. Le tunnel en a une seconde à son autre bout, et la
  // salle du reliquaire en a deux : celle du coffre et celle par où la nef ressort.
  for (const wing of WINGS) {
    const twisted = wing.id === 'vrille'
    const reliquary = wing.id === RELIQUARY_WING
    const chest = reliquary ? reliquaryIn(wing.box) : null

    const mouths = twisted
      ? [tubeMouth('vrille.porte', true), tubeMouth('vrille.retour', false)]
      : [mouth(wing.id, `${wing.id}.porte`, wing.box, wing.wall, wing.lateral)]
    if (chest) {
      mouths.push(
        blockMouth(wing.id, 'reliquaire.coffre', chest, RELIQUARY_FACE, middleOf(chest, RELIQUARY_FACE)),
        mouth(wing.id, 'reliquaire.sortie', wing.box, RELIQUARY_EXIT_WALL, middleOf(wing.box, RELIQUARY_EXIT_WALL)),
      )
    }

    const holes: RoomHoles = twisted ? {} : { [wing.wall]: [holeOf(mouths[0]!)] }
    // La porte du coffre ne perce aucune paroi de la salle : elle perce le coffre.
    if (chest) holes[RELIQUARY_EXIT_WALL] = [holeOf(mouths[2]!)]

    wingData.push({
      wing,
      mouths,
      holes,
      lighting: twisted
        ? tubeLighting(wing.tint)
        : wing.id === GRAVITY_WING
          ? cubeLighting(wing.box, wing.tint, mouths)
          : lightingFor(wing.box, wing.tint, mouths),
      ...(chest ? { chest } : {}),
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

  const vrille = wingData.find((entry) => entry.wing.id === 'vrille')!
  const [hubToLoop, loopToHub] = makePassages(
    loopHubMouth,
    hubLighting,
    vrille.mouths[1]!,
    vrille.lighting,
  )
  hubPassages.push(hubToLoop)
  wingPassages.get('vrille')!.push(loopToHub)

  // **La couture du reliquaire a ses deux bouches dans la même cellule.**
  //
  // C'est le premier cas du genre, et il ne demande rien de particulier : l'espace cousu
  // relie des bouches, pas des pièces, et rien dans le rendu ni dans le déplacement ne
  // suppose qu'elles appartiennent à deux cellules distinctes. Une salle peut donc se
  // recoller à elle-même — ce qui servira encore à l'espace pavé.
  //
  // Ce que cela donne : on entre dans une boîte de deux mètres cinquante et l'on ressort
  // par le mur du fond de la pièce où elle est posée. Et par la petite porte, on voit
  // cette même pièce, vue du fond : son sol, ses murs, et le coffre lui-même, de dos.
  const chestWing = wingData.find((entry) => entry.wing.id === RELIQUARY_WING)!
  const [intoChest, outOfChest] = makePassages(
    chestWing.mouths[1]!,
    chestWing.lighting,
    chestWing.mouths[2]!,
    chestWing.lighting,
  )
  wingPassages.get(RELIQUARY_WING)!.push(intoChest, outOfChest)

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
    const sixSided = entry.wing.id === GRAVITY_WING
    const extra: number[] = []
    for (const m of entry.mouths) {
      // **Une embrasure posée dans une pièce n'a pas de seuil à dessiner.**
      //
      // Celle d'une paroi est creusée dans son épaisseur, donc hors de l'emprise du sol,
      // et sa dalle de seuil est la seule surface à cet endroit. Celle d'un coffre est en
      // plein milieu de la salle : le sol passe déjà dessous, et les deux dalles se
      // retrouvent rigoureusement coplanaires. Les profondeurs interpolées se départagent
      // alors au dernier bit, différemment d'un pixel à l'autre et d'une image à l'autre —
      // ce qui donne une bande qui grésille au ras de la porte, d'autant plus visible que
      // les deux dalles n'ont pas la même teinte.
      //
      // On ne dessine donc pas la nôtre. Le sol de la salle est déjà là, au même endroit,
      // et il traverse l'embrasure sans rupture.
      const inTheOpen = entry.chest !== undefined && m === entry.mouths[1]
      pushReveal(extra, m, tinted(entry.wing.tint, 0.55), !inTheOpen)
    }

    const twisted = entry.wing.id === 'vrille'
    if (twisted) {
      // Les deux fonds du tube, percés de leur porte.
      pushTubeCap(extra, VRILLE, true, tinted(entry.wing.tint, 0.4), holeOf(entry.mouths[0]!))
      pushTubeCap(extra, VRILLE, false, tinted(entry.wing.tint, 0.4), holeOf(entry.mouths[1]!))
    }

    // Le coffre, posé au milieu de sa salle. Il est d'une matière franchement autre que
    // celle des parois : c'est un objet dans une pièce, pas un morceau d'architecture, et
    // il faut qu'on ait envie d'en faire le tour avant d'y entrer.
    if (entry.chest) {
      pushBlock(
        extra,
        entry.chest.min,
        entry.chest.max,
        { side: [0.46, 0.42, 0.36], top: [0.54, 0.5, 0.43] },
        { face: RELIQUARY_FACE, hole: holeOf(entry.mouths[1]!) },
      )
    }

    cells.push({
      id: entry.wing.id,
      min: entry.wing.box.min,
      max: entry.wing.box.max,
      verts: concat(
        twisted
          ? buildTwistedTube(
              VRILLE,
              {
              // Quatre faces franchement distinctes : une section carrée qui tourne
              // d'un quart de tour se superpose à elle-même, et sans ces couleurs la
              // vrille serait parfaitement invisible.
                floor: [0.58, 0.36, 0.2],
                ceiling: [0.2, 0.26, 0.24],
                left: [0.33, 0.47, 0.42],
                right: [0.47, 0.63, 0.57],
              },
              // Un anneau tous les quinze centimètres : la vrille est plus rapide en son
              // milieu qu'un profil linéaire, et des facettes s'y verraient.
              150,
            )
          : buildRoom(
              entry.wing.box.min,
              entry.wing.box.max,
              sixSided ? SIX_FLOORS : paletteFor(entry.wing.tint),
              entry.holes,
              sixSided ? { border: GRIP, edge: GRIP_COLOUR } : undefined,
            ),
        extra,
      ),
      passages: wingPassages.get(entry.wing.id)!,
      lighting: entry.lighting,
      ...(twisted ? { twist: VRILLE } : {}),
      ...(entry.chest ? { blocks: [{ ...entry.chest, door: entry.mouths[1]! }] } : {}),
      ...(sixSided ? { gravity: { grip: GRIP } } : {}),
    })
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

  const chestDoor = chestWing.mouths[1]!
  const chestView = (() => {
    const pos = {
      ...add(
        add(chestDoor.center, scale(chestDoor.normal, 4.4)),
        scale(chestDoor.right, 2.2),
      ),
      y: chestWing.wing.box.min.y + 1.65,
    }
    return { pos, forward: normalize(sub(chestDoor.center, pos)) }
  })()

  const facesView = (() => {
    const wing = wingData.find((entry) => entry.wing.id === GRAVITY_WING)!.wing
    const pos = { x: wing.box.min.x + 2.2, y: wing.box.min.y + 1.65, z: wing.box.min.z + 2.2 }
    // Le regard vise le coin opposé à mi-hauteur : viser plus haut sort le sol de l'image,
    // et une salle aux six sols dont on ne voit pas le sol ne raconte que la moitié.
    const target = { x: wing.box.max.x - 1, y: (wing.box.min.y + wing.box.max.y) / 2 - 1, z: wing.box.max.z - 1 }
    return { cell: wing.id, pos, forward: normalize(sub(target, pos)) }
  })()

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
    // **De trois quarts, et de loin.** Pris de face et de près, le coffre remplit le champ
    // et redevient ce qu'il n'est pas : une porte dans un mur. Il faut voir deux de ses
    // faces, ses arêtes contre la salle, et la nef par l'ouverture — sans quoi
    // l'impossibilité ne se voit pas, elle s'explique, ce qui n'est pas la même chose.
    chestCell: chestWing.wing.id,
    chestPos: chestView.pos,
    chestForward: chestView.forward,
    // Debout dans un coin, le regard vers le coin opposé : quatre des six faces sont dans
    // l'image, avec leurs bordures — donc la règle du lieu autant que sa géométrie.
    facesCell: facesView.cell,
    facesPos: facesView.pos,
    facesForward: facesView.forward,
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
