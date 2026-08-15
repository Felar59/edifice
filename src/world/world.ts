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
import {
  pushBench,
  pushChandelier,
  pushColumn,
  pushCordon,
  pushDigits,
  pushFramed,
  pushPictureLight,
  pushPlant,
  pushSconce,
  pushShrub,
  pushTorchere,
} from './props'
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

/**
 * **Le pont sur le vide.**
 *
 * On pousse une porte de la rotonde et l'on est dehors, sur une passerelle d'un mètre
 * cinquante **sans garde-corps**, au-dessus d'un vide dont on ne voit pas le fond. Le musée
 * est au-dessus, en dessous, à gauche, à droite : des masses de béton de deux cents mètres
 * qui montent et descendent hors de vue. Aucune énigme, aucun objet, rien à faire — c'est le
 * seul endroit du bâtiment dont la fonction soit de faire s'arrêter le visiteur.
 *
 * ## Le vide a un fond, et c'est le ciel
 *
 * Il fallait décider ce qui arrive à qui tombe. Mourir est exclu : le plan dit « aucun
 * danger », et un vertige qui punit devient un obstacle. Poser un sol vingt mètres plus bas
 * l'est tout autant — on verrait le fond, et il n'y aurait plus de vide.
 *
 * La réponse est une **couture horizontale d'un bout à l'autre de la cellule** : le plancher
 * de la boîte est recollé à son plafond, deux cents mètres plus haut, par une translation
 * pure. On tombe, on traverse le plan du bas, on réapparaît en haut, et l'on retombe. Six
 * secondes par tour, à vingt-huit mètres par seconde, l'architecture qui défile. Et comme on
 * garde la maîtrise de son déplacement en l'air, on peut se replacer au-dessus du belvédère
 * et **atterrir dessus** : la chute n'est pas une punition, c'est un trajet.
 *
 * C'est pour cela que les masses sont **uniformes sur toute leur hauteur** et débordent la
 * boîte de quarante mètres. Une frise, un bandeau, une corniche, et l'on verrait le raccord
 * passer. Rien d'horizontal n'existe ici en dehors du niveau du pont — qui est à cent mètres
 * du plan de couture, donc noyé de brume bien avant qu'on puisse le reconnaître d'en haut.
 *
 * Ces deux bouches sont aussi des ouvertures pour le rendu : on voit à travers, donc on voit
 * la même scène répétée au-dessus et en dessous de soi. Le vide n'est pas peint, il est
 * profond.
 */
const BRIDGE = 'pont'
const BRIDGE_BOX: Box = {
  min: { x: 1000, y: -80, z: 1000 },
  max: { x: 1080, y: 80, z: 1080 },
}
/** L'axe de la passerelle, et le niveau de son tablier. */
const BRIDGE_X = 1040
const BRIDGE_DECK = 0
const BRIDGE_TINT: Colour = [0.78, 0.82, 0.88]

/** Les deux bouches de la boucle verticale : le sol de la boîte, et son plafond. */
function bridgeLoop(): { under: Mouth; over: Mouth } {
  const half = {
    halfWidth: (BRIDGE_BOX.max.x - BRIDGE_BOX.min.x) / 2,
    halfHeight: (BRIDGE_BOX.max.z - BRIDGE_BOX.min.z) / 2,
  }
  const centre = {
    x: (BRIDGE_BOX.min.x + BRIDGE_BOX.max.x) / 2,
    z: (BRIDGE_BOX.min.z + BRIDGE_BOX.max.z) / 2,
  }
  return {
    // **Sans embrasure, contrairement à toutes les autres bouches du musée.** Une bouche de
    // porte est posée au fond de son ébrasement, à vingt-cinq centimètres derrière la paroi ;
    // ici cela décalerait la boucle d'un demi-mètre, et la répétition ne serait plus exacte.
    // Il n'y a de toute façon aucune épaisseur à traverser : l'ouverture est le ciel.
    under: {
      id: 'pont.bas',
      cell: BRIDGE,
      center: { x: centre.x, y: BRIDGE_BOX.min.y, z: centre.z },
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: -1 },
      normal: { x: 0, y: 1, z: 0 },
      ...half,
    },
    over: {
      id: 'pont.haut',
      cell: BRIDGE,
      center: { x: centre.x, y: BRIDGE_BOX.max.y, z: centre.z },
      right: { x: -1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: -1 },
      normal: { x: 0, y: -1, z: 0 },
      ...half,
    },
  }
}

/**
 * La géométrie du dehors : une façade, un belvédère, une passerelle, et des masses.
 *
 * Tout ce qui est vertical déborde la boîte de quarante mètres en haut comme en bas, pour
 * que le raccord de la boucle tombe au milieu d'une surface et non sur une arête.
 */
function buildTheBridge(door: Mouth): { verts: number[]; blocks: Block[] } {
  const out: number[] = []
  const blocks: Block[] = []

  const concrete = made(tinted(BRIDGE_TINT, 0.38), MATTER.beton)
  const dark = made(tinted(BRIDGE_TINT, 0.26), MATTER.beton)
  const worn = made(tinted(BRIDGE_TINT, 0.44), MATTER.pierre)
  const under = made(tinted(BRIDGE_TINT, 0.2), MATTER.beton)

  const low = BRIDGE_BOX.min.y - 40
  const high = BRIDGE_BOX.max.y + 40

  // La façade, percée de la porte : c'est le bâtiment qu'on vient de quitter, et il monte
  // et descend hors de vue comme tout le reste.
  pushWall(out, {
    origin: { x: BRIDGE_BOX.min.x, y: low, z: BRIDGE_BOX.min.z },
    right: { x: BRIDGE_BOX.max.x - BRIDGE_BOX.min.x, y: 0, z: 0 },
    up: { x: 0, y: high - low, z: 0 },
    color: concrete,
    holes: [holeOf(door)],
  })
  // Ses contreforts. Sans eux la façade est un aplat, et un aplat n'a pas d'échelle :
  // c'est le rythme des refends qui dit qu'elle est immense, pas sa taille à l'écran.
  //
  // Chaque saillie mord de dix centimètres dans ce sur quoi elle s'applique. Sans cette
  // morsure, sa face arrière et la surface qui la porte occupent le même plan, et deux
  // surfaces coplanaires se disputent les pixels dès qu'on les regarde de biais.
  const BITE = 0.1
  for (const x of [1006, 1018, 1052, 1064, 1076]) {
    pushBlock(out, { x, y: low, z: BRIDGE_BOX.min.z - BITE }, { x: x + 3, y: high, z: BRIDGE_BOX.min.z + 2.2 }, { side: dark })
  }
  // L'encadrement de la porte : deux jambages et un linteau saillants, pour que l'ouverture
  // se lise de loin comme une porte et non comme un trou.
  //
  // Le linteau **repose** sur les jambages au lieu de les recouvrir, et il est un peu plus
  // large et un peu moins saillant qu'eux. C'est la manière propre de faire buter deux
  // volumes : deux faces qui se touchent dos à dos ne se voient jamais toutes les deux,
  // tandis que deux faces qui se recouvrent en regardant du même côté se disputent les
  // pixels.
  const lintel = BRIDGE_DECK + 2.6
  for (const side of [-1, 1]) {
    pushBlock(
      out,
      { x: BRIDGE_X + side * 1.2, y: BRIDGE_DECK - 0.8, z: BRIDGE_BOX.min.z - BITE },
      { x: BRIDGE_X + side * 2.1, y: lintel, z: BRIDGE_BOX.min.z + 1 },
      { side: worn, top: worn },
    )
  }
  pushBlock(
    out,
    { x: BRIDGE_X - 2.4, y: lintel, z: BRIDGE_BOX.min.z - BITE * 2 },
    { x: BRIDGE_X + 2.4, y: lintel + 0.8, z: BRIDGE_BOX.min.z + 0.9 },
    { side: worn, top: worn },
  )

  // Le belvédère : le seul endroit large du dehors, et la cible qu'on vise en tombant.
  //
  // **Il passe sous l'embrasure**, et c'est indispensable. Le plan d'une couture est au fond
  // de l'ébrasement, vingt-cinq centimètres derrière le nu du mur ; dans une salle ordinaire
  // on ne s'en aperçoit pas, parce que le sol d'une cellule est son plancher et qu'il s'étend
  // partout, embrasure comprise. Ici le sol de la cellule est à quatre-vingts mètres sous les
  // pieds : le seul appui est ce bloc, et arrêté au nu du mur il laissait vingt-cinq
  // centimètres de vide juste devant la porte. On y tombait d'un demi-centimètre, la porte
  // jugeait les pieds sous le seuil et refusait le passage, le mur repoussait — et l'on
  // restait planté devant une sortie qui ne s'ouvrait jamais.
  const terrace = {
    min: { x: BRIDGE_X - 4, y: BRIDGE_DECK - 1.4, z: BRIDGE_BOX.min.z - REVEAL - 0.1 },
    max: { x: BRIDGE_X + 4, y: BRIDGE_DECK, z: BRIDGE_BOX.min.z + 7 },
  }
  pushBlock(out, terrace.min, terrace.max, { side: under, top: worn, bottom: under })
  blocks.push(terrace)

  // La passerelle. Un mètre cinquante, sans garde-corps, et elle **s'arrête en l'air** :
  // elle ne mène nulle part, et c'est le sujet. Un pont qui aboutit est un couloir.
  const deck = {
    min: { x: BRIDGE_X - 0.75, y: BRIDGE_DECK - 0.9, z: terrace.max.z },
    max: { x: BRIDGE_X + 0.75, y: BRIDGE_DECK, z: 1046 },
  }
  pushBlock(out, deck.min, deck.max, { side: under, top: worn, bottom: under })
  blocks.push(deck)

  // Les masses. Elles n'ont ni sommet ni pied visibles ; leur seule fonction est de donner
  // au vide trois dimensions, et à la chute quelque chose à faire défiler.
  const masses: [number, number, number, number][] = [
    [1008, 1014, 1022, 1032],
    [1056, 1074, 1010, 1022],
    [1002, 1013, 1042, 1058],
    [1060, 1078, 1046, 1060],
    [1022, 1058, 1066, 1080],
    [1020, 1030, 1028, 1038],
  ]
  for (const [x0, x1, z0, z1] of masses) {
    pushBlock(out, { x: x0, y: low, z: z0 }, { x: x1, y: high, z: z1 }, { side: concrete })
    blocks.push({ min: { x: x0, y: low, z: z0 }, max: { x: x1, y: high, z: z1 } })
    // Un refend vertical sur la face tournée vers le pont, pour la même raison qu'en façade.
    const rib = (x0 + x1) / 2
    pushBlock(out, { x: rib - 1.2, y: low, z: z0 - 0.9 }, { x: rib + 1.2, y: high, z: z0 + BITE }, { side: dark })
  }

  // **Aucune plateforme flottante.** Il y en avait trois, en encorbellement, pour donner un
  // haut et un bas au vide. Elles faisaient l'inverse : un vide meublé n'est plus un vide, et
  // trois planches suspendues à mi-hauteur transforment un abîme en niveau de plateforme. Le
  // vertige tient à ce qu'il n'y a rien — c'est la passerelle seule qui doit être la seule
  // chose horizontale du dehors.

  return { verts: out, blocks }
}

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

/**
 * La palette d'une salle : trois nuances d'une même teinte, sans matière.
 *
 * **Le musée reste nu.** Les matières existent — voir la salle basse, qui les porte toutes —
 * mais elles n'ont pas encore été distribuées : on essaie d'abord, on range ensuite. Une
 * salle habillée trop tôt fige un choix qu'on n'a pas fait.
 */
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
  verriere: 10,
  /** Sans motif : ce qu'il faut aux petits objets, qu'aucune texture ne peut servir. */
  uni: 11,
  /** Émissive : elle échappe à l'éclairage de la salle, puisqu'elle en est une source. */
  lumiere: 12,
  /** Le fil du bois, sans lames : celui d'un meuble, pas celui d'un sol. */
  bois: 13,
} as const

/**
 * **Le mobilier du musée**, et ses teintes.
 *
 * Les mêmes partout, délibérément. Un banc de la rotonde et un banc de la galerie sont le
 * même banc : c'est ce qui fait qu'on reconnaît un bâtiment plutôt qu'une collection de
 * salles. Seule la matière du sol change d'une pièce à l'autre ; ce qu'on y pose ne change
 * pas.
 */
const FURNITURE = {
  laiton: made([0.72, 0.56, 0.24], MATTER.uni),
  fonte: made([0.16, 0.16, 0.17], MATTER.uni),
  cordage: made([0.42, 0.09, 0.11], MATTER.uni),
  chene: made([0.36, 0.24, 0.15], MATTER.bois),
  terre: made([0.34, 0.2, 0.14], MATTER.uni),
  humus: made([0.12, 0.09, 0.07], MATTER.uni),
  feuille: made([0.16, 0.3, 0.14], MATTER.uni),
} as const

/** Une couleur et sa matière. */
function made(colour: Color, matter: number): Color {
  return [colour[0], colour[1], colour[2], matter]
}

/**
 * **La palette de l'ancien portfolio**, reprise telle quelle.
 *
 * Ses salles n'étaient pas toutes crème : il y avait du vert de galerie, du bleu de nuit, du
 * rouge sourd, du taupe. C'est ce qui faisait qu'on savait toujours où l'on était sans avoir
 * à lire un panneau — une pièce se reconnaissait à sa couleur avant sa forme. Les valeurs
 * sont celles du moteur d'alors, à peine assombries : son éclairage était moins généreux que
 * celui-ci.
 */
const PAINT = {
  creme: [0.62, 0.59, 0.54] as Colour,
  pierreClaire: [0.58, 0.55, 0.49] as Colour,
  vert: [0.20, 0.29, 0.26] as Colour,
  bleu: [0.18, 0.22, 0.32] as Colour,
  rouge: [0.30, 0.16, 0.17] as Colour,
  taupe: [0.32, 0.29, 0.24] as Colour,
  marbreClair: [0.62, 0.60, 0.57] as Colour,
  marbreSombre: [0.17, 0.17, 0.19] as Colour,
  chene: [0.42, 0.285, 0.17] as Colour,
  tapisRouge: [0.28, 0.10, 0.11] as Colour,
  tapisVert: [0.16, 0.22, 0.17] as Colour,
  dalle: [0.54, 0.52, 0.47] as Colour,
} as const

/**
 * **La planche d'essais**, dans la salle basse.
 *
 * Douze petites scènes en L, alignées en trois rangées de quatre, chacune numérotée. Un L,
 * c'est deux parois qui se rencontrent : le minimum pour qu'un sol, un mur et un objet se
 * regardent ensemble. Moins, on juge un échantillon ; plus, on juge une salle et l'on ne sait
 * plus ce qu'on juge.
 *
 * Le numéro est là pour qu'on puisse parler des essais. « Le troisième en partant de la
 * gauche » se trompe une fois sur deux ; « le sept » ne se trompe jamais. Il est gravé en
 * chiffres de trois cases sur cinq, la seule police du musée — voir `pushDigits`.
 *
 * **Rien de tout cela n'est du level design.** C'est un atelier : on essaie une matière contre
 * une autre, un meuble contre un vide, et l'on garde ce qui tient. Le musée, lui, reste nu
 * jusqu'à ce qu'on ait choisi.
 */
interface Vignette {
  /** Ce qu'on essaie, en une ligne. Pour la documentation, pas pour l'affichage. */
  about: string
  floor: Color
  wall: Color
  /**
   * Le mobilier, posé dans le repère du coin — x vers la droite, z vers l'avant.
   *
   * `lamps` recueille les foyers : une applique dessinée ne fait pas de lumière, c'est la
   * cellule qui porte les siennes. On y pousse donc la position de chaque flamme, et la
   * salle s'en sert pour éclairer — sans quoi une lampe est un objet peint sur un mur.
   */
  build: (out: number[], corner: Vec3, lamps: Lamp[]) => void
}

/**
 * Les six images du portfolio, dans l’ordre où la page les charge.
 *
 * Une matière au-delà de cent désigne une couche du tableau d’images : la matière et l’image
 * partagent un même nombre, ce qui évite un attribut de sommet de plus. Le nuanceur ne peut
 * de toute façon pas choisir une texture d’après une donnée par sommet — une texture est une
 * ressource, pas une valeur — alors qu’une couche est un indice ordinaire.
 */
const PICTURES = {
  musee: 100,
  julia: 101,
  hunter: 102,
  monde: 103,
  shell: 104,
  antivirus: 105,
} as const

const VIGNETTE_SIDE = 4.4
const VIGNETTE_HEIGHT = 2.9
const VIGNETTE_THICK = 0.24

/** Les teintes du mobilier, communes à toutes les scènes : on ne compare qu'une chose. */
const OAK = FURNITURE.chene
const IRON = FURNITURE.fonte
const BRASS = FURNITURE.laiton
const GLOW = made([1, 0.9, 0.74], MATTER.lumiere)

/**
 * Une source déclarée par une scène.
 *
 * **C'est l'ambiance qui se joue ici**, plus que la matière. Deux salles aux mêmes murs mais
 * l'une éclairée d'une flaque chaude et l'autre d'un plafonnier froid n'ont rien à voir ; et
 * une salle sombre avec une seule toile allumée est infiniment plus juste qu'une salle
 * uniformément claire. Chaque scène porte donc ses foyers, et la crypte n'assure plus qu'un
 * fond très faible pour qu'on voie l'allée.
 */
interface Lamp {
  at: Vec3
  colour: Colour
  intensity: number
  radius: number
}

const WARM: Colour = [1, 0.84, 0.64]
const CANDLE: Colour = [1, 0.78, 0.52]

/**
 * **Les trois profils de cadre du musée.**
 *
 * Chacun est une suite de gradins, du plus extérieur au plus intérieur, avec sa saillie. Les
 * valeurs sont celles d'un vrai encadrement : quatre à six centimètres de moulure pour une
 * toile d'un mètre. Plus large, c'est le cadre qu'on regarde ; et la première version, à onze
 * centimètres de baguette unique, écrasait l'œuvre qu'elle portait.
 *
 * L'alternance des saillies fait tout le travail. Un gradin en avant attrape la lumière, le
 * suivant en retrait reste dans l'ombre : trois gradins de dix-huit millimètres se voient
 * mieux qu'une planche, parce qu'ils ont un relief au lieu d'une surface.
 */
const FRAMES = {
  /** Doré : doucine sombre, gorge, tore vif, filet contre l'ouverture. */
  or: {
    profile: [
      { width: 0.014, out: 0.05, colour: made([0.3, 0.22, 0.1], MATTER.bois) },
      { width: 0.02, out: 0.072, colour: made([0.72, 0.56, 0.24], MATTER.uni) },
      { width: 0.012, out: 0.042, colour: made([0.34, 0.25, 0.12], MATTER.bois) },
      { width: 0.008, out: 0.062, colour: made([0.86, 0.7, 0.34], MATTER.uni) },
    ],
    mount: made([0.74, 0.72, 0.67], MATTER.uni),
    margin: 0.05,
  },
  /** Noir : deux gradins, vingt-deux millimètres en tout. Le cadre d'une salle blanche. */
  noir: {
    profile: [
      { width: 0.012, out: 0.032, colour: made([0.1, 0.1, 0.11], MATTER.uni) },
      { width: 0.01, out: 0.05, colour: made([0.16, 0.16, 0.17], MATTER.uni) },
    ],
    mount: made([0.82, 0.81, 0.79], MATTER.uni),
    margin: 0.055,
  },
  /** Bois clair : trois gradins, sans passe-partout. Le cadre ordinaire du musée. */
  clair: {
    profile: [
      { width: 0.012, out: 0.045, colour: made([0.34, 0.24, 0.13], MATTER.bois) },
      { width: 0.014, out: 0.062, colour: made([0.46, 0.33, 0.18], MATTER.bois) },
      { width: 0.008, out: 0.038, colour: made([0.28, 0.19, 0.1], MATTER.bois) },
    ],
  },
} as const

/** Un cadre ordinaire, accroché à hauteur d'œil de musée — le milieu à 1,55 m. */
function hang(out: number[], c: Vec3, x: number, width: number, height: number, canvas: Color): void {
  pushFramed(
    out,
    { x: c.x + x, y: c.y + 1.55, z: c.z + 0.02 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    width,
    height,
    FRAMES.clair,
    canvas,
  )
}

/** Un cadre choisi, et sa lampe s'il en veut une. */
function exhibit(
  out: number[],
  lamps: Lamp[],
  c: Vec3,
  x: number,
  width: number,
  height: number,
  canvas: Color,
  style: keyof typeof FRAMES,
  light?: { intensity: number; colour: Colour },
): void {
  const centre = { x: c.x + x, y: c.y + 1.6, z: c.z + 0.02 }
  pushFramed(out, centre, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, width, height, FRAMES[style], canvas)

  if (!light) return
  const at = { x: centre.x, y: centre.y + height / 2 + 0.2, z: c.z + 0.02 }
  pushPictureLight(out, at, { x: 0, y: 0, z: 1 }, Math.min(width * 0.7, 0.8), BRASS, GLOW)
  // Le foyer est posé **devant** le tableau et un peu au-dessus : c'est la toile qu'on
  // éclaire, pas le mur.
  lamps.push({
    at: { x: at.x, y: at.y - 0.06, z: at.z + 0.3 },
    colour: light.colour,
    intensity: light.intensity,
    radius: 3.4,
  })
}

const VIGNETTES: Vignette[] = [
  // ---- Les sept retenues, dans l'ordre demandé et sans y toucher -----------------
  {
    about: 'marbre sombre et lambris bleu, cadre et colonne — la salle du soir',
    floor: made(PAINT.marbreSombre, MATTER.marbre),
    wall: made(PAINT.bleu, MATTER.lambris),
    build: (out, c, lamps) => {
      hang(out, c, 1.1, 1.9, 1.07, made([1, 1, 1], PICTURES.antivirus))
      pushColumn(out, { x: c.x + 3.4, y: c.y, z: c.z + 3.0 }, 0.3, VIGNETTE_HEIGHT, made([0.3, 0.29, 0.3], MATTER.marbre), made([0.4, 0.39, 0.38], MATTER.platre))
      pushSconce(out, { x: c.x + 3.2, y: c.y + 2.3, z: c.z + 0.06 }, { x: 0, y: 0, z: 1 }, BRASS, GLOW)
      lamps.push({ at: { x: c.x + 3.2, y: c.y + 2.46, z: c.z + 0.32 }, colour: WARM, intensity: 3, radius: 4.5 })
    },
  },
  {
    about: 'chêne et lambris crème, le cordon et la plante',
    floor: made(PAINT.chene, MATTER.parquet),
    wall: made(PAINT.creme, MATTER.lambris),
    build: (out, c) => {
      pushCordon(out, { x: c.x + 0.6, y: c.y, z: c.z + 2.4 }, { x: c.x + 3.6, y: c.y, z: c.z + 2.4 }, 3, BRASS, IRON, FURNITURE.cordage)
      pushPlant(out, { x: c.x + 3.4, y: c.y, z: c.z + 1.0 }, FURNITURE.terre, FURNITURE.humus, FURNITURE.feuille, 13)
      hang(out, c, 1.05, 1.5, 0.85, made([1, 1, 1], PICTURES.musee))
    },
  },
  {
    about: 'tapis rouge et lambris rouge — la salle sourde',
    floor: made(PAINT.tapisRouge, MATTER.moquette),
    wall: made(PAINT.rouge, MATTER.lambris),
    build: (out, c, lamps) => {
      hang(out, c, 1.3, 1.7, 0.96, made([1, 1, 1], PICTURES.antivirus))
      for (const x of [0.7, 3.5]) {
        pushSconce(out, { x: c.x + x, y: c.y + 2.3, z: c.z + 0.06 }, { x: 0, y: 0, z: 1 }, BRASS, GLOW)
        lamps.push({ at: { x: c.x + x, y: c.y + 2.46, z: c.z + 0.32 }, colour: CANDLE, intensity: 2.4, radius: 4 })
      }
    },
  },
  {
    about: 'tapis rouge et lambris crème — le cabinet feutré',
    floor: made(PAINT.tapisRouge, MATTER.moquette),
    wall: made(PAINT.creme, MATTER.lambris),
    build: (out, c) => {
      pushBench(out, { x: c.x + 2.2, y: c.y, z: c.z + 2.8 }, 2.4, { x: 1, y: 0, z: 0 }, OAK, IRON)
      pushShrub(
        out,
        { x: c.x + 3.4, y: c.y, z: c.z + 1.1 },
        made([0.34, 0.24, 0.15], MATTER.bois),
        FURNITURE.humus,
        made([0.3, 0.21, 0.14], MATTER.bois),
        made([0.16, 0.3, 0.15], MATTER.uni),
        9,
      )
    },
  },
  {
    about: 'chêne et lambris taupe, trois petits cadres',
    floor: made(PAINT.chene, MATTER.parquet),
    wall: made(PAINT.taupe, MATTER.lambris),
    build: (out, c) => {
      hang(out, c, 0.55, 1.0, 0.56, made([1, 1, 1], PICTURES.julia))
      hang(out, c, 1.7, 1.0, 0.56, made([1, 1, 1], PICTURES.hunter))
      hang(out, c, 2.85, 1.0, 0.56, made([1, 1, 1], PICTURES.shell))
    },
  },
  {
    about: 'chêne et lambris vert, deux cadres et une applique',
    floor: made(PAINT.chene, MATTER.parquet),
    wall: made(PAINT.vert, MATTER.lambris),
    build: (out, c, lamps) => {
      hang(out, c, 0.6, 1.3, 0.73, made([1, 1, 1], PICTURES.julia))
      hang(out, c, 2.3, 1.3, 0.73, made([1, 1, 1], PICTURES.hunter))
      pushSconce(out, { x: c.x + 2.05, y: c.y + 2.35, z: c.z + 0.06 }, { x: 0, y: 0, z: 1 }, IRON, GLOW)
      lamps.push({ at: { x: c.x + 2.05, y: c.y + 2.51, z: c.z + 0.32 }, colour: WARM, intensity: 3, radius: 4.5 })
    },
  },
  {
    about: 'chêne et lambris crème, un cadre — la salle d’époque',
    floor: made(PAINT.chene, MATTER.parquet),
    wall: made(PAINT.creme, MATTER.lambris),
    build: (out, c) => {
      hang(out, c, 1.3, 1.6, 0.9, made([1, 1, 1], PICTURES.musee))
      pushCordon(out, { x: c.x + 0.6, y: c.y, z: c.z + 2.2 }, { x: c.x + 3.6, y: c.y, z: c.z + 2.2 }, 3, BRASS, IRON, FURNITURE.cordage)
    },
  },

  // ---- Les nouvelles : meilleurs cadres, meilleures lampes, une ambiance chacune --
  {
    about: 'le cabinet noir — une seule toile allumée dans le noir',
    floor: made(PAINT.marbreSombre, MATTER.marbre),
    wall: made([0.14, 0.15, 0.18], MATTER.lambris),
    build: (out, c, lamps) => {
      exhibit(out, lamps, c, 2.2, 1.9, 1.15, made([1, 1, 1], PICTURES.julia), 'or', {
        intensity: 7,
        colour: WARM,
      })
      pushCordon(out, { x: c.x + 0.9, y: c.y, z: c.z + 2.1 }, { x: c.x + 3.5, y: c.y, z: c.z + 2.1 }, 3, BRASS, IRON, FURNITURE.cordage)
    },
  },
  {
    about: 'le salon — lustre, tapis rouge, deux cadres dorés',
    floor: made(PAINT.tapisRouge, MATTER.moquette),
    wall: made(PAINT.taupe, MATTER.lambris),
    build: (out, c, lamps) => {
      exhibit(out, lamps, c, 1.15, 1.4, 0.9, made([1, 1, 1], PICTURES.monde), 'or')
      exhibit(out, lamps, c, 3.0, 1.4, 0.9, made([1, 1, 1], PICTURES.shell), 'or')
      pushChandelier(out, { x: c.x + 2.1, y: c.y + VIGNETTE_HEIGHT, z: c.z + 2.4 }, 0.75, 0.42, BRASS, GLOW)
      lamps.push({ at: { x: c.x + 2.1, y: c.y + VIGNETTE_HEIGHT - 0.9, z: c.z + 2.4 }, colour: CANDLE, intensity: 5.5, radius: 6 })
      pushBench(out, { x: c.x + 2.1, y: c.y, z: c.z + 3.4 }, 2.2, { x: 1, y: 0, z: 0 }, OAK, IRON)
    },
  },
  {
    about: 'le coin de lecture — lampadaire, tapis vert, un banc',
    floor: made(PAINT.tapisVert, MATTER.moquette),
    wall: made(PAINT.creme, MATTER.lambris),
    build: (out, c, lamps) => {
      pushTorchere(out, { x: c.x + 0.8, y: c.y, z: c.z + 1.0 }, IRON, GLOW)
      lamps.push({ at: { x: c.x + 0.8, y: c.y + 1.75, z: c.z + 1.0 }, colour: WARM, intensity: 5, radius: 5.5 })
      pushBench(out, { x: c.x + 2.4, y: c.y, z: c.z + 2.4 }, 2.2, { x: 1, y: 0, z: 0 }, OAK, IRON)
      pushShrub(
        out,
        { x: c.x + 3.5, y: c.y, z: c.z + 1.1 },
        made([0.32, 0.22, 0.14], MATTER.bois),
        FURNITURE.humus,
        made([0.28, 0.2, 0.13], MATTER.bois),
        made([0.14, 0.28, 0.13], MATTER.uni),
        4,
      )
      exhibit(out, lamps, c, 2.4, 1.2, 0.75, made([1, 1, 1], PICTURES.monde), 'clair')
    },
  },
]

/**
 * Une scène en L, avec son numéro.
 *
 * Le sol est une dalle surélevée de six centimètres : posée à ras, elle serait rigoureusement
 * coplanaire avec le sol de la salle, et deux surfaces dans le même plan se disputent les
 * pixels. Six centimètres, c'est aussi la hauteur d'une estrade — l'essai a l'air présenté
 * plutôt que posé.
 */
function pushVignette(
  out: number[],
  vignette: Vignette,
  corner: Vec3,
  number: number,
  lamps: Lamp[],
): void {
  const side = VIGNETTE_SIDE
  const base = corner.y + 0.06

  pushBlock(
    out,
    corner,
    { x: corner.x + side, y: base, z: corner.z + side },
    { side: made([0.3, 0.29, 0.28], MATTER.uni), top: vignette.floor },
  )

  // Les deux parois du L : celle du fond, celle de gauche. L'ouverture regarde donc vers
  // l'avant-droite, et toutes les scènes s'abordent du même côté — sans quoi on comparerait
  // des angles de vue au lieu de comparer des matières.
  pushBlock(
    out,
    { x: corner.x, y: base, z: corner.z },
    { x: corner.x + side, y: base + VIGNETTE_HEIGHT, z: corner.z + VIGNETTE_THICK },
    { side: vignette.wall, top: made([0.34, 0.33, 0.32], MATTER.uni) },
  )
  pushBlock(
    out,
    { x: corner.x, y: base, z: corner.z + VIGNETTE_THICK },
    { x: corner.x + VIGNETTE_THICK, y: base + VIGNETTE_HEIGHT, z: corner.z + side },
    { side: vignette.wall, top: made([0.34, 0.33, 0.32], MATTER.uni) },
  )

  vignette.build(out, { x: corner.x + VIGNETTE_THICK, y: base, z: corner.z + VIGNETTE_THICK }, lamps)

  // Le numéro, sur une plaque debout au coin avant de l'estrade. Il regarde l'allée.
  const plate = { x: corner.x + side - 0.9, y: corner.y, z: corner.z + side + 0.02 }
  pushBlock(
    out,
    plate,
    { x: plate.x + 0.85, y: plate.y + 0.62, z: plate.z + 0.14 },
    { side: made([0.1, 0.1, 0.11], MATTER.uni), top: made([0.14, 0.14, 0.15], MATTER.uni) },
  )
  const label = String(number)
  const cell = 0.075
  pushDigits(
    out,
    // Deux centimètres devant la plaque, et non cinq millimètres : plus deux surfaces sont
    // proches, plus tôt elles se disputent les pixels quand on s'éloigne.
    { x: plate.x + 0.42 - (label.length * 4 - 1) * cell * 0.5, y: plate.y + 0.14, z: plate.z + 0.16 },
    { x: cell, y: 0, z: 0 },
    { x: 0, y: cell, z: 0 },
    label,
    made([0.85, 0.72, 0.3], MATTER.uni),
  )
}

/**
 * La planche d'essais entière : trois rangées de quatre, face à l'escalier.
 *
 * Les scènes sont posées au cordeau et toutes dans le même sens. C'est délibéré : ce qu'on
 * compare doit différer par **une** chose à la fois, et une planche d'essais mal rangée
 * mesure surtout la fantaisie de qui l'a rangée.
 */
function furnishTheCrypt(out: number[]): { blocks: Block[]; lamps: Lamp[] } {
  const blocks: Block[] = []
  const lamps: Lamp[] = []
  // **Quatre mètres de recul devant chaque rangée.** Une planche d'essais qu'on ne peut
  // regarder qu'en y entrant ne sert à rien : il faut pouvoir se placer devant une scène,
  // reculer, comparer avec sa voisine. Le pas des rangées vaut donc la profondeur d'une scène
  // plus une allée.
  const pitchX = 5.5
  const pitchZ = 8.5
  const columns = 5
  const rows = 2
  const originX = LOWER_BOX.min.x + 2.2
  const originZ = LOWER_BOX.min.z + 3

  VIGNETTES.forEach((vignette, i) => {
    const column = i % columns
    const row = Math.floor(i / columns)
    if (row >= rows) return
    const corner = {
      x: originX + column * pitchX,
      y: LOWER_BOX.min.y,
      z: originZ + row * pitchZ,
    }
    pushVignette(out, vignette, corner, i + 1, lamps)
    blocks.push({
      min: { x: corner.x, y: corner.y, z: corner.z },
      max: { x: corner.x + VIGNETTE_SIDE, y: corner.y + 0.06 + VIGNETTE_HEIGHT, z: corner.z + VIGNETTE_THICK },
    })
    blocks.push({
      min: { x: corner.x, y: corner.y, z: corner.z },
      max: { x: corner.x + VIGNETTE_THICK, y: corner.y + 0.06 + VIGNETTE_HEIGHT, z: corner.z + VIGNETTE_SIDE },
    })
  })
  return { blocks, lamps }
}

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

/**
 * **L'aile rouge, le conduit, et la grande salle.**
 *
 * L'aile rouge est celle où l'on tombe. On y arrive par la trappe de la salle aux six sols :
 * on traverse la rotonde en vol, on entre par sa porte et l'on va s'écraser sur son mur du
 * fond — qui devient un sol, puisque cette salle garde au visiteur la gravité qu'il apporte.
 *
 * De là, et de là seulement, le conduit est accessible. Il est percé **dans un coin** du
 * plafond, contre le mur du fond : debout sur ce mur, on longe la paroi jusqu'au coin, puis
 * on monte dedans en marchant. Debout sur le plancher, il est à trois mètres soixante
 * au-dessus de la tête et rien ne permet d'y monter. C'est ce qui fait de la grande salle une
 * récompense plutôt qu'un couloir : on n'y va pas par hasard, on y va parce qu'on a compris
 * comment garder une gravité de travers, puis comment s'en servir pour marcher jusqu'au coin.
 *
 * Le conduit et l'aile rouge partagent la même paroi — le plan z = 510 court de l'un à
 * l'autre sans rupture — de sorte qu'on ne change jamais de sol en montant. C'est la seule
 * façon de faire un tunnel qu'on emprunte debout sur un mur : il faut que le mur continue.
 *
 * La grande salle, au bout, a ses six faces habitables. Sans quoi on y arriverait couché sur
 * une paroi sans aucun moyen de se relever, et elle serait un piège au lieu d'un terrain.
 */
const MOBILE_WING = 'mobiles'
const CONDUIT = 'conduit'
const GREAT = 'grande-salle'

/** Le conduit : une gaine verticale de six mètres, dans le coin de l'aile rouge. */
const CONDUIT_BOX: Box = { min: { x: 514.6, y: 3.6, z: 506.2 }, max: { x: 518, y: 9.6, z: 510 } }
const CONDUIT_TINT: Colour = [0.9, 0.72, 0.55]

/** La grande salle, tout en haut. Vide pour l'instant : c'est un terrain, pas une pièce. */
const GREAT_BOX: Box = { min: { x: 498, y: 9.6, z: 492 }, max: { x: 526, y: 21.6, z: 510 } }
const GREAT_TINT: Colour = [0.72, 0.86, 1]

/**
 * Une trémie et son vis-à-vis : deux plans qui se répondent par **translation pure**.
 *
 * Le rectangle est collé au mur du fond, et il le faut : le corps qui s'y tient debout a les
 * pieds contre ce mur et son gabarit se mesure alors *le long* de la trémie. Elle doit donc
 * l'englober en entier, du mur jusqu'à un peu au-delà de la tête — d'où une trémie plus
 * profonde que large, alors qu'une trappe ordinaire serait carrée.
 */
function hatchMouths(
  below: { cell: string; y: number },
  above: { cell: string; y: number },
  centre: { x: number; z: number },
): { under: Mouth; over: Mouth } {
  const common = { halfWidth: 1.4, halfHeight: 1.6 }
  return {
    under: {
      ...common,
      id: `${below.cell}.tremie`,
      cell: below.cell,
      center: { x: centre.x, y: below.y + REVEAL, z: centre.z },
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: -1, z: 0 },
    },
    over: {
      ...common,
      id: `${above.cell}.tremie`,
      cell: above.cell,
      center: { x: centre.x, y: above.y - REVEAL, z: centre.z },
      // L'orientation est celle qui rend la couture purement translatoire : côté renversé,
      // haut conservé, normale opposée. Rien ne pivote entre deux boîtes empilées, ce qui
      // est la seule façon honnête de les recoller.
      right: { x: -1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 1, z: 0 },
    },
  }
}

/** L'axe des deux trémies : le coin du fond à droite, celui qu'on va chercher en marchant. */
const HATCH_AT = { x: CONDUIT_BOX.max.x - 1.8, z: CONDUIT_BOX.max.z - 1.6 }

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
  /** Sur la passerelle, à mi-longueur, le regard vers le bout qui n'aboutit pas. */
  bridgeCell: string
  bridgePos: Vec3
  bridgeForward: Vec3
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

  // **La neuvième porte, au milieu de la paroi nord.** Les huit autres vont par paires de
  // part et d'autre de chaque mur ; celle-ci est seule et centrée, et c'est voulu — c'est la
  // seule qui ne mène pas à une salle mais **dehors**.
  const bridgeHubMouth = mouth(HUB, `${HUB}.vers-pont`, HUB_BOX, 'north', 0)
  hubMouths.push({ mouth: bridgeHubMouth, wall: 'north' })

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
  // **La porte est au sud**, parce que les scènes s'ouvrent de ce côté. Entrer dans le dos
  // d'une planche d'essais n'a pas de sens : on veut voir les ouvertures en arrivant, pas les
  // parois qui les ferment.
  const lowerMouth = mouth(LOWER, 'salle-basse.porte', LOWER_BOX, 'south', 915)
  // La planche d'essais est bâtie ici, avant l'éclairage : ses appliques et ses suspensions
  // doivent figurer parmi les foyers de la salle, faute de quoi une lampe n'est qu'un objet
  // peint sur un mur.
  const cryptExtra: number[] = []
  const crypt = furnishTheCrypt(cryptExtra)

  // **L'atelier s'éclaire à plat.** On y compare des matières, donc il faut la même lumière
  // partout : une source unique au plafond en aurait éclairé trois et laissé sept dans
  // l'ombre, et l'on aurait jugé l'éclairage au lieu de la matière.
  const lowerLighting: CellLighting = {
    // **Le fond est presque éteint.** Les scènes portent leur propre lumière, et c'est là
    // qu'elles se distinguent : une salle sombre avec une toile allumée n'a rien à voir avec
    // la même sous un plafonnier. Un éclairage général fort les aplatirait toutes.
    ambient: [LOWER_TINT[0] * 0.045, LOWER_TINT[1] * 0.045, LOWER_TINT[2] * 0.045],
    // Une lampe par rangée d'essais, alignée sur elles : ce qu'on compare doit l'être dans
    // la même lumière, et une planche d'essais mal éclairée mesure surtout l'éclairage.
    lights: [
      { dx: 0, dz: -7 },
      { dx: 0, dz: 1 },
      { dx: 0, dz: 9 },
    ].map(({ dx, dz }) => ({
      position: {
        x: (LOWER_BOX.min.x + LOWER_BOX.max.x) / 2 + dx,
        y: LOWER_BOX.max.y - 0.9,
        z: (LOWER_BOX.min.z + LOWER_BOX.max.z) / 2 + dz,
      },
      colour: LOWER_TINT,
      intensity: 3.2,
      radius: 13,
    })).concat(
      // Et chaque lampe des scènes, chaude et courte : elle doit se voir sur son mur, pas
      // éclairer l'allée.
      crypt.lamps.map((lamp) => ({
        position: lamp.at,
        colour: lamp.colour,
        intensity: lamp.intensity,
        radius: lamp.radius,
      })),
    ),
  }

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

  // **Les deux trémies.** Aucune ne perce un mur : elles percent un plafond, et leur
  // vis-à-vis perce le sol d'au-dessus. Les deux plans d'une même trémie sont distants de la
  // seule épaisseur des deux embrasures, si bien que la couture est une translation de
  // cinquante centimètres et que le conduit se traverse sans que rien ne tourne.
  const mobileWing = wingData.find((entry) => entry.wing.id === MOBILE_WING)!
  const conduitLighting: CellLighting = {
    ambient: [CONDUIT_TINT[0] * 0.07, CONDUIT_TINT[1] * 0.07, CONDUIT_TINT[2] * 0.07],
    lights: [3.2, 6.4, 9.0].map((y) => ({
      position: { x: (CONDUIT_BOX.min.x + CONDUIT_BOX.max.x) / 2, y, z: CONDUIT_BOX.min.z + 1 },
      colour: CONDUIT_TINT,
      intensity: 5,
      radius: 6,
    })),
  }
  const greatLighting: CellLighting = {
    ambient: [GREAT_TINT[0] * 0.05, GREAT_TINT[1] * 0.05, GREAT_TINT[2] * 0.05],
    // Une grande salle demande plusieurs foyers : une lampe unique au centre laisse ses
    // coins dans le noir, et ce sont justement les coins qu'on ira parcourir.
    lights: [-8, 0, 8].flatMap((dx) =>
      [-5, 5].map((dz) => ({
        position: {
          x: (GREAT_BOX.min.x + GREAT_BOX.max.x) / 2 + dx,
          y: (GREAT_BOX.min.y + GREAT_BOX.max.y) / 2,
          z: (GREAT_BOX.min.z + GREAT_BOX.max.z) / 2 + dz,
        },
        colour: GREAT_TINT,
        intensity: 16,
        radius: 15,
      })),
    ),
  }

  const lower = hatchMouths(
    { cell: MOBILE_WING, y: mobileWing.wing.box.max.y },
    { cell: CONDUIT, y: CONDUIT_BOX.min.y },
    HATCH_AT,
  )
  const upper = hatchMouths(
    { cell: CONDUIT, y: CONDUIT_BOX.max.y },
    { cell: GREAT, y: GREAT_BOX.min.y },
    HATCH_AT,
  )
  const [intoConduit, outOfConduit] = makePassages(
    lower.under,
    mobileWing.lighting,
    lower.over,
    conduitLighting,
  )
  const [intoGreat, outOfGreat] = makePassages(
    upper.under,
    conduitLighting,
    upper.over,
    greatLighting,
  )
  wingPassages.get(MOBILE_WING)!.push(intoConduit)
  mobileWing.holes.ceiling = [holeOf(lower.under)]

  // **Le pont.** Deux coutures : la porte, et la boucle verticale qui recolle le plancher de
  // la cellule à son plafond. La seconde a ses deux bouches dans la même cellule — l'espace
  // cousu relie des bouches, pas des pièces — et ne transmet donc aucune lumière.
  const bridgeDoor = mouth(BRIDGE, 'pont.porte', BRIDGE_BOX, 'north', BRIDGE_X, BRIDGE_DECK)
  const bridgeLighting: CellLighting = {
    // **Dehors, la lumière vient de partout.** Un ambiant fort et froid plutôt que des
    // lampes : il n'y a pas de plafonnier au-dessus d'un vide, et une source ponctuelle à
    // deux cents mètres ne modèle rien. Les quatre foyers ci-dessous ne servent qu'à
    // détacher le proche du lointain, au niveau du pont.
    // Sombre de près, blanc de loin. C'est l'inverse d'un intérieur, et c'est ce qui donne
    // les silhouettes : le béton proche reste mat, et la brume l'efface en l'éclaircissant.
    ambient: [0.13, 0.14, 0.16],
    lights: [-24, 24].flatMap((dz) =>
      [-26, 26].map((dx) => ({
        position: { x: BRIDGE_X + dx, y: BRIDGE_DECK + 26, z: BRIDGE_BOX.min.z + 30 + dz },
        colour: BRIDGE_TINT,
        intensity: 60,
        radius: 70,
      })),
    ),
  }
  const loop = bridgeLoop()
  const [hubToBridge, bridgeToHub] = makePassages(
    bridgeHubMouth,
    hubLighting,
    bridgeDoor,
    bridgeLighting,
  )
  const [fallOut, fallIn] = makePassages(loop.under, bridgeLighting, loop.over, bridgeLighting)
  hubPassages.push(hubToBridge)

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
      // L'aile rouge garde au visiteur la gravité qu'il apporte : c'est ce qui fait qu'on y
      // atterrit sur le mur du fond au lieu de se relever, et donc que la trémie du plafond
      // est atteignable. Elle n'a pas pour autant six sols : depuis le plancher, ses murs
      // restent des murs, et la trémie hors de portée.
      ...(entry.wing.id === MOBILE_WING ? { carries: true } : {}),
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
    const holes: RoomHoles = { south: [holeOf(lowerMouth)] }
    const extra: number[] = []
    pushReveal(extra, lowerMouth, made(tinted(LOWER_TINT, 0.55), MATTER.pierre))

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
        extra.concat(cryptExtra),
      ),
      passages: lowerPassages,
      lighting: lowerLighting,
      blocks: crypt.blocks,
    })
  }

  {
    const jambs = (m: Mouth, tint: Colour): number[] => {
      const out: number[] = []
      pushReveal(out, m, made(tinted(tint, 0.5), MATTER.beton), true)
      return out
    }

    cells.push({
      id: CONDUIT,
      fogColour: haze(CONDUIT_TINT),
      min: CONDUIT_BOX.min,
      max: CONDUIT_BOX.max,
      verts: concat(
        buildRoom(
          CONDUIT_BOX.min,
          CONDUIT_BOX.max,
          {
            floor: made(tinted(CONDUIT_TINT, 0.3), MATTER.beton),
            ceiling: made(tinted(CONDUIT_TINT, 0.3), MATTER.beton),
            wall: made(tinted(CONDUIT_TINT, 0.42), MATTER.tole),
          },
          { floor: [holeOf(lower.over)], ceiling: [holeOf(upper.under)] },
        ),
        jambs(lower.over, CONDUIT_TINT).concat(jambs(upper.under, CONDUIT_TINT)),
      ),
      passages: [outOfConduit, intoGreat],
      lighting: conduitLighting,
      // Le conduit garde lui aussi la gravité qu'on lui apporte : on le monte debout sur sa
      // paroi, et se relever à mi-hauteur ferait retomber tout droit dans l'aile rouge.
      carries: true,
    })

    cells.push({
      id: GREAT,
      fogColour: haze(GREAT_TINT),
      min: GREAT_BOX.min,
      max: GREAT_BOX.max,
      verts: concat(
        buildRoom(
          GREAT_BOX.min,
          GREAT_BOX.max,
          {
            floor: made(tinted(GREAT_TINT, 0.34), MATTER.beton),
            ceiling: made(tinted(GREAT_TINT, 0.28), MATTER.beton),
            wall: made(tinted(GREAT_TINT, 0.4), MATTER.beton),
          },
          { floor: [holeOf(upper.over)] },
        ),
        jambs(upper.over, GREAT_TINT),
      ),
      passages: [outOfGreat],
      lighting: greatLighting,
      // Les six faces sont habitables : on y arrive couché sur une paroi, et sans cela rien
      // ne permettrait de se relever. La salle serait un piège au lieu d'un terrain.
      gravity: { grip: GRIP },
    })
  }

  {
    const bridge = buildTheBridge(bridgeDoor)
    pushReveal(bridge.verts, bridgeDoor, made(tinted(BRIDGE_TINT, 0.3), MATTER.pierre), false)

    cells.push({
      id: BRIDGE,
      // Un lointain **plus clair** que tout ce qu'il termine, et c'est ce qui fait le vide :
      // l'air éloigne les choses en les éclaircissant, et une brume plus sombre que le béton
      // se lirait comme un fond peint.
      fogColour: [0.74, 0.78, 0.84],
      // Un horizon à une petite centaine de mètres. Plus loin, on verrait le sommet des
      // masses et le plan de la boucle ; plus près, les masses cessent d'être des masses et
      // le dehors n'est plus qu'un brouillard avec une planche dedans.
      fog: 0.018,
      min: BRIDGE_BOX.min,
      max: BRIDGE_BOX.max,
      verts: new Float32Array(bridge.verts),
      passages: [bridgeToHub, fallOut, fallIn],
      lighting: bridgeLighting,
      blocks: bridge.blocks,
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
    // La planche d'essais, vue de l'allée. On y juge la matière et le mobilier, jamais la
    // géométrie : c'est la seule image du lot dont le sujet est le goût.
    cryptCell: LOWER,
    cryptPos: { x: 915, y: LOWER_BOX.min.y + 1.65, z: LOWER_BOX.max.z - 3 },
    cryptForward: { x: 0, y: -0.1, z: -1 },
    pavedCell: PAVE_WING,
    pavedPos: { x: PAVE_BOX.min.x + 1.2, y: PAVE_BOX.min.y + 1.65, z: PAVE_BOX.max.z - 1 },
    pavedForward: { x: 0, y: 0, z: -1 },
    // Le dehors. Ce point de vue ne teste aucune couture : il teste une échelle, et c'est
    // la seule image du lot dont le sujet soit le vide.
    bridgeCell: BRIDGE,
    bridgePos: { x: BRIDGE_X, y: BRIDGE_DECK + 1.65, z: 1022 },
    bridgeForward: { x: 0.12, y: -0.08, z: 1 },
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
