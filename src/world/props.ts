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
  // Le dessus en éventail depuis le centre. Les coordonnées de surface y sont planes, de
  // sorte qu'un marbre ou un bois s'y lise comme sur une table.
  const centre = { x: base.x, y: base.y + height, z: base.z }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    pushQuad(out, centre, top[i]!, top[j]!, centre, cap, [
      [0, 0],
      [top[i]!.x - centre.x, top[i]!.z - centre.z],
      [top[j]!.x - centre.x, top[j]!.z - centre.z],
      [0, 0],
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
  pushCylinder(out, at, 0.16, 0.14, 0.03, 16, dark, dark)
  pushCylinder(out, { ...at, y: at.y + 0.03 }, 0.05, 0.04, 0.82, 12, brass)
  pushCylinder(out, { ...at, y: at.y + 0.85 }, 0.07, 0.07, 0.08, 12, brass, brass)
  pushCylinder(out, { ...at, y: at.y + 0.93 }, 0.05, 0.02, 0.05, 12, brass, brass)
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
  // Le pot, sa collerette, et la terre en retrait. La collerette n'a **pas** de dessus :
  // un disque plein à la bouche du pot recouvrirait la terre, et deux surfaces dans le même
  // plan se disputeraient les pixels.
  pushCylinder(out, at, 0.22, 0.28, 0.40, 14, pot)
  pushCylinder(out, { ...at, y: at.y + 0.36 }, 0.30, 0.30, 0.06, 14, pot)
  pushCylinder(out, { ...at, y: at.y + 0.34 }, 0.27, 0.27, 0.02, 14, soil, soil)

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
    const narrow = 0.03

    pushQuad(
      out,
      add(root, scale(side, -0.02)),
      add(root, scale(side, 0.02)),
      add(mid, scale(side, wide)),
      add(mid, scale(side, -wide)),
      leaf,
      [[0, 0], [0.04, 0], [wide * 2, 0.5], [0, 0.5]],
    )
    pushQuad(
      out,
      add(mid, scale(side, -wide)),
      add(mid, scale(side, wide)),
      add(tip, scale(side, narrow * 0.2)),
      add(tip, scale(side, -narrow * 0.2)),
      leaf,
      [[0, 0.5], [wide * 2, 0.5], [narrow, 1], [0, 1]],
    )
  }
}
