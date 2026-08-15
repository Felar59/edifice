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
  pushSpiral,
  pushTubeCap,
  pushWall,
  type Color,
  type Hole,
  type RoomHoles,
  type RoomPalette,
} from './geometry'
import { mouthRadiance, type CellLighting, type Colour } from './light'
import { heightAtTurn, onSquare, stepAngle, stepHeight } from './spiral'
import { frameAt, makeTwist, toWorld } from './twist'
import type { Block, Cell, Mouth, Passage, Spiral, World } from './types'

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
function mouth(
  cell: string,
  id: string,
  box: Box,
  wall: Wall,
  lateral: number,
  /** Hauteur du seuil, quand le sol n'est pas celui de la boîte — un palier d'escalier. */
  sill?: number,
): Mouth {
  const y = (sill ?? box.min.y) + DOOR_HALF_H
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

/**
 * T = F_to · demi-tour · F_from⁻¹
 *
 * Avec un **cas exact** quand les deux bouches se font face sans tourner : la
 * transformation est alors une pure translation, et la composer par matrices ne fait qu'y
 * ajouter du bruit d'arrondi.
 *
 * Ce n'est pas une optimisation mais une question de justesse. Les matrices sont en
 * flottants 32 bits ; à trois cents mètres de l'origine, une bouche posée en diagonale
 * traîne des facteurs en racine de deux dans chaque terme, et la composition rend une
 * translation fausse de vingt microns. C'est invisible à l'œil et impossible à défendre :
 * l'escalier de Penrose se franchit des centaines de fois, et l'erreur s'accumule à chaque
 * tour. Écrite directement, la translation est exacte quel que soit l'angle de la bouche.
 */
function passageTransform(from: Mouth, to: Mouth): Mat4 {
  const aligned = (a: Vec3, b: Vec3): boolean =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) < 1e-6

  if (aligned(from.right, neg(to.right)) && aligned(from.up, to.up) && aligned(from.normal, neg(to.normal))) {
    const t = create()
    t[12] = to.center.x - from.center.x
    t[13] = to.center.y - from.center.y
    t[14] = to.center.z - from.center.z
    return t
  }

  return multiply(create(), mouthFrameFlipped(to), invertRigid(create(), mouthFrame(from)))
}

/**
 * Les deux sens d'une même couture.
 *
 * Chacun porte la lumière de la pièce vers laquelle il mène. C'est ce qui fait qu'on voit la
 * teinte de la pièce voisine se déposer au sol devant sa porte.
 *
 * **Sauf quand la pièce d'en face est la même.** La radiance d'une bouche sert à faire
 * entrer chez soi l'éclairage d'ailleurs ; quand cet ailleurs est ici, il est déjà compté
 * par les lampes de la salle, et l'ajouter une seconde fois pose une flaque claire au pied
 * de chaque ouverture. C'est ce qui se voyait dans la salle du reliquaire, dont les deux
 * bouches se répondent : une bande plus lumineuse en travers du seuil, aux deux portes, que
 * rien dans le dessin n'expliquait. La règle valait déjà pour les raccords de l'escalier,
 * où elle était écrite à la main ; elle est ici pour toutes.
 */
function makePassages(
  a: Mouth,
  aLighting: CellLighting,
  b: Mouth,
  bLighting: CellLighting,
): [Passage, Passage] {
  const dark: Colour = [0, 0, 0]
  const home = a.cell === b.cell
  return [
    {
      from: a,
      to: b,
      transform: passageTransform(a, b),
      radiance: home ? dark : mouthRadiance(b, bLighting),
    },
    {
      from: b,
      to: a,
      transform: passageTransform(b, a),
      radiance: home ? dark : mouthRadiance(a, aLighting),
    },
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
/**
 * La couleur du lointain d'une salle : sa propre teinte, très assombrie.
 *
 * Chaque aile a sa température de lumière, et son horizon doit avoir la même. Un gris unique
 * pour tout le musée fait de chaque fond un mur d'une autre matière que la salle qu'il
 * termine — ce qui se remarque surtout au bout d'une enfilade, là où il n'y a plus rien
 * d'autre à regarder.
 */
function haze(tint: Colour): readonly [number, number, number] {
  // **Une brume claire, pas un fond noir.** Un lointain plus sombre que la salle qu'il
  // termine se lit comme un trou, et un musée n'a pas de trous : l'air éloigne les choses en
  // les **éclaircissant**, parce qu'il diffuse la lumière qui le traverse. Assombrir donne
  // une cave ; éclaircir donne de la distance.
  return [0.055 + tint[0] * 0.2, 0.055 + tint[1] * 0.2, 0.055 + tint[2] * 0.2]
}

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
 * Les bouches de l'escalier : **deux portes et trois raccords.**
 *
 * Un raccord est un plan invisible en travers de la volée, large comme elle et haut jusqu'au
 * plafond : on le franchit sans avoir rien vu. Il n'a pas de jumelle — on le passe dans un
 * sens et pas dans l'autre —, et c'est de cette asymétrie que tout l'escalier est fait.
 *
 * La volée dessinée fait **deux tours** et porte deux étages superposés :
 *
 * - l'**étage haut**, du tour 0 au tour 1, avec en son milieu la porte de la rotonde ;
 * - l'**étage bas**, du tour −1 au tour 0, avec en son milieu la porte de la salle basse.
 *
 * Trois raccords les relient :
 *
 * - `boucle-haute`, franchi **en montant** au sommet, repose au tour 0. Qui monte dans
 *   l'étage haut y reste, et retrouve la porte de la rotonde à chaque tour.
 * - `boucle-basse`, franchi **en montant** au tour 0, repose au tour −1. Qui monte dans
 *   l'étage bas y reste, et ne rencontre jamais que la porte de la salle basse.
 * - `plongeon`, franchi **en descendant** tout en bas, repose au sommet. Descendre change
 *   donc d'étage, indéfiniment.
 *
 * Ce qui donne, pour le visiteur : **monter est une boucle, descendre est le seul chemin.**
 * On entre par la rotonde ; on peut monter éternellement sans jamais croiser autre chose que
 * sa propre porte, ou descendre — et c'est ainsi, et seulement ainsi, qu'on trouve la salle
 * basse. Puis, une fois ressorti, il faut descendre encore pour retrouver la porte de la
 * rotonde. L'escalier n'a plus de haut ni de bas : il a un sens.
 *
 * Descendre au tour 0 ne franchit **rien**. Les deux étages y sont cousus par la géométrie
 * elle-même, continue d'un bout à l'autre des deux tours ; c'est le raccord `boucle-basse`
 * qu'on y traverse à contresens, et une couture à sens unique se laisse simplement passer.
 */
interface StairMouths {
  /** La porte de la rotonde, au milieu de l'étage haut. */
  entry: Mouth
  /** La porte de la salle basse, au milieu de l'étage bas. */
  down: Mouth
  /** Les trois départs de raccord. */
  seams: [Mouth, Mouth, Mouth]
  /** Et leurs arrivées, dans le même ordre. */
  landings: [Mouth, Mouth, Mouth]
}

function stairMouths(): StairMouths {
  const { centre, inner, outer, headroom } = STAIR

  /**
   * Le raccord, en travers de la volée à l'angle du pilier.
   *
   * Sa section est **diagonale** — d'un angle du pilier à l'angle de la salle — et rien ne
   * s'y oppose : une bouche est un rectangle quelconque, pas forcément parallèle aux axes.
   * Ce que l'on gagne à le poser là vaut largement cette diagonale : le sol y est plat des
   * deux côtés, et il n'y a plus aucune marche à faire coïncider.
   */
  const loop = (id: string, step: number, toward: 1 | -1): Mouth => {
    const angle = stepAngle(STAIR, step)
    const near = onSquare(centre, inner, angle, 0)
    const far = onSquare(centre, outer, angle, 0)
    const span = Math.hypot(far.x - near.x, far.z - near.z)
    const radial = { x: (far.x - near.x) / span, y: 0, z: (far.z - near.z) / span }
    const right = { x: -radial.x * toward, y: 0, z: -radial.z * toward }

    return {
      id,
      cell: PENROSE_WING,
      center: {
        x: (near.x + far.x) / 2,
        y: stepHeight(STAIR, step) + headroom / 2,
        z: (near.z + far.z) / 2,
      },
      right,
      up: { x: 0, y: 1, z: 0 },
      // right × up, calculé à la main : la normale est la tangente, dirigée vers celui qui
      // arrive.
      normal: { x: -right.z, y: 0, z: right.x },
      halfWidth: span / 2,
      halfHeight: headroom / 2,
    }
  }

  const top = STAIR.steps
  return {
    // **Les deux portes sont percées dans une paroi de la salle**, sur un palier d'angle,
    // exactement comme n'importe quelle porte du musée : elles ont donc leur embrasure et
    // leur mur autour. Une porte posée en travers de la volée, sur une cloison isolée,
    // laissait du vide sur ses côtés — il n'y avait rien d'autre à cet endroit qu'elle.
    //
    // Elles ne sont pas au même angle, et c'est réfléchi : **la porte de la salle basse est
    // aux trois quarts de l'étage bas**, donc à deux angles de pilier sous l'étage haut. Un
    // seul angle n'aurait pas suffi. Depuis le bas de l'étage haut, le regard porte jusqu'à
    // l'angle suivant et pas au-delà ; une porte posée là se serait vue d'en haut, avec la
    // salle basse apparaissant derrière elle — ce qui trahit tout, puisque **on ne doit
    // jamais voir en montant ce qui ne se mérite qu'en descendant.**
    entry: mouth(PENROSE_WING, 'penrose.porte', PENROSE_BOX, 'east', 312.75, stepHeight(STAIR, 31)),
    down: mouth(
      PENROSE_WING,
      'penrose.descente',
      PENROSE_BOX,
      'north',
      312.75,
      stepHeight(STAIR, 31 - top - top / 4),
    ),
    seams: [
      loop('penrose.boucle-haute', top, 1),
      loop('penrose.boucle-basse', -top / 4, 1),
      loop('penrose.plongeon', -top - top / 4, -1),
    ],
    landings: [
      loop('penrose.reprise-haute', 0, -1),
      loop('penrose.reprise-basse', -top - top / 4, -1),
      // **Le plongeon retombe trois quarts de tour plus haut, pas au sommet.** Deux tours
      // pleins séparent donc ses deux bouches, ce qui en fait une **pure translation** : le
      // même angle du pilier des deux côtés. Posé au sommet, il aurait fallu tourner d'un
      // quart de tour en plus — l'escalier est bien invariant par quart de tour, l'illusion
      // aurait tenu, mais une rotation de quatre-vingt-dix degrés à trois cents mètres de
      // l'origine ne se calcule plus exactement en flottant 32 bits. On retombe donc juste
      // au-dessus de la porte de la rotonde, ce qui est d'ailleurs le bon endroit : en
      // descendant, c'est elle qu'on cherche.
      loop('penrose.retour', (top * 3) / 4, 1),
    ],
  }
}

/** Le pilier : le cœur plein autour duquel l'escalier tourne. */
function pillarBox(): Box {
  return {
    min: { x: STAIR.centre.x - STAIR.inner, y: PENROSE_BOX.min.y, z: STAIR.centre.z - STAIR.inner },
    max: { x: STAIR.centre.x + STAIR.inner, y: PENROSE_BOX.max.y, z: STAIR.centre.z + STAIR.inner },
  }
}

/**
 * L'éclairage de l'escalier : une lampe par quart de tour, contre le pilier.
 *
 * Contre le pilier et non au plafond : il n'y a pas un sol mais un ruban qui monte, et une
 * source haute laisserait le pied des marches dans le noir.
 *
 * Surtout, **les lampes sont périodiques d'un tour exactement**. À travers un raccord on
 * voit la volée d'en face éclairée par les lampes d'en face, alors qu'on est éclairé par les
 * siennes : si les deux séries ne se correspondent pas, la couture se signale par un
 * changement de lumière — et aucune correction de géométrie ne rattrape cela. Un quart de
 * tour d'écart, et le motif se recopie de lui-même d'un étage à l'autre.
 *
 * Onze lampes pour deux tours et quart, marge comprise. C'est ce qui a fait monter le
 * plafond du nuanceur de six à douze : au-delà, elles étaient coupées en silence.
 */
function stairLighting(tint: Colour): CellLighting {
  const lights = []
  for (let i = -6; i <= 4; i++) {
    const turn = 0.125 + i * 0.25
    const angle = STAIR.cut + 2 * Math.PI * turn
    const at = onSquare(STAIR.centre, STAIR.inner + 0.6, angle, 0)
    lights.push({
      position: { ...at, y: heightAtTurn(STAIR, turn) + STAIR.headroom - 0.5 },
      colour: tint,
      intensity: 4,
      radius: 7,
    })
  }
  return { ambient: [tint[0] * 0.07, tint[1] * 0.07, tint[2] * 0.07], lights }
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
 * **L'escalier de Penrose** — des marches sans fin autour d'un pilier.
 *
 * On y entre de plain-pied, sur un palier. On monte. Un quart de tour plus haut on passe
 * derrière le pilier, puis on revient — et l'on retrouve **sa propre porte d'entrée**, à
 * la hauteur exacte où on l'a quittée. On peut recommencer indéfiniment.
 *
 * Le tour de passe-passe tient en une ligne : la hauteur ne dépend que de l'angle autour
 * du pilier, un tour complet fait donc gagner exactement `rise`, et une couture posée au
 * raccord translate de cette hauteur. On la franchit sans rien sentir, parce qu'à
 * l'endroit précis où elle se trouve, la marche suivante tombe exactement là où l'œil
 * l'attend — une marche plus haut que celle qu'on quitte, ni plus ni moins.
 *
 * **Le pilier est indispensable.** Il n'est pas un ornement mais ce qui empêche de voir
 * l'escalier d'un bout à l'autre : sans lui, on embrasserait la volée entière du regard
 * et le raccord se verrait. Le dessin de Penrose, lui, est un carré vide, et il ne tient
 * que parce qu'on le regarde d'un seul point de vue.
 *
 * **Le raccord est placé derrière le pilier**, à l'opposé de l'entrée. On ne le voit donc
 * jamais en arrivant, et on ne l'aborde que par le haut, en montant.
 *
 * **Descendre ne boucle pas.** La couture n'a pas de jumelle : elle se franchit en
 * montant, pas en descendant. Qui descend arrive au pied des marches, devant la cloison
 * du raccord — et dans cette cloison il y a une porte, qui donne sur la salle basse. Monter
 * est sans fin ; descendre mène quelque part.
 */
const PENROSE_WING = 'penrose'
const PENROSE_BOX: Box = { min: { x: 300, y: 0, z: 300 }, max: { x: 314, y: 32, z: 314 } }

/**
 * Seize mètres par tour sur soixante-quatre marches, soit vingt-cinq centimètres de
 * hauteur pour soixante-dix de giron au rayon moyen : une volée monumentale, à l'échelle
 * du reste du musée.
 *
 * Le raccord est en `π`, c'est-à-dire plein ouest — dos au pilier depuis la porte, qui
 * est au nord. Le palier de six marches est placé devant elle.
 */
const STAIR: Spiral = {
  // Le tour 0 est le pied de l'étage haut ; tout le reste descend en dessous.
  centre: { x: 307, y: 16, z: 307 },
  inner: 3,
  outer: 7,
  rise: 12,
  steps: 64,
  // **Le raccord est posé sur un angle du pilier, donc sur un palier.** C'est ce qui le
  // rend imperceptible : à plat, il n'y a ni marche ni contremarche à raccorder, et les
  // deux côtés de la couture montrent exactement le même sol horizontal. Posé en pleine
  // volée, il fallait faire coïncider des nez de marche au centimètre — et le moindre
  // écart s'y voyait, en géométrie comme en éclairage.
  cut: (5 * Math.PI) / 4,
  // Trois mètres de hauteur libre, partout la même : le plafond est un ruban qui suit les
  // marches, et c'est ce qui empêche le raccord de se trahir.
  //
  // Trois et non trois vingt : la moitié de cette hauteur sert d'ordonnée au centre de la
  // bouche du raccord, et tout le musée doit tenir sur la **grille au quart de mètre** que
  // le flottant 32 bits impose à trois cents mètres de l'origine. 1,60 en sortait.
  headroom: 3,
  // **Quatre paliers, un par angle du pilier, et rien d'autre.** On tourne sur du plat,
  // comme dans un escalier réel — et surtout, c'est là que les portes peuvent être percées :
  // le sol n'est de niveau que le long d'un rayon, donc jamais en travers d'une paroi. Les
  // angles tombent sur les
  // marches 0, 16, 32 et 48 puisque le raccord est lui-même à un angle ; chaque palier est
  // centré dessus. Un cinquième palier en pleine volée, comme il y en a eu un, se remarque
  // aussitôt : on voit des marches d'un côté et un plat de l'autre, et la volée cesse
  // d'être régulière.
  landings: [
    { at: 62, count: 4 },
    { at: 14, count: 4 },
    { at: 30, count: 4 },
    { at: 46, count: 4 },
  ],
  // **Deux étages superposés et rigoureusement identiques, décalés d'un quart de tour.**
  //
  // L'étage haut occupe [0, 1] et porte la porte de la rotonde ; l'étage bas occupe
  // [−1,25, −0,25] et porte celle de la salle basse. Chacun se referme sur lui-même en
  // montant, et l'on ne passe de l'un à l'autre qu'en descendant.
  //
  // **Le quart de tour de décalage n'est pas un ajustement mais une nécessité.** Les deux
  // étages ont d'abord été posés bout à bout, l'un finissant où l'autre commence. Or la
  // boucle haute repose le grimpeur exactement sur le plan où la boucle basse se franchit,
  // et dans le sens où elle se franchit : arrivé là, on la traversait dans la foulée et l'on
  // se retrouvait à l'étage du dessous après un seul tour. Deux coutures ne peuvent pas
  // partager un plan si l'une y dépose dans la direction que l'autre attend.
  //
  // Le décalage règle aussi ce qui se voit : entre le pied de l'étage haut et la porte de la
  // salle basse, il y a désormais **deux angles de pilier**, donc rien à apercevoir.
  from: -1.25,
  turns: 2.25,
}


/** La salle basse, où l'on aboutit en descendant. */
/**
 * **Les matières.** Le nuanceur les calcule à partir des seules coordonnées de surface —
 * pas une image, pas un octet à charger. Le numéro voyage avec la couleur, en quatrième
 * composante ; voir `Color` dans `geometry.ts`.
 */
const MATTER = {
  /** Le quadrillage d'un mètre : un outil de mise au point avant d'être un décor. */
  neutre: 0,
  marbre: 1,
  parquet: 2,
  moquette: 3,
  /** Mur de galerie : lambris bas, cimaise à quatre-vingt-dix, plâtre au-dessus. */
  lambris: 4,
  pierre: 5,
  caissons: 6,
  /** Béton banché, avec la trace des planches de coffrage et les trous de banche. */
  beton: 7,
  tole: 8,
  platre: 9,
} as const

/** Une couleur et sa matière. */
function made(colour: Color, matter: number): Color {
  return [colour[0], colour[1], colour[2], matter]
}

/**
 * **Les quatre cabinets de la salle basse.**
 *
 * Le musée s'est construit jusqu'ici sur des tricheries de géométrie, dans des salles
 * volontairement nues : une salle qui a quelque chose à démontrer ne doit rien avoir d'autre
 * à montrer. Ces quatre-là ne démontrent rien. Elles sont là pour la **direction
 * artistique** — pour éprouver les matières, la lumière et l'échelle côte à côte, dans des
 * pièces qu'on peut comparer d'un coup d'œil parce qu'on passe de l'une à l'autre par le
 * même palier.
 *
 * Quatre partis pris, franchement distincts, et aucun compromis entre eux :
 *
 * - **la galerie**, celle de l'ancien portfolio : marbre, lambris, plafond à caissons,
 *   colonnade. Chaude, cossue, rassurante ;
 * - **le silo**, la direction artistique annoncée du musée : béton banché, échelle
 *   écrasante, une seule lumière dure et un bloc monumental posé de travers ;
 * - **l'atelier** : tôle rivetée, dalle de pierre, une poutre en travers. Utilitaire ;
 * - **la chambre claire** : parquet, plâtre, presque rien. Le repos après les trois autres.
 *
 * Elles se rejoignent toutes par la salle basse, qui est elle-même une crypte de pierre :
 * on descend l'escalier, et l'on tombe dans un endroit qui a enfin une matière.
 */
interface Cabinet {
  id: string
  box: Box
  /** La paroi de la salle basse où sa porte est percée, et son abscisse. */
  wall: Wall
  lateral: number
  tint: Colour
  palette: RoomPalette
  /** La structure propre de la salle : colonnes, blocs, poutres. */
  build: (out: number[], box: Box) => Block[]
  lighting: (box: Box, mouths: Mouth[]) => CellLighting
}

const CABINET_SIDE = 16
const CABINET_HEIGHT = 7

function cabinetBox(x: number): Box {
  return {
    min: { x, y: 0, z: 1000 },
    max: { x: x + CABINET_SIDE, y: CABINET_HEIGHT, z: 1000 + CABINET_SIDE },
  }
}

/** Un pilier plein, du sol au plafond, avec sa base et son chapiteau. */
function column(out: number[], x: number, z: number, box: Box, shaft: Color, cap: Color): Block {
  const half = 0.55
  const solid = {
    min: { x: x - half, y: box.min.y, z: z - half },
    max: { x: x + half, y: box.max.y, z: z + half },
  }
  pushBlock(out, solid.min, solid.max, { side: shaft })
  // Base et chapiteau : deux dés à peine plus larges. C'est peu, et c'est ce qui distingue
  // une colonne d'un poteau.
  for (const y of [box.min.y, box.max.y - 0.3]) {
    pushBlock(
      out,
      { x: x - half - 0.12, y, z: z - half - 0.12 },
      { x: x + half + 0.12, y: y + 0.3, z: z + half + 0.12 },
      { side: cap, top: cap },
    )
  }
  return solid
}

const CABINETS: Cabinet[] = [
  {
    id: 'galerie',
    box: cabinetBox(1000),
    wall: 'south',
    lateral: 915,
    tint: [1, 0.93, 0.8],
    palette: {
      floor: made([0.72, 0.7, 0.66], MATTER.marbre),
      ceiling: made([0.6, 0.58, 0.54], MATTER.caissons),
      wall: made([0.68, 0.64, 0.56], MATTER.lambris),
    },
    build: (out, box) => {
      const shaft = made([0.6, 0.57, 0.51], MATTER.marbre)
      const cap = made([0.66, 0.63, 0.57], MATTER.platre)
      const blocks: Block[] = []
      for (const x of [box.min.x + 4, box.max.x - 4]) {
        for (const z of [box.min.z + 4, box.max.z - 4]) {
          blocks.push(column(out, x, z, box, shaft, cap))
        }
      }
      // Deux socles vides au centre : un musée se reconnaît à ce qu'il réserve une place
      // à ce qu'il n'expose pas encore.
      const centre = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 }
      for (const dz of [-2.5, 2.5]) {
        const plinth = {
          min: { x: centre.x - 0.6, y: box.min.y, z: centre.z + dz - 0.6 },
          max: { x: centre.x + 0.6, y: box.min.y + 0.9, z: centre.z + dz + 0.6 },
        }
        pushBlock(out, plinth.min, plinth.max, {
          side: made([0.5, 0.47, 0.42], MATTER.marbre),
          top: made([0.62, 0.6, 0.55], MATTER.marbre),
        })
        blocks.push(plinth)
      }
      return blocks
    },
    lighting: (box, mouths) => lightingFor(box, [1, 0.93, 0.8], mouths),
  },
  {
    id: 'silo',
    box: cabinetBox(1100),
    wall: 'east',
    lateral: 915,
    tint: [0.78, 0.82, 0.9],
    palette: {
      floor: made([0.4, 0.41, 0.44], MATTER.beton),
      ceiling: made([0.33, 0.34, 0.37], MATTER.beton),
      wall: made([0.46, 0.47, 0.5], MATTER.beton),
    },
    build: (out, box) => {
      // Un bloc monumental, posé de travers et sans raison. C'est le parti pris : du béton,
      // une échelle qui écrase, et rien qui explique.
      const monolith = {
        min: { x: box.min.x + 5, y: box.min.y, z: box.min.z + 5.5 },
        max: { x: box.min.x + 9.5, y: box.min.y + 5.5, z: box.min.z + 8 },
      }
      pushBlock(out, monolith.min, monolith.max, {
        side: made([0.36, 0.37, 0.4], MATTER.beton),
        top: made([0.42, 0.43, 0.46], MATTER.beton),
      })
      return [monolith]
    },
    lighting: (box) => ({
      // Une seule source, haute et froide, et beaucoup d'ombre. L'ambiance est presque
      // nulle : dans une salle de béton, ce qui n'est pas éclairé doit être noir.
      ambient: [0.02, 0.022, 0.028],
      lights: [
        {
          position: { x: box.min.x + 4, y: box.max.y - 0.4, z: box.max.z - 4 },
          colour: [0.82, 0.86, 1],
          intensity: 16,
          radius: 22,
        },
      ],
    }),
  },
  {
    id: 'atelier',
    box: cabinetBox(1200),
    wall: 'west',
    lateral: 915,
    tint: [0.8, 0.95, 0.85],
    palette: {
      floor: made([0.42, 0.44, 0.42], MATTER.pierre),
      ceiling: made([0.3, 0.33, 0.32], MATTER.tole),
      wall: made([0.44, 0.48, 0.46], MATTER.tole),
    },
    build: (out, box) => {
      // Une poutre en travers, à hauteur d'homme et demi : elle donne l'échelle de la salle
      // mieux que n'importe quel objet posé au sol.
      const beam = {
        min: { x: box.min.x + 1, y: box.min.y + 3.2, z: (box.min.z + box.max.z) / 2 - 0.35 },
        max: { x: box.max.x - 1, y: box.min.y + 3.9, z: (box.min.z + box.max.z) / 2 + 0.35 },
      }
      pushBlock(out, beam.min, beam.max, {
        side: made([0.38, 0.4, 0.39], MATTER.tole),
        top: made([0.42, 0.45, 0.43], MATTER.tole),
      })
      // Et deux caisses, parce qu'un atelier sans rien qui traîne n'est pas un atelier.
      const blocks: Block[] = [beam]
      for (const [dx, dz, h] of [
        [3, 3, 1.2],
        [4.6, 3.4, 0.8],
      ]) {
        const crate = {
          min: { x: box.min.x + dx, y: box.min.y, z: box.max.z - dz - h },
          max: { x: box.min.x + dx + h, y: box.min.y + h, z: box.max.z - dz },
        }
        pushBlock(out, crate.min, crate.max, {
          side: made([0.45, 0.4, 0.3], MATTER.tole),
          top: made([0.5, 0.45, 0.34], MATTER.tole),
        })
        blocks.push(crate)
      }
      return blocks
    },
    lighting: (box, mouths) => lightingFor(box, [0.8, 0.95, 0.85], mouths),
  },
  {
    id: 'chambre',
    box: cabinetBox(1300),
    wall: 'north',
    lateral: 922.5,
    tint: [1, 0.97, 0.94],
    palette: {
      floor: made([0.5, 0.38, 0.26], MATTER.parquet),
      ceiling: made([0.86, 0.85, 0.83], MATTER.platre),
      wall: made([0.88, 0.87, 0.85], MATTER.platre),
    },
    build: (out, box) => {
      // Presque rien : un banc bas, et c'est tout. Après trois salles qui insistent, une
      // qui se tait.
      const bench = {
        min: { x: (box.min.x + box.max.x) / 2 - 1.8, y: box.min.y, z: (box.min.z + box.max.z) / 2 - 0.35 },
        max: { x: (box.min.x + box.max.x) / 2 + 1.8, y: box.min.y + 0.45, z: (box.min.z + box.max.z) / 2 + 0.35 },
      }
      pushBlock(out, bench.min, bench.max, {
        side: made([0.46, 0.34, 0.22], MATTER.parquet),
        top: made([0.54, 0.4, 0.26], MATTER.parquet),
      })
      return [bench]
    },
    lighting: (box, mouths) => lightingFor(box, [1, 0.97, 0.94], mouths),
  },
]

const LOWER = 'salle-basse'
// Trente mètres de côté : la salle basse n'est plus un cul-de-sac mais un palier, et il
// lui faut quatre parois où percer quatre portes.
const LOWER_BOX: Box = { min: { x: 900, y: 0, z: 900 }, max: { x: 930, y: 8, z: 930 } }
const LOWER_TINT: Colour = [1, 0.72, 0.5]

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
/**
 * **L'espace pavé** — une salle dont les quatre parois sont cousues deux à deux.
 *
 * On y marche tout droit et l'on revient à son point de départ sans avoir tourné, sans
 * avoir rien franchi de visible. Le nord donne sur le sud, l'est sur l'ouest : la salle est
 * un tore, et un tore n'a pas de bord.
 *
 * Ce n'est pas un couloir qui reboucle comme le tunnel : ici, **on voit la répétition**. À
 * travers la paroi nord on voit la salle depuis sa paroi sud, donc l'édicule du centre, et
 * derrière lui la même salle encore, et ainsi de suite jusqu'à ce que le brouillard s'en
 * mêle. Un damier d'édicules identiques s'étend dans les quatre directions. En se
 * retournant, on s'y voit soi-même de dos — ou plutôt on verrait, si le visiteur avait un
 * corps à montrer.
 *
 * Trois points de construction méritent d'être notés.
 *
 * **Les parois ne sont pas percées, elles sont l'ouverture.** Une couture y occupe le mur
 * entier, du sol au plafond et d'un angle à l'autre ; il n'y a donc aucune paroi à
 * dessiner, et pas d'embrasure non plus — une embrasure suppose une épaisseur, et il n'y a
 * rien à traverser.
 *
 * **La porte de sortie est au milieu de la salle**, dans un édicule, et non dans une paroi
 * — il n'y a plus de paroi où la percer. C'est la même mécanique que le coffre du
 * reliquaire : une bouche portée par un bloc plein, avec sa collision propre.
 *
 * **Une couture qui relie la salle à elle-même ne transmet pas de lumière**, et les quatre
 * en sont. L'éclairage se recopie tout seul d'une copie à l'autre, puisque c'est le même.
 */
const PAVE_WING = 'pave'
const PAVE_BOX: Box = { min: { x: 400, y: 0, z: 400 }, max: { x: 410, y: 4, z: 410 } }

/** L'édicule du centre, et sa porte : la seule issue. */
const KIOSK: Box = { min: { x: 403.5, y: 0, z: 403.5 }, max: { x: 406.5, y: 2.5, z: 406.5 } }
const KIOSK_FACE: Wall = 'north'

/**
 * Les cinq bouches de la salle pavée : la porte de l'édicule, et les quatre parois.
 *
 * Les rectangles des parois font **exactement** la taille de la paroi. Une bouche plus
 * large déborderait sur celle d'à côté et l'on verrait, dans chaque angle, un éclat de
 * l'image voisine ; une bouche plus étroite laisserait une bande de mur qu'on ne peut pas
 * franchir, dans une salle qui n'a pas de mur.
 *
 * Le corps s'arrête à un rayon des parois latérales, et la bouche s'arrête au même endroit :
 * les deux contraintes se rencontrent **exactement** dans l'angle. C'est pourquoi les tests
 * de franchissement s'accordent un millimètre de tolérance — deux flottants qui devraient
 * être égaux ne le sont pas toujours, et un angle où l'on reste coincé dans une salle sans
 * bord serait le comble.
 */
function paveMouths(): { door: Mouth; walls: [Mouth, Mouth, Mouth, Mouth] } {
  const cx = (PAVE_BOX.min.x + PAVE_BOX.max.x) / 2
  const cz = (PAVE_BOX.min.z + PAVE_BOX.max.z) / 2
  const cy = (PAVE_BOX.min.y + PAVE_BOX.max.y) / 2
  const halfX = (PAVE_BOX.max.x - PAVE_BOX.min.x) / 2
  const halfZ = (PAVE_BOX.max.z - PAVE_BOX.min.z) / 2
  const halfY = (PAVE_BOX.max.y - PAVE_BOX.min.y) / 2
  const up = { x: 0, y: 1, z: 0 }
  const face = (
    id: string,
    center: Vec3,
    right: Vec3,
    normal: Vec3,
    halfWidth: number,
  ): Mouth => ({ id, cell: PAVE_WING, center, right, up, normal, halfWidth, halfHeight: halfY })

  return {
    door: blockMouth(PAVE_WING, 'pave.porte', KIOSK, KIOSK_FACE, cx),
    walls: [
      // Nord (z = min), normale vers l'intérieur : right × up = normal.
      face(
        'pave.nord',
        { x: cx, y: cy, z: PAVE_BOX.min.z },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        halfX,
      ),
      face(
        'pave.sud',
        { x: cx, y: cy, z: PAVE_BOX.max.z },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 },
        halfX,
      ),
      face(
        'pave.ouest',
        { x: PAVE_BOX.min.x, y: cy, z: cz },
        { x: 0, y: 0, z: -1 },
        { x: 1, y: 0, z: 0 },
        halfZ,
      ),
      face(
        'pave.est',
        { x: PAVE_BOX.max.x, y: cy, z: cz },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: 0, z: 0 },
        halfZ,
      ),
    ],
  }
}

/**
 * L'éclairage de la salle pavée : quatre lampes au plafond, aux quarts de la salle.
 *
 * La disposition compte plus qu'ailleurs. Ce qu'on voit à travers une paroi est la salle
 * elle-même, translatée : si l'éclairage n'était pas symétrique par cette translation, la
 * copie d'à côté serait éclairée autrement que celle où l'on se tient, et la répétition
 * cesserait d'être crédible. Ici la symétrie est gratuite — c'est la même salle, donc les
 * mêmes lampes —, mais poser les lampes aux quarts plutôt qu'au centre évite en plus qu'une
 * bande sombre coure le long des parois, c'est-à-dire au raccord de deux copies.
 */
function paveLighting(tint: Colour): CellLighting {
  const lights = []
  for (const fx of [0.25, 0.75]) {
    for (const fz of [0.25, 0.75]) {
      lights.push({
        position: {
          x: PAVE_BOX.min.x + (PAVE_BOX.max.x - PAVE_BOX.min.x) * fx,
          y: PAVE_BOX.max.y - 0.35,
          z: PAVE_BOX.min.z + (PAVE_BOX.max.z - PAVE_BOX.min.z) * fz,
        },
        colour: tint,
        intensity: 5,
        radius: 9,
      })
    }
  }
  return { ambient: [tint[0] * 0.07, tint[1] * 0.07, tint[2] * 0.07], lights }
}

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
function blockMouth(
  cell: string,
  id: string,
  box: Box,
  wall: Wall,
  lateral: number,
  sill?: number,
): Mouth {
  const y = (sill ?? box.min.y) + DOOR_HALF_H
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
    id: PENROSE_WING,
    box: PENROSE_BOX,
    // La paroi et la cote de la porte, qui doivent s'accorder avec la bouche construite par
    // `stairMouths`. Elles ne le faisaient plus : la porte a déménagé sur un palier d'angle
    // et l'aile déclarait toujours le milieu de la paroi nord. Le trou était donc percé dans
    // une paroi, la bouche posée dans une autre — on entrait à travers un mur plein, et de
    // l'intérieur la porte n'existait pas. D'où l'invariant qui vérifie désormais que toute
    // bouche de paroi perce bien la sienne.
    wall: 'east',
    lateral: 312.75,
    tint: [1, 0.78, 0.42],
    hubWall: 'east',
    hubLateral: -3.5,
    purpose: 'l’escalier de Penrose : des marches sans fin autour d’un pilier',
  },
  {
    id: PAVE_WING,
    box: PAVE_BOX,
    // La salle pavée n'a pas de paroi où percer sa porte : celle-ci est portée par
    // l'édicule du centre, et ces deux champs ne servent alors à rien.
    wall: 'east',
    lateral: 405,
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
  /** Une pose sur l'escalier de Penrose, la volée montant devant soi. */
  stairCell: string
  stairPos: Vec3
  stairForward: Vec3
  pavedCell: string
  pavedPos: Vec3
  pavedForward: Vec3
  cryptCell: string
  cryptPos: Vec3
  cryptForward: Vec3
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
  const stair = stairMouths()
  const pave = paveMouths()

  for (const wing of WINGS) {
    const twisted = wing.id === 'vrille'
    const reliquary = wing.id === RELIQUARY_WING
    const chest = reliquary ? reliquaryIn(wing.box) : null

    const mouths = twisted
      ? [tubeMouth('vrille.porte', true), tubeMouth('vrille.retour', false)]
      : wing.id === PAVE_WING
        ? [pave.door, ...pave.walls]
        : wing.id === PENROSE_WING
          ? [stair.entry, stair.down, ...stair.seams]
        : [mouth(wing.id, `${wing.id}.porte`, wing.box, wing.wall, wing.lateral)]
    if (chest) {
      mouths.push(
        blockMouth(wing.id, 'reliquaire.coffre', chest, RELIQUARY_FACE, middleOf(chest, RELIQUARY_FACE)),
        mouth(wing.id, 'reliquaire.sortie', wing.box, RELIQUARY_EXIT_WALL, middleOf(wing.box, RELIQUARY_EXIT_WALL)),
      )
    }

    // La salle pavée ne perce aucune paroi : elle n'en a pas. Ses quatre côtés sont des
    // coutures pleine hauteur, et sa porte est dans l'édicule du milieu.
    const holes: RoomHoles =
      twisted || wing.id === PAVE_WING ? {} : { [wing.wall]: [holeOf(mouths[0]!)] }
    // L'escalier a deux portes, à deux angles différents du pilier.
    if (wing.id === PENROSE_WING) holes.north = [holeOf(mouths[1]!)]
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
          : wing.id === PENROSE_WING
            ? stairLighting(wing.tint)
            : wing.id === PAVE_WING
              ? paveLighting(wing.tint)
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
  // --- L'escalier de Penrose et la salle basse -------------------------------
  //
  // **Aucun des trois raccords n'a de jumelle.** On les franchit dans un sens et pas dans
  // l'autre, ce qu'aucun espace ordinaire ne permet : le recollement est *orienté*.
  //
  // Deux d'entre eux referment une boucle en montant, un par étage — d'où le fait qu'on
  // puisse monter sans fin sans jamais rencontrer autre chose que la porte de son propre
  // étage. Le troisième se franchit en descendant, tout en bas, et repose au sommet : c'est
  // lui qui fait que descendre change d'étage au lieu de s'arrêter.
  //
  // Le résultat est une machine à deux états dont on ne sort qu'en descendant, et dont le
  // visiteur ne peut pas déduire l'état sans regarder quelle porte se présente à lui.
  //
  // **Une couture qui relie une cellule à elle-même ne transmet aucune lumière**, et le
  // raccord en est une. La radiance d'une bouche sert à faire entrer l'éclairage de la
  // pièce d'en face ; quand la pièce d'en face est la même, cet éclairage est déjà compté
  // par ses propres lampes, et l'ajouter poserait une bande claire en travers de la volée.
  const penroseWing = wingData.find((entry) => entry.wing.id === PENROSE_WING)!
  const lowerMouth = mouth(LOWER, 'salle-basse.porte', LOWER_BOX, 'north', 907.5)
  const lowerLighting = lightingFor(LOWER_BOX, LOWER_TINT, [lowerMouth])

  const stairSeams: Passage[] = stair.seams.map((from, i) => ({
    from,
    to: stair.landings[i]!,
    transform: passageTransform(from, stair.landings[i]!),
    radiance: [0, 0, 0],
    oneWay: true,
  }))
  const [intoLower, outOfLower] = makePassages(
    stair.down,
    penroseWing.lighting,
    lowerMouth,
    lowerLighting,
  )
  wingPassages.get(PENROSE_WING)!.push(...stairSeams, intoLower)
  const lowerPassages: Passage[] = [outOfLower]

  // **Les deux coutures de la salle pavée**, nord contre sud et ouest contre est.
  //
  // Elles ont chacune leur jumelle, contrairement aux raccords de l'escalier : on les
  // franchit dans les deux sens, et franchir puis revenir sur ses pas doit ramener très
  // exactement où l'on était. C'est ce qui fait de la salle un tore et non un piège.
  //
  // Les deux bouches d'une même couture se font face sans tourner, donc la transformation
  // est une **pure translation** — de la largeur de la salle, exactement. Rien ne pivote,
  // rien ne change d'échelle : on ne peut pas s'apercevoir qu'on l'a franchie.
  const paveWing = wingData.find((entry) => entry.wing.id === PAVE_WING)!
  const [northSouth, southNorth] = makePassages(
    paveWing.mouths[1]!,
    paveWing.lighting,
    paveWing.mouths[2]!,
    paveWing.lighting,
  )
  const [westEast, eastWest] = makePassages(
    paveWing.mouths[3]!,
    paveWing.lighting,
    paveWing.mouths[4]!,
    paveWing.lighting,
  )
  wingPassages.get(PAVE_WING)!.push(northSouth, southNorth, westEast, eastWest)

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
      fogColour: haze(hubTint),
      min: HUB_BOX.min,
      max: HUB_BOX.max,
      verts: concat(buildRoom(HUB_BOX.min, HUB_BOX.max, paletteFor(hubTint), hubHoles), hubExtra),
      passages: hubPassages,
      lighting: hubLighting,
    },
  ]

  for (const entry of wingData) {
    const sixSided = entry.wing.id === GRAVITY_WING
    const stairs = entry.wing.id === PENROSE_WING
    const paved = entry.wing.id === PAVE_WING
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
      // Une bouche posée en pleine salle — celle d'un coffre, celle d'un édicule — n'a pas
      // de seuil à dessiner : le sol passe déjà dessous.
      const inTheOpen = (entry.chest !== undefined && m === entry.mouths[1]) || paved
      // Les parois de la salle pavée sont des ouvertures pleine hauteur : ni jambage ni
      // linteau, il n'y a pas d'épaisseur à traverser.
      if (paved && entry.mouths.indexOf(m) >= 1) continue
      // Les raccords de l'escalier ne sont pas des portes mais des plans en travers de la
      // volée : ni jambage ni linteau, sans quoi on verrait un cadre flotter au milieu des
      // marches — et c'est précisément ce qu'il ne faut pas voir. Seules les deux premières
      // bouches de l'escalier sont des portes.
      if (stairs && entry.mouths.indexOf(m) >= 2) continue
      pushReveal(extra, m, tinted(entry.wing.tint, 0.55), !inTheOpen)
    }

    // L'escalier : le ruban de marches, le pilier, et la cloison du raccord.
    if (stairs) {
      pushSpiral(extra, STAIR, {
        tread: tinted(entry.wing.tint, 0.62),
        riser: tinted(entry.wing.tint, 0.44),
        under: tinted(entry.wing.tint, 0.3),
        ceiling: tinted(entry.wing.tint, 0.38),
      })
    }

    const twisted = entry.wing.id === 'vrille'
    if (twisted) {
      // Les deux fonds du tube, percés de leur porte.
      pushTubeCap(extra, VRILLE, true, tinted(entry.wing.tint, 0.4), holeOf(entry.mouths[0]!))
      pushTubeCap(extra, VRILLE, false, tinted(entry.wing.tint, 0.4), holeOf(entry.mouths[1]!))
    }

    // L'édicule de la salle pavée : le seul objet de la pièce, donc le seul repère — et
    // c'est à lui qu'on voit que la salle se répète, puisqu'on en aperçoit un damier.
    if (paved) {
      pushBlock(
        extra,
        KIOSK.min,
        KIOSK.max,
        { side: tinted(entry.wing.tint, 0.36), top: tinted(entry.wing.tint, 0.46) },
        { face: KIOSK_FACE, hole: holeOf(entry.mouths[0]!) },
      )
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

    // Le pilier de l'escalier, du sol au plafond. Sans chapeau : il touche le plafond, et
    // deux surfaces dans le même plan se disputeraient les pixels.
    if (stairs) {
      pushBlock(extra, pillarBox().min, pillarBox().max, { side: tinted(entry.wing.tint, 0.34) })
    }

    cells.push({
      id: entry.wing.id,
      fogColour: haze(entry.wing.tint),
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
              paved,
            ),
        extra,
      ),
      passages: wingPassages.get(entry.wing.id)!,
      lighting: entry.lighting,
      ...(twisted ? { twist: VRILLE } : {}),
      ...(entry.chest ? { blocks: [{ ...entry.chest, door: entry.mouths[1]! }] } : {}),
      ...(paved
        ? {
            blocks: [{ ...KIOSK, door: entry.mouths[0]! }],
            // Le réseau : quatre copies de part et d'autre, soit quatre-vingt-une salles.
            // C'est moins cher qu'une seule passe de portail, et il n'y a plus de coupure.
            lattice: {
              x: PAVE_BOX.max.x - PAVE_BOX.min.x,
              z: PAVE_BOX.max.z - PAVE_BOX.min.z,
              radius: 4,
            },
            // Un horizon un peu plus proche qu'ailleurs : c'est lui qui efface le bord du
            // réseau. Pas trop proche pour autant — l'intérêt de la salle est justement de
            // voir loin, et une brume qui ferme à vingt mètres la rendrait ordinaire.
            fog: 0.028,
          }
        : {}),
      ...(sixSided ? { gravity: { grip: GRIP } } : {}),
      ...(stairs
        ? {
            spiral: STAIR,
            // Le pilier, et rien d'autre. La volée n'a plus de bout : ses deux extrémités
            // sont des raccords, et la cloison qui fermait le bas — avec sa boîte de
            // collision alignée sur les axes qui débordait largement une paroi posée en
            // diagonale, donc un mur invisible en travers du palier — n'a plus lieu d'être.
            blocks: [pillarBox()],
          }
        : {}),
    })
  }

  // --- La salle basse et ses quatre cabinets ---------------------------------
  //
  // La salle basse cesse d'être un cul-de-sac : c'est un palier, et l'on y choisit une
  // matière. Elle est elle-même de pierre — une crypte au pied de l'escalier — et ses quatre
  // portes donnent sur quatre partis pris qui ne se ressemblent en rien.
  {
    const holes: RoomHoles = { north: [holeOf(lowerMouth)] }
    const extra: number[] = []
    pushReveal(extra, lowerMouth, made(tinted(LOWER_TINT, 0.55), MATTER.pierre))

    for (const cabinet of CABINETS) {
      const here = mouth(LOWER, `salle-basse.vers-${cabinet.id}`, LOWER_BOX, cabinet.wall, cabinet.lateral)
      // La porte du cabinet est au milieu de sa paroi nord : peu importe laquelle, une
      // couture ne demande rien de plus qu'un rectangle de chaque côté.
      const there = mouth(
        cabinet.id,
        `${cabinet.id}.porte`,
        cabinet.box,
        'north',
        (cabinet.box.min.x + cabinet.box.max.x) / 2,
      )

      const inner: number[] = []
      const blocks = cabinet.build(inner, cabinet.box)
      const lighting = cabinet.lighting(cabinet.box, [there])
      const [fromLower, fromCabinet] = makePassages(here, lowerLighting, there, lighting)

      pushReveal(extra, here, made(tinted(LOWER_TINT, 0.55), MATTER.pierre))
      pushReveal(inner, there, cabinet.palette.wall)
      ;(holes[cabinet.wall] ??= []).push(holeOf(here))
      lowerPassages.push(fromLower)

      cells.push({
        id: cabinet.id,
        fogColour: haze(cabinet.tint),
        min: cabinet.box.min,
        max: cabinet.box.max,
        verts: concat(
          buildRoom(cabinet.box.min, cabinet.box.max, cabinet.palette, {
            north: [holeOf(there)],
          }),
          inner,
        ),
        passages: [fromCabinet],
        lighting,
        ...(blocks.length ? { blocks } : {}),
      })
    }

    cells.push({
      id: LOWER,
      fogColour: haze(LOWER_TINT),
      min: LOWER_BOX.min,
      max: LOWER_BOX.max,
      verts: concat(
        buildRoom(LOWER_BOX.min, LOWER_BOX.max, {
          floor: made([0.44, 0.42, 0.4], MATTER.pierre),
          ceiling: made([0.36, 0.35, 0.34], MATTER.beton),
          wall: made([0.5, 0.47, 0.44], MATTER.pierre),
        }, holes),
        extra,
      ),
      passages: lowerPassages,
      lighting: lowerLighting,
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

  const stairView = (() => {
    // Contre la paroi extérieure plutôt qu'au milieu de la volée : de là, l'escalier fuit
    // en tournant autour du pilier et l'on en voit une dizaine de marches. Au milieu, le
    // pilier occupe la moitié du champ et il ne reste rien à voir.
    const on = (turn: number, radius: number, above: number): Vec3 => {
      const angle = STAIR.cut + 2 * Math.PI * turn
      const at = onSquare(STAIR.centre, radius, angle, 0)
      return { ...at, y: stepHeight(STAIR, Math.round(turn * STAIR.steps) + 1) + above }
    }
    const pos = on(0.02, STAIR.outer - 0.8, 1.65)
    return { pos, forward: normalize(sub(on(0.2, STAIR.outer - 1.6, 1.2), pos)) }
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
    // Sur le palier bas, la volée qui monte devant soi et le pilier à main droite : c'est
    // la vue qui dit à la fois « un escalier » et « autour de quelque chose ».
    stairCell: PENROSE_WING,
    stairPos: stairView.pos,
    stairForward: stairView.forward,
    // Le long d'un côté de la salle pavée, l'édicule à main droite : le regard file entre
    // deux rangées de copies jusqu'au brouillard, et c'est la seule image qui dise à la
    // fois « une salle » et « sans fin ».
    // Le palier de la salle basse, ses quatre portes dans le champ : c'est l'image qui
    // dit tout de la direction artistique, puisqu'on y voit les quatre partis pris côte à
    // côte, chacun par son ouverture.
    cryptCell: LOWER,
    cryptPos: { x: 915, y: LOWER_BOX.min.y + 1.65, z: LOWER_BOX.max.z - 4 },
    cryptForward: { x: 0, y: -0.05, z: -1 },
    pavedCell: PAVE_WING,
    pavedPos: { x: PAVE_BOX.min.x + 1.2, y: PAVE_BOX.min.y + 1.65, z: PAVE_BOX.max.z - 1 },
    pavedForward: { x: 0, y: 0, z: -1 },
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
