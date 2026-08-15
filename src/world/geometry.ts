/**
 * Construction des maillages de cellules.
 *
 * Rien de sophistiqué : des quads axés, avec la possibilité de percer une paroi
 * d'une ouverture rectangulaire. Le trou est un vrai trou dans la géométrie —
 * poser le quad du portail par-dessus le mur donnerait un conflit de profondeur,
 * et c'est précisément le genre de scintillement qui tue l'illusion.
 */

import type { F32 } from '../f32'
import { frameAt, toWorld, type Twist } from './twist'
import type { Spiral } from './types'
import { onSquare, stepAngle, stepHeight } from './spiral'
import { add, cross, len, normalize, scale, sub, type Vec3 } from '../math/vec3'

/** position (3) · normale (3) · uv (2) · couleur (3) · matière (1) */
export const FLOATS_PER_VERTEX = 12

/**
 * Une couleur, et éventuellement la **matière** qui la porte.
 *
 * Le quatrième nombre est un identifiant de motif, calculé par le nuanceur à partir des
 * coordonnées de surface : marbre, parquet, lambris, pierre, béton, tôle. Il voyage avec la
 * couleur plutôt qu'à côté, et pour une raison bête : la couleur traverse une trentaine de
 * fonctions de construction, et lui faire de la place partout aurait coûté un fichier de
 * modifications sans rien apporter. Une matière **est** un aspect de surface ; qu'elle
 * voyage avec la teinte de cette surface se défend.
 *
 * Absente, elle vaut zéro : la matière neutre, celle du quadrillage de mise au point.
 */
export type Color = readonly [number, number, number, number?]

export interface Hole {
  center: Vec3
  halfWidth: number
  halfHeight: number
}

export interface WallSpec {
  /** Coin de la paroi. */
  origin: Vec3
  /** Arête « horizontale » complète (longueur = largeur de la paroi). */
  right: Vec3
  /** Arête « verticale » complète. */
  up: Vec3
  color: Color
  /**
   * Ouvertures à percer, disjointes horizontalement.
   *
   * Plusieurs, désormais : la rotonde a deux portes sur la même paroi, et s'en tenir
   * à une seule aurait imposé une pièce centrale à quatre ailes au maximum.
   */
  holes?: Hole[]
}

/**
 * Un morceau de paroi, décrit en coordonnées paramétriques (s, t) ∈ [0,1]²
 * sur la paroi complète. Les uv sont exprimés en **unités du monde** pour que
 * le quadrillage du nuanceur reste continu d'un morceau à l'autre.
 */
function pushSubQuad(
  out: number[],
  spec: WallSpec,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
): void {
  const wRight = len(spec.right)
  const wUp = len(spec.up)
  if ((s1 - s0) * wRight < 1e-4 || (t1 - t0) * wUp < 1e-4) return // morceau dégénéré

  const n = normalize(cross(spec.right, spec.up))
  const corner = (s: number, t: number): Vec3 =>
    add(add(spec.origin, scale(spec.right, s)), scale(spec.up, t))

  const p00 = corner(s0, t0)
  const p10 = corner(s1, t0)
  const p11 = corner(s1, t1)
  const p01 = corner(s0, t1)

  const u0 = s0 * wRight
  const u1 = s1 * wRight
  const v0 = t0 * wUp
  const v1 = t1 * wUp

  const [r, g, b, matter] = spec.color
  const push = (p: Vec3, u: number, v: number): void => {
    out.push(p.x, p.y, p.z, n.x, n.y, n.z, u, v, r, g, b, matter ?? 0)
  }

  push(p00, u0, v0); push(p10, u1, v0); push(p11, u1, v1)
  push(p00, u0, v0); push(p11, u1, v1); push(p01, u0, v1)
}

/**
 * Une paroi, éventuellement percée de plusieurs ouvertures.
 *
 * Le découpage est celui qu'on ferait à la main sur un plan : des bandes pleine
 * hauteur entre les ouvertures, puis pour chacune le morceau au-dessus et celui en
 * dessous. Cela suppose les ouvertures **disjointes horizontalement**, ce qui est le
 * cas de deux portes sur un même mur ; le contraire est refusé bruyamment plutôt que
 * dessiné de travers.
 */
export function pushWall(out: number[], spec: WallSpec): void {
  const holes = spec.holes ?? []
  if (holes.length === 0) {
    pushSubQuad(out, spec, 0, 1, 0, 1)
    return
  }

  const wRight = len(spec.right)
  const wUp = len(spec.up)
  const dirR = scale(spec.right, 1 / wRight)
  const dirU = scale(spec.up, 1 / wUp)

  // Chaque ouverture, ramenée aux coordonnées paramétriques de la paroi.
  const spans = holes
    .map((hole) => {
      const rel = sub(hole.center, spec.origin)
      const cs = (rel.x * dirR.x + rel.y * dirR.y + rel.z * dirR.z) / wRight
      const ct = (rel.x * dirU.x + rel.y * dirU.y + rel.z * dirU.z) / wUp
      return {
        s0: Math.max(0, cs - hole.halfWidth / wRight),
        s1: Math.min(1, cs + hole.halfWidth / wRight),
        t0: Math.max(0, ct - hole.halfHeight / wUp),
        t1: Math.min(1, ct + hole.halfHeight / wUp),
      }
    })
    .sort((a, b) => a.s0 - b.s0)

  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.s0 < spans[i - 1]!.s1) {
      throw new Error(
        'ouvertures qui se chevauchent sur une même paroi : le découpage en bandes ne ' +
          'sait pas les traiter',
      )
    }
  }

  let cursor = 0
  for (const span of spans) {
    pushSubQuad(out, spec, cursor, span.s0, 0, 1)   // bande pleine hauteur avant
    pushSubQuad(out, spec, span.s0, span.s1, 0, span.t0)  // sous l'ouverture
    pushSubQuad(out, spec, span.s0, span.s1, span.t1, 1)  // au-dessus
    cursor = span.s1
  }
  pushSubQuad(out, spec, cursor, 1, 0, 1)           // bande pleine hauteur après
}

/**
 * Une paroi divisée en neuf, dont les huit morceaux du pourtour portent une autre teinte.
 *
 * La bordure n'est pas un ornement : c'est la **bande d'accroche** de la salle aux six
 * sols, celle où le fait de marcher change la face sur laquelle on se tient. La règle et
 * son signe sont la même chose, ce qui évite d'avoir à l'expliquer.
 *
 * Chaque morceau est une paroi à part entière, et reçoit donc les ouvertures qui le
 * traversent — clipées par `pushWall` dans son propre repère. Une ouverture qui chevauche
 * deux morceaux est dessinée correctement dans les deux ; une qui n'en touche aucun ne
 * doit surtout pas leur être passée, faute de quoi le découpage en bandes déborderait la
 * paroi.
 */
export function pushPanelled(out: number[], spec: WallSpec, border: number, edge: Color): void {
  const wRight = len(spec.right)
  const wUp = len(spec.up)
  const su = [0, Math.min(border / wRight, 0.5), Math.max(1 - border / wRight, 0.5), 1]
  const sv = [0, Math.min(border / wUp, 0.5), Math.max(1 - border / wUp, 0.5), 1]

  // Chaque ouverture, ramenée aux coordonnées paramétriques de la paroi entière.
  const dirR = scale(spec.right, 1 / wRight)
  const dirU = scale(spec.up, 1 / wUp)
  const spans = (spec.holes ?? []).map((hole) => {
    const rel = sub(hole.center, spec.origin)
    const cs = (rel.x * dirR.x + rel.y * dirR.y + rel.z * dirR.z) / wRight
    const ct = (rel.x * dirU.x + rel.y * dirU.y + rel.z * dirU.z) / wUp
    return {
      hole,
      s0: cs - hole.halfWidth / wRight,
      s1: cs + hole.halfWidth / wRight,
      t0: ct - hole.halfHeight / wUp,
      t1: ct + hole.halfHeight / wUp,
    }
  })

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const piece: WallSpec = {
        origin: add(
          add(spec.origin, scale(spec.right, su[i]!)),
          scale(spec.up, sv[j]!),
        ),
        right: scale(spec.right, su[i + 1]! - su[i]!),
        up: scale(spec.up, sv[j + 1]! - sv[j]!),
        color: i === 1 && j === 1 ? spec.color : edge,
      }
      const holes = spans
        .filter(
          (h) =>
            Math.min(h.s1, su[i + 1]!) - Math.max(h.s0, su[i]!) > 1e-6 &&
            Math.min(h.t1, sv[j + 1]!) - Math.max(h.t0, sv[j]!) > 1e-6,
        )
        .map((h) => h.hole)
      pushWall(out, holes.length ? { ...piece, holes } : piece)
    }
  }
}

export interface RoomHoles {
  /** Ouvertures sur la paroi z = min.z (normale intérieure +Z). */
  north?: Hole[]
  /** Ouvertures sur la paroi z = max.z (normale intérieure -Z). */
  south?: Hole[]
  /** Ouvertures sur la paroi x = min.x (normale intérieure +X). */
  west?: Hole[]
  /** Ouvertures sur la paroi x = max.x (normale intérieure -X). */
  east?: Hole[]
}

export interface RoomPalette {
  floor: Color
  ceiling: Color
  wall: Color
  /**
   * Une teinte par paroi, quand il faut pouvoir les distinguer.
   *
   * Indispensable dès qu'une pièce a plusieurs sols : six faces de la même couleur, et
   * l'on ne sait plus sur laquelle on se tient ni d'où l'on vient.
   */
  walls?: { north: Color; south: Color; west: Color; east: Color }
}

/** De quoi peindre une bordure sur chaque paroi. Voir `pushPanelled`. */
export interface Panels {
  border: number
  edge: Color
}

/** Une pièce parallélépipédique vue de l'intérieur. */
export function buildRoom(
  min: Vec3,
  max: Vec3,
  pal: RoomPalette,
  holes: RoomHoles = {},
  panels?: Panels,
  /**
   * Ne dessiner que le sol et le plafond, les quatre côtés restant ouverts.
   *
   * C'est ce qu'il faut pour une salle pavée : ses parois ne sont pas percées d'une porte,
   * **elles sont l'ouverture**. Une couture y occupe le mur entier, et ce qu'on voit à
   * travers est la même salle. Dessiner un mur derrière serait dessiner ce que personne ne
   * peut voir, et le premier écart d'un millimètre le ferait apparaître.
   */
  openWalls = false,
): F32 {
  const out: number[] = []
  const emit = (spec: WallSpec): void => {
    if (panels) pushPanelled(out, spec, panels.border, panels.edge)
    else pushWall(out, spec)
  }
  const dx = max.x - min.x
  const dy = max.y - min.y
  const dz = max.z - min.z

  // Sol : normale +Y, donc right × up = +Y avec right = +X et up = -Z.
  emit({
    origin: { x: min.x, y: min.y, z: max.z },
    right: { x: dx, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -dz },
    color: pal.floor,
  })
  // Plafond : normale -Y.
  emit({
    origin: { x: min.x, y: max.y, z: min.z },
    right: { x: dx, y: 0, z: 0 },
    up: { x: 0, y: 0, z: dz },
    color: pal.ceiling,
  })
  if (openWalls) return new Float32Array(out)

  // Paroi nord (z = min.z), normale +Z : right = +X, up = +Y.
  emit({
    origin: { x: min.x, y: min.y, z: min.z },
    right: { x: dx, y: 0, z: 0 },
    up: { x: 0, y: dy, z: 0 },
    color: pal.walls?.north ?? pal.wall,
    ...(holes.north ? { holes: holes.north } : {}),
  })
  // Paroi sud (z = max.z), normale -Z : right = -X, up = +Y.
  emit({
    origin: { x: max.x, y: min.y, z: max.z },
    right: { x: -dx, y: 0, z: 0 },
    up: { x: 0, y: dy, z: 0 },
    color: pal.walls?.south ?? pal.wall,
    ...(holes.south ? { holes: holes.south } : {}),
  })
  // Paroi ouest (x = min.x), normale +X : right = -Z, up = +Y.
  emit({
    origin: { x: min.x, y: min.y, z: max.z },
    right: { x: 0, y: 0, z: -dz },
    up: { x: 0, y: dy, z: 0 },
    color: pal.walls?.west ?? pal.wall,
    ...(holes.west ? { holes: holes.west } : {}),
  })
  // Paroi est (x = max.x), normale -X : right = +Z, up = +Y.
  emit({
    origin: { x: max.x, y: min.y, z: min.z },
    right: { x: 0, y: 0, z: dz },
    up: { x: 0, y: dy, z: 0 },
    color: pal.walls?.east ?? pal.wall,
    ...(holes.east ? { holes: holes.east } : {}),
  })

  return new Float32Array(out)
}


/**
 * Un quadrilatère quelconque, donné dans l'ordre a → b → c → d.
 *
 * `pushWall` ne sait poser que des parallélogrammes, ce qui a suffi tant que le musée
 * n'était fait que de boîtes. Les marches d'un escalier tournant sont des trapèzes.
 */
export function pushQuad(
  out: number[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  colour: Color,
  uvs: [number, number][],
): void {
  const n = normalize(cross(sub(b, a), sub(d, a)))
  const [r, g, bl, matter] = colour
  const push = (p: Vec3, uv: [number, number]): void => {
    out.push(p.x, p.y, p.z, n.x, n.y, n.z, uv[0], uv[1], r, g, bl, matter ?? 0)
  }

  push(a, uvs[0]!); push(b, uvs[1]!); push(c, uvs[2]!)
  push(a, uvs[0]!); push(c, uvs[2]!); push(d, uvs[3]!)
}

/**
 * Le ruban de marches d'un escalier tournant, et le dessous du ruban.
 *
 * Le dessous n'est pas une politesse : sans lui, le tri des faces arrière laisse voir au
 * travers de la volée dès qu'on lève les yeux, et l'on aperçoit le vide qu'elle est censée
 * fermer.
 *
 * Une marche par quartier, une contremarche à chaque limite. Le nombre de marches étant un
 * multiple de huit, aucune ne chevauche un angle du pilier : chaque quartier reste un
 * trapèze plan.
 */
export function pushSpiral(
  out: number[],
  spiral: Spiral,
  colours: { tread: Color; riser: Color; under: Color; ceiling: Color },
): void {
  const { centre, inner, outer, steps } = spiral
  const mid = (inner + outer) / 2
  const first = Math.round(spiral.from * steps)
  const last = Math.round((spiral.from + spiral.turns) * steps)

  for (let i = first; i < last; i++) {
    const a0 = stepAngle(spiral, i)
    const a1 = stepAngle(spiral, i + 1)
    const y = stepHeight(spiral, i + 1)
    const below = stepHeight(spiral, i)

    const in0 = onSquare(centre, inner, a0, y)
    const out0 = onSquare(centre, outer, a0, y)
    const in1 = onSquare(centre, inner, a1, y)
    const out1 = onSquare(centre, outer, a1, y)

    // Les coordonnées de texture suivent l'escalier — longueur développée au rayon moyen
    // en abscisse, distance au pilier en ordonnée — pour que le quadrillage tourne avec
    // lui au lieu de glisser dessus.
    const u0 = mid * a0
    const u1 = mid * a1
    const uv = (u: number, v: number): [number, number] => [u, v]

    // Le dessus, normale vers le haut : a → b → c → d avec (b−a) × (d−a) = +Y.
    pushQuad(out, in0, in1, out1, out0, colours.tread, [
      uv(u0, inner), uv(u1, inner), uv(u1, outer), uv(u0, outer),
    ])
    // Le dessous, même quadrilatère pris à l'envers.
    pushQuad(out, in0, out0, out1, in1, colours.under, [
      uv(u0, inner), uv(u0, outer), uv(u1, outer), uv(u1, inner),
    ])

    // La contremarche, à la limite basse du quartier : elle regarde vers la montée. Pas
    // au tout premier quartier : la cloison du bas occupe déjà ce plan, et deux surfaces
    // dans le même plan se disputeraient les pixels.
    if (i > first) {
      pushQuad(out, { ...in0, y: below }, in0, out0, { ...out0, y: below }, colours.riser, [
        uv(inner, below), uv(inner, y), uv(outer, y), uv(outer, below),
      ])
    }

    // **Le plafond est le même ruban, à hauteur d'homme au-dessus et retourné.** C'est ce
    // qui donne au couloir une section constante, donc ce qui empêche le raccord de se
    // trahir par un plafond qui s'éloigne d'un tour.
    const h = spiral.headroom
    const cin0 = { ...in0, y: y + h }
    const cout0 = { ...out0, y: y + h }
    const cin1 = { ...in1, y: y + h }
    const cout1 = { ...out1, y: y + h }
    pushQuad(out, cin0, cout0, cout1, cin1, colours.ceiling, [
      uv(u0, inner), uv(u0, outer), uv(u1, outer), uv(u1, inner),
    ])
    // Et la contremarche du plafond, **dessinée des deux côtés**.
    //
    // Ce n'est pas une négligence de tri de faces mais une nécessité. Celle du sol n'est
    // jamais vue que d'en dessous : par-dessus, le nez de la marche la masque. Celle du
    // plafond, elle, est exposée dans les deux sens — on la voit de face en montant, et de
    // dos en se retournant. Sans son revers, on regardait **entre** les marches du plafond
    // et l'on apercevait le mur au travers : le plafond en gradins semblait fait de dalles
    // flottantes.
    if (i > first) {
      const lowIn = { ...cin0, y: below + h }
      const lowOut = { ...cout0, y: below + h }
      pushQuad(out, lowIn, cin0, cout0, lowOut, colours.ceiling, [
        uv(inner, below), uv(inner, y), uv(outer, y), uv(outer, below),
      ])
      pushQuad(out, lowIn, lowOut, cout0, cin0, colours.ceiling, [
        uv(inner, below), uv(outer, below), uv(outer, y), uv(inner, y),
      ])
    }
  }
}

/** Les faces d'un bloc, nommées par leur position et non par leur normale. */
export type Face = 'north' | 'south' | 'west' | 'east'

/**
 * Un bloc plein, vu **de l'extérieur**.
 *
 * Tout le reste du musée est creux et se regarde du dedans ; celui-ci est le premier
 * volume qu'on contourne. Les normales sortent donc, et le dessous n'est pas dessiné :
 * le bloc est posé sur le sol, et une face qu'on ne peut pas voir est du travail que la
 * carte graphique ferait pour rien.
 *
 * Une face peut être percée d'une ouverture. C'est un vrai trou dans la géométrie, comme
 * dans une paroi de pièce, et pour la même raison : un quad de portail posé par-dessus
 * donnerait un conflit de profondeur.
 */
export function pushBlock(
  out: number[],
  min: Vec3,
  max: Vec3,
  /** Sans `top`, le dessus n'est pas dessiné : c'est le cas d'un bloc qui touche le plafond. */
  colours: { side: Color; top?: Color },
  pierced?: { face: Face; hole: Hole },
): void {
  const dx = max.x - min.x
  const dy = max.y - min.y
  const dz = max.z - min.z

  // Chaque face est donnée dans l'ordre qui met sa normale **dehors** : se tromper la
  // rend simplement invisible, le tri des faces arrière s'en chargeant.
  const faces: { face: Face | 'top'; origin: Vec3; right: Vec3; up: Vec3; color: Color }[] = [
    {
      face: 'north', // z = min.z, normale -Z
      origin: { x: max.x, y: min.y, z: min.z },
      right: { x: -dx, y: 0, z: 0 },
      up: { x: 0, y: dy, z: 0 },
      color: colours.side,
    },
    {
      face: 'south', // z = max.z, normale +Z
      origin: { x: min.x, y: min.y, z: max.z },
      right: { x: dx, y: 0, z: 0 },
      up: { x: 0, y: dy, z: 0 },
      color: colours.side,
    },
    {
      face: 'west', // x = min.x, normale -X
      origin: { x: min.x, y: min.y, z: min.z },
      right: { x: 0, y: 0, z: dz },
      up: { x: 0, y: dy, z: 0 },
      color: colours.side,
    },
    {
      face: 'east', // x = max.x, normale +X
      origin: { x: max.x, y: min.y, z: max.z },
      right: { x: 0, y: 0, z: -dz },
      up: { x: 0, y: dy, z: 0 },
      color: colours.side,
    },
    ...(colours.top
      ? [
          {
            face: 'top' as const, // y = max.y, normale +Y
            origin: { x: min.x, y: max.y, z: max.z },
            right: { x: dx, y: 0, z: 0 },
            up: { x: 0, y: 0, z: -dz },
            color: colours.top,
          },
        ]
      : []),
  ]

  for (const f of faces) {
    pushWall(out, {
      origin: f.origin,
      right: f.right,
      up: f.up,
      color: f.color,
      ...(pierced && pierced.face === f.face ? { holes: [pierced.hole] } : {}),
    })
  }
}

/**
 * Les quatre faces d'un tube vrillé, chacune de sa couleur.
 *
 * Elles doivent être **distinguables**, et ce n'est pas une coquetterie. Une section
 * carrée qui tourne de quatre-vingt-dix degrés se superpose à elle-même : sans couleurs
 * distinctes, le tunnel aurait exactement la même silhouette à ses deux bouts et la
 * vrille serait invisible. C'est en voyant le sol devenir le mur de gauche qu'on
 * comprend ce qui s'est passé.
 */
export interface TubePalette {
  floor: Color
  ceiling: Color
  left: Color
  right: Color
}

/**
 * Le maillage d'un tube à section carrée qui pivote autour de son axe.
 *
 * Les sommets sont posés dans le repère local puis renvoyés dans le monde ; les
 * normales sont prises au repère de leur propre station, ce qui donne un ombrage
 * continu le long de la vrille plutôt que des facettes.
 */
export function buildTwistedTube(
  twist: Twist,
  palette: TubePalette,
  stations = 90,
): F32 {
  const out: number[] = []
  const h = twist.halfSize

  const push = (station: number, u: number, v: number, normal: Vec3, colour: Color): void => {
    const p = toWorld(twist, { s: station, u, v })
    out.push(
      p.x, p.y, p.z,
      normal.x, normal.y, normal.z,
      // Les coordonnées de texture suivent le tube et non le monde : le quadrillage
      // reste régulier alors même que la géométrie se tord.
      station, u + v,
      colour[0], colour[1], colour[2], colour[3] ?? 0,
    )
  }

  for (let i = 0; i < stations; i++) {
    const s0 = (i * twist.length) / stations
    const s1 = ((i + 1) * twist.length) / stations
    const f0 = frameAt(twist, s0)
    const f1 = frameAt(twist, s1)

    // Chaque face est donnée dans l'ordre qui rend sa normale intérieure au tube :
    // avec le tri des faces arrière, se tromper la rend simplement invisible.
    const faces: {
      colour: Color
      corners: [number, number][]
      normals: [Vec3, Vec3]
    }[] = [
      {
        colour: palette.floor,
        corners: [[-h, -h], [-h, -h], [h, -h], [h, -h]],
        normals: [f0.up, f1.up],
      },
      {
        colour: palette.ceiling,
        corners: [[h, h], [h, h], [-h, h], [-h, h]],
        normals: [{ x: -f0.up.x, y: -f0.up.y, z: -f0.up.z }, { x: -f1.up.x, y: -f1.up.y, z: -f1.up.z }],
      },
      {
        colour: palette.left,
        corners: [[-h, h], [-h, h], [-h, -h], [-h, -h]],
        normals: [f0.right, f1.right],
      },
      {
        colour: palette.right,
        corners: [[h, -h], [h, -h], [h, h], [h, h]],
        normals: [
          { x: -f0.right.x, y: -f0.right.y, z: -f0.right.z },
          { x: -f1.right.x, y: -f1.right.y, z: -f1.right.z },
        ],
      },
    ]

    for (const face of faces) {
      const [a, b, c, d] = face.corners
      const [n0, n1] = face.normals
      // Deux triangles : (A, B, C) puis (A, C, D), A et D à la station de départ.
      push(s0, a![0], a![1], n0, face.colour)
      push(s1, b![0], b![1], n1, face.colour)
      push(s1, c![0], c![1], n1, face.colour)

      push(s0, a![0], a![1], n0, face.colour)
      push(s1, c![0], c![1], n1, face.colour)
      push(s0, d![0], d![1], n0, face.colour)
    }
  }

  return new Float32Array(out)
}

/**
 * Un fond de tube : la paroi qui ferme une extrémité, percée de sa porte.
 *
 * `atStart` distingue les deux bouts, dont les repères sont opposés — la normale doit
 * dans les deux cas regarder vers l'intérieur du tube.
 */
export function pushTubeCap(
  out: number[],
  twist: Twist,
  atStart: boolean,
  colour: Color,
  hole?: Hole,
): void {
  const h = twist.halfSize
  const s = atStart ? 0 : twist.length
  const { right, up } = frameAt(twist, s)

  const origin = toWorld(twist, { s, u: atStart ? -h : h, v: -h })
  const rightEdge = scale(right, atStart ? 2 * h : -2 * h)
  const upEdge = scale(up, 2 * h)

  pushWall(out, {
    origin,
    right: rightEdge,
    up: upEdge,
    color: colour,
    ...(hole ? { holes: [hole] } : {}),
  })
}

/** Un cube centré sur l'origine, pour l'objet qu'on lance à travers la couture. */
export function buildCube(size: number, color: Color): F32 {
  const out: number[] = []
  const h = size / 2
  const faces: { o: Vec3; r: Vec3; u: Vec3 }[] = [
    { o: { x: -h, y: -h, z: h }, r: { x: size, y: 0, z: 0 }, u: { x: 0, y: size, z: 0 } },  // +Z
    { o: { x: h, y: -h, z: -h }, r: { x: -size, y: 0, z: 0 }, u: { x: 0, y: size, z: 0 } }, // -Z
    { o: { x: h, y: -h, z: h }, r: { x: 0, y: 0, z: -size }, u: { x: 0, y: size, z: 0 } },  // +X
    { o: { x: -h, y: -h, z: -h }, r: { x: 0, y: 0, z: size }, u: { x: 0, y: size, z: 0 } }, // -X
    { o: { x: -h, y: h, z: h }, r: { x: size, y: 0, z: 0 }, u: { x: 0, y: 0, z: -size } },  // +Y
    { o: { x: -h, y: -h, z: -h }, r: { x: size, y: 0, z: 0 }, u: { x: 0, y: 0, z: size } }, // -Y
  ]
  for (const f of faces) pushWall(out, { origin: f.o, right: f.r, up: f.u, color })
  return new Float32Array(out)
}
