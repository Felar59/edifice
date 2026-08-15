/**
 * Le mobilier du musée.
 *
 * Ce sont les premiers objets du bâtiment qui ne sont pas de l'architecture : un cordon de
 * séparation, un banc, une plante en pot. Aucun ne joue de rôle dans la géométrie impossible,
 * et c'est justement pour cela qu'ils comptent. **Une salle vide se lit comme une maquette.**
 * Ce qui la fait basculer en lieu, ce n'est pas une paroi de plus, c'est un objet dont on
 * connaît la taille — un banc dit à quelle hauteur on s'assoit, un cordon dit où l'on n'a pas
 * le droit d'aller, une plante dit que quelqu'un s'en occupe.
 *
 * Tout est construit à partir de deux primitives : le quadrilatère quelconque et le cylindre.
 * Il n'y a ni maillage importé, ni image, ni transparence — une feuille de plante est donc
 * une vraie feuille de géométrie, effilée par ses quatre coins, et non un rectangle percé
 * d'un masque.
 */

import { add, cross, normalize, scale, sub, type Vec3 } from '../math/vec3'
import { pushQuad, type Color } from './geometry'

const TAU = Math.PI * 2

/**
 * Un cylindre debout, éventuellement tronconique.
 *
 * Les côtés seulement, sauf si l'on demande le dessus : ce qui repose au sol n'a pas de
 * dessous à montrer, et un fût de colonne n'a pas de chapeau.
 */
export function pushCylinder(
  out: number[],
  base: Vec3,
  radiusBottom: number,
  radiusTop: number,
  height: number,
  sides: number,
  colour: Color,
  cap?: Color,
): void {
  const ring = (radius: number, y: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * TAU
      return { x: base.x + Math.cos(a) * radius, y: base.y + y, z: base.z + Math.sin(a) * radius }
    })

  const bottom = ring(radiusBottom, 0)
  const top = ring(radiusTop, height)
  const across = Math.max(radiusBottom, radiusTop) * TAU

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    const u0 = (i / sides) * across
    const u1 = ((i + 1) / sides) * across
    pushQuad(out, bottom[i]!, top[i]!, top[j]!, bottom[j]!, colour, [
      [u0, 0],
      [u0, height],
      [u1, height],
      [u1, 0],
    ])
  }

  if (!cap) return
  pushDisc(out, { x: base.x, y: base.y + height, z: base.z }, radiusTop, sides, cap)
}

/**
 * Un disque horizontal, en éventail depuis son centre.
 *
 * Sert à boucher ce qui doit l'être — la terre d'un pot, le fond d'une coupe — sans ajouter
 * de flanc. Un cylindre très plat ferait le même effet et poserait un flanc vertical
 * rigoureusement coplanaire avec celui qui l'entoure ; deux surfaces dans le même plan se
 * disputent alors les pixels.
 */
export function pushDisc(out: number[], centre: Vec3, radius: number, sides: number, colour: Color): void {
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU
    const b = ((i + 1) / sides) * TAU
    const p = (angle: number): Vec3 => ({
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y,
      z: centre.z + Math.sin(angle) * radius,
    })

    // **Le quatrième coin ne peut pas être le centre.** La normale d'un quadrilatère se
    // calcule sur deux de ses arêtes ; si la première et la dernière sont le même point,
    // elle vaut zéro — la surface existe, mais sa lumière est absurde et le tri des faces
    // ne sait plus de quel côté elle regarde. C'est pour cela qu'un pot restait un trou vu
    // d'en haut : son couvercle était bien là, et invisible.
    pushQuad(out, centre, p(b), p(a), p(a), colour, [
      [0, 0],
      [Math.cos(b) * radius, Math.sin(b) * radius],
      [Math.cos(a) * radius, Math.sin(a) * radius],
      [Math.cos(a) * radius, Math.sin(a) * radius],
    ])
  }
}

/** Une boîte quelconque, orientée par trois vecteurs. Sert aux pieds, aux traverses, aux lattes. */
export function pushBar(
  out: number[],
  origin: Vec3,
  along: Vec3,
  wide: Vec3,
  thick: Vec3,
  colour: Color,
): void {
  const p = (a: number, b: number, c: number): Vec3 =>
    add(add(add(origin, scale(along, a)), scale(wide, b)), scale(thick, c))

  const length = Math.hypot(along.x, along.y, along.z)
  const width = Math.hypot(wide.x, wide.y, wide.z)
  const depth = Math.hypot(thick.x, thick.y, thick.z)

  const centre = p(0.5, 0.5, 0.5)

  /**
   * Une face, retournée si besoin pour que sa normale sorte.
   *
   * Le repère donné n'est pas forcément direct — un banc décrit par « le long, la largeur,
   * l'épaisseur » l'est une fois sur deux —, et une face à l'envers ne disparaît pas : le tri
   * des faces arrière la garde et fait disparaître **l'autre**, celle qui était juste. Deux
   * surfaces se retrouvent alors dans le même plan à se disputer les pixels, ce que le musée
   * n'accepte nulle part. On calcule donc la normale et on décide.
   */
  const face = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, w: number, h: number): void => {
    const n = cross(sub(b, a), sub(d, a))
    const outward = sub(a, centre)
    const uvs: [number, number][] = [[0, 0], [0, h], [w, h], [w, 0]]
    if (n.x * outward.x + n.y * outward.y + n.z * outward.z >= 0) {
      pushQuad(out, a, b, c, d, colour, uvs)
    } else {
      pushQuad(out, a, d, c, b, colour, uvs)
    }
  }

  face(p(0, 0, 1), p(0, 1, 1), p(1, 1, 1), p(1, 0, 1), length, width)
  face(p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), p(0, 0, 0), length, width)
  face(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), length, depth)
  face(p(0, 0, 1), p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), length, depth)
  face(p(1, 0, 1), p(1, 1, 1), p(1, 1, 0), p(1, 0, 0), width, depth)
  face(p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1), width, depth)
}

/**
 * Un poteau de cordon : socle, fût, boule.
 *
 * C'est l'objet le plus reconnaissable d'un musée, et il ne coûte que trois cylindres. Sa
 * hauteur — quatre-vingt-quinze centimètres — n'est pas décorative : c'est elle qui donne au
 * regard une échelle humaine dans une salle qui n'en a aucune.
 */
export function pushStanchion(out: number[], at: Vec3, brass: Color, dark: Color): void {
  // Chaque tronçon est **bouché à son sommet**, et le suivant est plus étroit que ce
  // couvercle. Sans cela, un poteau vu d'en haut est un tuyau ouvert : on voit à travers.
  pushCylinder(out, at, 0.16, 0.14, 0.03, 16, dark, dark)
  pushCylinder(out, { ...at, y: at.y + 0.03 }, 0.05, 0.045, 0.82, 12, brass, brass)
  pushCylinder(out, { ...at, y: at.y + 0.85 }, 0.07, 0.06, 0.08, 12, brass, brass)
  pushCylinder(out, { ...at, y: at.y + 0.93 }, 0.05, 0.015, 0.06, 12, brass, brass)
}

/**
 * Le cordon entre deux poteaux : une chaînette, découpée en tronçons.
 *
 * La flèche est ce qui fait tout. Une corde tendue droite ressemble à une barre ; une corde
 * qui pend d'un dixième de sa portée ressemble à une corde. On l'approche par une parabole,
 * qui suffit largement à cette échelle et évite un cosinus hyperbolique pour rien.
 */
function sweep(out: number[], path: Vec3[], radius: number, colour: Color): void {
  const SIDES = 5
  const ring = (k: number): Vec3[] => {
    const here = path[k]!
    const dir = normalize(sub(path[Math.min(k + 1, path.length - 1)]!, path[Math.max(k - 1, 0)]!))
    const side = normalize(cross(dir, { x: 0, y: 1, z: 0 }))
    const up = normalize(cross(side, dir))
    return Array.from({ length: SIDES }, (_, i) => {
      const a = (i / SIDES) * TAU
      return add(here, add(scale(side, Math.cos(a) * radius), scale(up, Math.sin(a) * radius)))
    })
  }

  let previous = ring(0)
  let travelled = 0
  for (let k = 1; k < path.length; k++) {
    const current = ring(k)
    const step = Math.hypot(
      path[k]!.x - path[k - 1]!.x,
      path[k]!.y - path[k - 1]!.y,
      path[k]!.z - path[k - 1]!.z,
    )
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES
      const v0 = (i / SIDES) * radius * TAU
      const v1 = ((i + 1) / SIDES) * radius * TAU
      pushQuad(out, previous[i]!, current[i]!, current[j]!, previous[j]!, colour, [
        [travelled, v0],
        [travelled + step, v0],
        [travelled + step, v1],
        [travelled, v1],
      ])
    }
    travelled += step
    previous = current
  }
}

/**
 * Le cordon d'un poteau à l'autre : une chaînette.
 *
 * La flèche est ce qui fait tout. Une corde tendue droite ressemble à une barre ; une corde
 * qui pend d'un sixième de sa portée ressemble à une corde. On l'approche par une parabole,
 * ce qui suffit largement à cette échelle et évite un cosinus hyperbolique pour rien.
 *
 * **Toute la file est balayée d'un seul tenant.** Une corde faite de tronçons de boîte se
 * chevauche à chaque coude, et deux spires cousues bout à bout se recouvrent au poteau : dans
 * les deux cas, des surfaces se retrouvent dans le même plan à se disputer les pixels. Un
 * tube unique, qui partage ses anneaux, ne se recouvre nulle part.
 */
export function pushRope(out: number[], from: Vec3, to: Vec3, colour: Color, segments = 12): void {
  sweep(out, catenary(from, to, segments), 0.022, colour)
}

function catenary(from: Vec3, to: Vec3, segments: number): Vec3[] {
  const sag = Math.hypot(to.x - from.x, to.z - from.z) * 0.16
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t),
      z: from.z + (to.z - from.z) * t,
    }
  })
}

/** Une file de poteaux reliés, le long d'un segment. */
export function pushCordon(
  out: number[],
  from: Vec3,
  to: Vec3,
  posts: number,
  brass: Color,
  dark: Color,
  rope: Color,
): void {
  const at = (i: number): Vec3 => ({
    x: from.x + (to.x - from.x) * (i / (posts - 1)),
    y: from.y,
    z: from.z + (to.z - from.z) * (i / (posts - 1)),
  })
  for (let i = 0; i < posts; i++) pushStanchion(out, at(i), brass, dark)

  // La corde entière en un seul balayage : deux spires cousues au même poteau se
  // recouvriraient, et le musée n'accepte aucune surface qui en recouvre une autre.
  const path: Vec3[] = []
  for (let i = 0; i < posts - 1; i++) {
    const span = catenary({ ...at(i), y: from.y + 0.86 }, { ...at(i + 1), y: from.y + 0.86 }, 10)
    path.push(...(i === 0 ? span : span.slice(1)))
  }
  sweep(out, path, 0.022, rope)
}

/**
 * Un banc de musée : une assise, deux piétements.
 *
 * Quarante-cinq centimètres d'assise, parce que c'est la hauteur à laquelle on s'assoit. Un
 * objet dont la taille est connue de tous vaut mieux qu'une échelle graphique.
 */
export function pushBench(
  out: number[],
  centre: Vec3,
  length: number,
  along: Vec3,
  wood: Color,
  metal: Color,
): void {
  const dir = normalize(along)
  const side = normalize(cross(dir, { x: 0, y: 1, z: 0 }))
  const seat = 0.45
  const half = length / 2
  const width = 0.42

  const start = add(add(centre, scale(dir, -half)), scale(side, -width / 2))
  pushBar(out, { ...start, y: centre.y + seat - 0.08 }, scale(dir, length), scale(side, width), { x: 0, y: 0.08, z: 0 }, wood)

  for (const t of [-half + 0.35, half - 0.35]) {
    const foot = add(add(centre, scale(dir, t)), scale(side, -0.15))
    pushBar(out, foot, { x: 0, y: seat - 0.08, z: 0 }, scale(side, 0.3), scale(dir, 0.08), metal)
  }
}

/**
 * Une plante en pot.
 *
 * Sans transparence, une feuille est une vraie feuille : un quadrilatère effilé par ses
 * quatre coins, en deux tronçons pour qu'elle retombe. C'est peu de triangles, et cela suffit
 * — on reconnaît une plante à sa silhouette et à son désordre, pas à son détail.
 */
export function pushPlant(
  out: number[],
  at: Vec3,
  pot: Color,
  soil: Color,
  leaf: Color,
  seed = 1,
): void {
  // **La terre ferme le pot.** Un cylindre n'a qu'une peau : vu de dessus, un pot dont la
  // bouche n'est pas bouchée laisse voir à travers lui — le tri des faces arrière supprime
  // sa paroi opposée, et il ne reste qu'un trou. La terre doit donc affleurer la collerette
  // et faire exactement sa largeur, sans quoi il subsiste un anneau de vide.
  pushCylinder(out, at, 0.22, 0.28, 0.40, 14, pot)
  pushCylinder(out, { ...at, y: at.y + 0.36 }, 0.30, 0.30, 0.07, 14, pot)
  pushDisc(out, { ...at, y: at.y + 0.40 }, 0.30, 14, soil)

  // Un haché maison plutôt qu'un tirage au sort : deux plantes doivent différer, mais la
  // même plante doit être la même d'une exécution à l'autre — sans quoi les captures de
  // référence du test de torture ne voudraient plus rien dire.
  const noise = (i: number): number => {
    const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
    return x - Math.floor(x)
  }

  const blades = 11
  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * TAU + noise(i) * 0.5
    const dir = { x: Math.cos(angle), y: 0, z: Math.sin(angle) }
    const side = { x: -dir.z, y: 0, z: dir.x }
    const reach = 0.45 + noise(i + 30) * 0.35
    const rise = 0.5 + noise(i + 60) * 0.45
    const root = { x: at.x, y: at.y + 0.44, z: at.z }

    // Deux tronçons : le premier monte, le second retombe. C'est la cassure qui fait la
    // plante ; une feuille droite fait un plumeau.
    const mid = add(add(root, scale(dir, reach * 0.55)), { x: 0, y: rise, z: 0 })
    const tip = add(add(root, scale(dir, reach)), { x: 0, y: rise * 0.55, z: 0 })
    const wide = 0.055

    pushLeaf(out, root, mid, tip, side, wide, leaf)
  }
}

/**
 * Une police de chiffres, en cinq lignes de trois.
 *
 * Le musée n'a pas de texte : ni police chargée, ni atlas, ni rendu de glyphes. Il en faut
 * pourtant, ne serait-ce que pour numéroter des essais — on ne peut pas dire « le troisième
 * en partant de la gauche » vingt fois de suite sans se tromper. Trois colonnes sur cinq
 * lignes suffisent à dix chiffres, chaque case allumée devenant un quadrilatère. C'est la
 * plus petite police lisible, et elle a l'avantage d'avoir l'air de ce qu'elle est : une
 * inscription d'atelier, pas une enseigne.
 */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001001001',
  '8': '111101111101111',
  '9': '111101111001111',
}

/**
 * Écrit un nombre, à plat sur une surface.
 *
 * `right` et `up` donnent le plan et l'échelle : leur longueur est celle d'une case, de sorte
 * qu'un chiffre fait trois cases de large et cinq de haut. On dessine depuis le coin
 * inférieur gauche, comme on lit.
 */
export function pushDigits(
  out: number[],
  origin: Vec3,
  right: Vec3,
  up: Vec3,
  text: string,
  colour: Color,
): void {
  let column = 0
  for (const character of text) {
    const glyph = GLYPHS[character]
    if (!glyph) {
      column += 2
      continue
    }
    for (let row = 0; row < 5; row++) {
      for (let x = 0; x < 3; x++) {
        if (glyph[row * 3 + x] !== '1') continue
        const cx = column + x
        const cy = 4 - row
        const a = add(add(origin, scale(right, cx)), scale(up, cy))
        // L'ordre des coins met la normale du côté de `right × up` : à l'envers, le chiffre
        // existe mais le tri des faces arrière l'efface, et l'on cherche longtemps une
        // plaque qu'on croit vide.
        pushQuad(
          out,
          a,
          add(a, right),
          add(add(a, right), up),
          add(a, up),
          colour,
          [[0, 0], [1, 0], [1, 1], [0, 1]],
        )
      }
    }
    column += 4
  }
}

/**
 * Une colonne : base, fût, chapiteau.
 *
 * Le fût est très légèrement conique — l'entasis des Grecs, deux pour cent suffisent. Une
 * colonne parfaitement cylindrique paraît creusée en son milieu, et personne ne sait dire
 * pourquoi ; c'est un défaut de l'œil, et la seule façon de le corriger est de mentir un peu
 * dans l'autre sens.
 */
export function pushColumn(
  out: number[],
  at: Vec3,
  radius: number,
  height: number,
  shaft: Color,
  stone: Color,
): void {
  const plinth = 0.16
  const capital = 0.22
  const body = height - plinth - capital

  pushCylinder(out, at, radius * 1.34, radius * 1.28, plinth, 16, stone, stone)
  pushCylinder(out, { ...at, y: at.y + plinth }, radius, radius * 0.94, body, 16, shaft, shaft)
  pushCylinder(out, { ...at, y: at.y + plinth + body }, radius * 1.1, radius * 1.3, capital * 0.7, 16, stone, stone)
  pushCylinder(
    out,
    { ...at, y: at.y + height - capital * 0.3 },
    radius * 1.36,
    radius * 1.36,
    capital * 0.3,
    16,
    stone,
    stone,
  )
}

/**
 * Une applique murale : une potence et un abat-jour retourné.
 *
 * Elle ne fabrique pas de lumière — c'est la cellule qui porte ses lampes — mais elle lui
 * donne une **cause**. Une salle éclairée par rien est une salle de moteur ; la même avec
 * deux appliques devient une salle de musée, et l'on n'y pense plus.
 */
export function pushSconce(
  out: number[],
  at: Vec3,
  outward: Vec3,
  metal: Color,
  glass: Color,
): void {
  const dir = normalize(outward)
  const side = normalize(cross(dir, { x: 0, y: 1, z: 0 }))

  // La platine contre le mur, puis le bras qui s'en écarte.
  pushBar(out, add(add(at, scale(side, -0.09)), { x: 0, y: -0.14, z: 0 }), { x: 0, y: 0.28, z: 0 }, scale(side, 0.18), scale(dir, 0.05), metal)
  pushBar(out, add(add(at, scale(side, -0.025)), scale(dir, 0.04)), scale(dir, 0.22), scale(side, 0.05), { x: 0, y: 0.05, z: 0 }, metal)

  // La coupe, ouverte vers le haut : sa lumière rase le mur, ce qui est exactement ce qu'on
  // demande à une applique.
  const bowl = add(add(at, scale(dir, 0.26)), { x: 0, y: 0.02, z: 0 })
  pushCylinder(out, bowl, 0.05, 0.15, 0.13, 14, metal, glass)
}

/**
 * Une suspension : une tige, une coupole, une ampoule.
 */
export function pushPendant(
  out: number[],
  ceiling: Vec3,
  drop: number,
  metal: Color,
  glass: Color,
): void {
  pushCylinder(out, { ...ceiling, y: ceiling.y - drop }, 0.02, 0.02, drop, 8, metal)
  pushCylinder(out, { ...ceiling, y: ceiling.y - drop - 0.18 }, 0.28, 0.06, 0.18, 16, metal, metal)
  pushCylinder(out, { ...ceiling, y: ceiling.y - drop - 0.26 }, 0.07, 0.07, 0.1, 10, glass, glass)
}

/**
 * Un cadre, avec sa toile.
 *
 * C'est le meuble qui manquait le plus : un musée sans cadre est un couloir. La moulure est
 * faite de quatre barres en onglet grossier — elles se recouvrent aux angles, ce qui ne se
 * voit pas et évite quatre trapèzes —, et la toile est un panneau posé au fond, en retrait de
 * la moulure pour qu'une ombre l'accroche.
 *
 * `right` et `up` sont unitaires et donnent le plan du mur ; le cadre s'y pose face à
 * `right × up`.
 */
/**
 * Le profil d'un cadre : une suite de gradins concentriques.
 *
 * Un cadre n'est pas une planche percée. C'est un **profil** — une succession de gradins,
 * chacun à sa profondeur, qui accrochent la lumière différemment : une doucine qui fuit vers
 * le mur, une gorge dans l'ombre, un filet vif contre l'ouverture. C'est cette alternance qui
 * le fait lire comme une moulure, et c'est elle qui permet d'être **fin**.
 *
 * Car la première version était large, et pour une mauvaise raison : une baguette unique doit
 * être épaisse pour se voir, alors que trois gradins de dix-huit millimètres se voient mieux
 * qu'une planche de onze centimètres — et n'écrasent pas l'œuvre. Un cadre de musée fait
 * quatre à six centimètres pour une toile d'un mètre ; au-delà, c'est le cadre qu'on regarde.
 */
export interface FrameStep {
  /** Largeur du gradin, en mètres. */
  width: number
  /** Saillie par rapport au mur. Alterner les valeurs crée le relief. */
  out: number
  colour: Color
}

export interface FrameStyle {
  /** Les gradins, du plus extérieur au plus intérieur. */
  profile: readonly FrameStep[]
  /** Le passe-partout : la marge autour de l'œuvre. */
  mount?: Color
  /** Largeur de cette marge. */
  margin?: number
}

export function pushFramed(
  out: number[],
  centre: Vec3,
  right: Vec3,
  up: Vec3,
  width: number,
  height: number,
  style: FrameStyle,
  canvas: Color,
): void {
  const normal = normalize(cross(right, up))
  const corner = add(add(centre, scale(right, -width / 2)), scale(up, -height / 2))

  let inset = 0
  for (const step of style.profile) {
    const o = add(add(corner, scale(right, inset)), scale(up, inset))
    const w = width - inset * 2
    const h = height - inset * 2
    const thick = scale(normal, step.out)

    // Un demi-millimètre de trop, exprès. Sans lui, la face intérieure d'un gradin et la face
    // extérieure du suivant occupent exactement le même plan, et deux surfaces dans le même
    // plan se disputent les pixels dès qu'on regarde le cadre de biais. En mordant sur son
    // voisin, la face se retrouve enfouie dans la matière et la question ne se pose plus.
    const bite = step.width + 0.0006

    // Les quatre côtés du gradin. Les montants s'arrêtent aux traverses : ils se
    // recouvriraient sinon, pour la même raison.
    pushBar(out, o, scale(right, w), scale(up, bite), thick, step.colour)
    pushBar(out, add(o, scale(up, h - bite)), scale(right, w), scale(up, bite), thick, step.colour)
    pushBar(out, add(o, scale(up, bite)), scale(up, h - bite * 2), scale(right, bite), thick, step.colour)
    pushBar(
      out,
      add(add(o, scale(right, w - bite)), scale(up, bite)),
      scale(up, h - bite * 2),
      scale(right, bite),
      thick,
      step.colour,
    )
    inset += step.width
  }

  const margin = style.mount ? (style.margin ?? 0.045) : 0
  const deepest = Math.min(...style.profile.map((p) => p.out))

  if (style.mount) {
    const o = add(add(corner, scale(right, inset)), scale(up, inset))
    const w = width - inset * 2
    const h = height - inset * 2
    const flat = scale(normal, deepest * 0.55)
    pushQuad(
      out,
      add(o, flat),
      add(add(o, scale(right, w)), flat),
      add(add(add(o, scale(right, w)), scale(up, h)), flat),
      add(add(o, scale(up, h)), flat),
      style.mount,
      [[0, 0], [w, 0], [w, h], [0, h]],
    )
  }

  // L'œuvre, mesurée de zéro à un, posée juste devant le passe-partout.
  const art = add(add(corner, scale(right, inset + margin)), scale(up, inset + margin))
  const aw = width - (inset + margin) * 2
  const ah = height - (inset + margin) * 2
  const front = scale(normal, deepest * 0.55 + (style.mount ? 0.008 : 0))
  pushQuad(
    out,
    add(art, front),
    add(add(art, scale(right, aw)), front),
    add(add(add(art, scale(right, aw)), scale(up, ah)), front),
    add(add(art, scale(up, ah)), front),
    canvas,
    [[0, 1], [1, 1], [1, 0], [0, 0]],
  )
}

/**
 * La lampe d'un tableau : une potence, un tube de laiton, une lumière vers le bas.
 *
 * C'est l'objet qui fait le plus pour l'ambiance d'une salle d'exposition, et personne ne le
 * regarde jamais — on regarde ce qu'il éclaire. Un musée sombre avec une toile allumée est
 * infiniment plus juste qu'un musée uniformément clair.
 */
export function pushPictureLight(
  out: number[],
  at: Vec3,
  outward: Vec3,
  span: number,
  brass: Color,
  glow: Color,
): void {
  const dir = normalize(outward)
  const side = normalize(cross(dir, { x: 0, y: 1, z: 0 }))

  // La potence contre le mur.
  pushBar(out, add(add(at, scale(side, -0.02)), { x: 0, y: -0.03, z: 0 }), scale(dir, 0.18), scale(side, 0.04), { x: 0, y: 0.05, z: 0 }, brass)
  // Le tube, horizontal, ouvert vers le bas.
  const tube = add(add(at, scale(dir, 0.2)), scale(side, -span / 2))
  pushBar(out, tube, scale(side, span), scale(dir, 0.09), { x: 0, y: 0.07, z: 0 }, brass)
  pushBar(out, add(tube, { x: 0, y: -0.012, z: 0 }), scale(side, span * 0.94), scale(dir, 0.07), { x: 0, y: 0.012, z: 0 }, glow)
}

/**
 * Un lampadaire : pied, fût, abat-jour retourné.
 *
 * Il pose une flaque de lumière au sol et une autre au plafond, ce qu'aucune source encastrée
 * ne sait faire. Dans une salle qu'on veut chaude, c'est lui qu'il faut.
 */
export function pushTorchere(out: number[], at: Vec3, metal: Color, glow: Color): void {
  pushCylinder(out, at, 0.22, 0.2, 0.04, 16, metal, metal)
  pushCylinder(out, { ...at, y: at.y + 0.04 }, 0.035, 0.03, 1.5, 10, metal, metal)
  pushCylinder(out, { ...at, y: at.y + 1.5 }, 0.1, 0.26, 0.3, 16, metal)
  pushDisc(out, { ...at, y: at.y + 1.62 }, 0.24, 16, glow)
}

/**
 * Un lustre : une couronne et ses globes.
 *
 * Cinq globes plutôt qu'un : une source unique fait une tache au plafond, cinq font une
 * lumière. Ils sont émissifs, la couronne ne l'est pas — c'est ce contraste qui donne
 * l'impression qu'ils brillent.
 */
export function pushChandelier(
  out: number[],
  ceiling: Vec3,
  drop: number,
  radius: number,
  metal: Color,
  glow: Color,
): void {
  pushCylinder(out, { ...ceiling, y: ceiling.y - drop }, 0.018, 0.018, drop, 8, metal)
  const hub = { ...ceiling, y: ceiling.y - drop }
  pushCylinder(out, { ...hub, y: hub.y - 0.06 }, 0.09, 0.05, 0.12, 12, metal, metal)

  const arms = 5
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * TAU
    const dir = { x: Math.cos(a), y: 0, z: Math.sin(a) }
    const side = { x: -dir.z, y: 0, z: dir.x }
    const start = add({ ...hub, y: hub.y - 0.02 }, scale(dir, 0.05))
    pushBar(out, add(start, scale(side, -0.012)), scale(dir, radius), scale(side, 0.024), { x: 0, y: 0.024, z: 0 }, metal)
    const tip = add({ ...hub, y: hub.y - 0.02 }, scale(dir, radius))
    pushCylinder(out, { ...tip, y: tip.y - 0.02 }, 0.055, 0.045, 0.11, 10, glow, glow)
  }
}


/**
 * Une feuille : deux tronçons, une nervure, et **deux faces**.
 *
 * Un quadrilatère n'a qu'un côté. Le tri des faces arrière l'efface dès qu'on passe derrière,
 * et une plante faite de quadrilatères simples se troue quand on en fait le tour — c'est le
 * vide qu'on voyait au-dessus des pots. Chaque feuille est donc posée deux fois, la seconde à
 * l'envers : deux fois plus de triangles pour un objet qui en compte quelques dizaines, et le
 * défaut disparaît pour de bon.
 */
function pushLeaf(
  out: number[],
  root: Vec3,
  mid: Vec3,
  tip: Vec3,
  side: Vec3,
  wide: number,
  colour: Color,
): void {
  const a0 = add(root, scale(side, -0.012))
  const a1 = add(root, scale(side, 0.012))
  const b0 = add(mid, scale(side, -wide))
  const b1 = add(mid, scale(side, wide))
  const c0 = add(tip, scale(side, -wide * 0.12))
  const c1 = add(tip, scale(side, wide * 0.12))

  const low: [number, number][] = [[0, 0], [0.024, 0], [wide * 2, 0.5], [0, 0.5]]
  const high: [number, number][] = [[0, 0.5], [wide * 2, 0.5], [wide * 0.24, 1], [0, 1]]

  pushQuad(out, a0, a1, b1, b0, colour, low)
  pushQuad(out, b0, b1, c1, c0, colour, high)
  // L'envers, dans l'ordre inverse.
  pushQuad(out, b0, b1, a1, a0, colour, low)
  pushQuad(out, c0, c1, b1, b0, colour, high)
}

/**
 * Un arbuste en bac : un tronc, quatre couronnes de feuilles, un bac carré.
 *
 * L'autre plante du musée est une touffe de lames qui partent du sol — un genre d'agave posé
 * dans un pot rond. Celle-ci est son contraire : un tronc qui monte, un bac carré, et un
 * feuillage porté en hauteur. Deux espèces suffisent à ce qu'une salle n'ait pas l'air
 * meublée par catalogue, pourvu qu'elles ne se ressemblent en rien — silhouette, contenant,
 * hauteur du feuillage.
 *
 * Le feuillage est fait de **couronnes** étagées le long du tronc plutôt que de branches
 * garnies. Des branches nues qui dépassent du feuillage font un parapluie cassé ; des
 * couronnes qui se recouvrent font une masse, et une masse se lit comme une plante.
 */
export function pushShrub(
  out: number[],
  at: Vec3,
  planter: Color,
  soil: Color,
  bark: Color,
  leaf: Color,
  seed = 1,
): void {
  const noise = (i: number): number => {
    const x = Math.sin(i * 27.13 + seed * 51.7) * 24571.3
    return x - Math.floor(x)
  }

  // Le bac : une caisse carrée et son bandeau de rive, qui lui donne une épaisseur.
  const half = 0.26
  const high = 0.42
  pushBar(
    out,
    { x: at.x - half, y: at.y, z: at.z - half },
    { x: half * 2, y: 0, z: 0 },
    { x: 0, y: high - 0.06, z: 0 },
    { x: 0, y: 0, z: half * 2 },
    planter,
  )
  const rim = half + 0.025
  pushBar(
    out,
    { x: at.x - rim, y: at.y + high - 0.06, z: at.z - rim },
    { x: rim * 2, y: 0, z: 0 },
    { x: 0, y: 0.06, z: 0 },
    { x: 0, y: 0, z: rim * 2 },
    planter,
  )
  // La terre est posée **au-dessus** du bandeau, et plus étroite : à fleur, les deux surfaces
  // partageraient le même plan et se disputeraient les pixels.
  pushDisc(out, { x: at.x, y: at.y + high + 0.006, z: at.z }, rim * 0.86, 4, soil)

  // Le tronc, en trois tronçons qui se décalent : un fût parfaitement droit fait un tuyau.
  let foot = { x: at.x, y: at.y + high - 0.02, z: at.z }
  const lean = noise(3) * TAU
  for (let i = 0; i < 3; i++) {
    const bottom = 0.055 - i * 0.012
    pushCylinder(out, foot, bottom, bottom - 0.012, 0.3, 7, bark, bark)
    foot = {
      x: foot.x + Math.cos(lean + i * 1.7) * 0.035,
      y: foot.y + 0.3,
      z: foot.z + Math.sin(lean + i * 1.7) * 0.035,
    }
  }

  // Quatre couronnes étagées. La plus basse est la plus large et retombe le plus ; la plus
  // haute est courte et dressée. C'est ce dégradé qui donne la silhouette en dôme.
  const crowns = 4
  for (let k = 0; k < crowns; k++) {
    const t = k / (crowns - 1)
    const centre = {
      x: at.x + (foot.x - at.x) * (0.55 + t * 0.45),
      y: at.y + high + 0.36 + t * 0.5,
      z: at.z + (foot.z - at.z) * (0.55 + t * 0.45),
    }
    const leaves = 8 - k
    for (let i = 0; i < leaves; i++) {
      const angle = (i / leaves) * TAU + k * 0.7 + noise(k * 17 + i) * 0.6
      const dir = { x: Math.cos(angle), y: 0, z: Math.sin(angle) }
      const side = { x: -dir.z, y: 0, z: dir.x }
      const reach = (0.34 - t * 0.14) * (0.75 + noise(k * 31 + i) * 0.5)
      // Le port : dressé en haut du tronc, retombant en bas.
      const rise = (0.16 - t * 0.02) * (0.6 + noise(k * 7 + i) * 0.8)
      const drop = (1 - t) * 0.22

      const root = centre
      const mid = add(add(root, scale(dir, reach * 0.5)), { x: 0, y: rise, z: 0 })
      const tip = add(add(root, scale(dir, reach)), { x: 0, y: rise - drop, z: 0 })
      pushLeaf(out, root, mid, tip, side, 0.075 - t * 0.02, leaf)
    }
  }
}
