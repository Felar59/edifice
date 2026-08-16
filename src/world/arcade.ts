/**
 * **La borne d'arcade**, et le jeu dedans.
 *
 * Le musée montrait son premier projet sur un écran plat accroché au mur. C'était juste, et
 * c'était froid : un écran au mur, on le regarde ; une borne, on s'y met. La différence n'est
 * pas décorative — elle décide de ce qu'on croit avoir le droit de faire, et le plan est
 * catégorique là-dessus : chaque projet doit être **utilisé**, pas exposé.
 *
 * Le dessin emprunte au jeu qu'elle abrite. De la tôle sombre ; la bande rouge qui court à
 * hauteur d'œil dans ses couloirs ; des tuyaux le long des flancs, avec leurs colliers ; et
 * une enseigne verte de quarantaine, allumée de l'intérieur, où le trèfle biologique tient
 * lieu de logo. Rien de tout cela n'est un ornement gratuit — c'est le décor du jeu qui
 * déborde sur son meuble, de sorte qu'on sache de loin ce qui tourne dedans.
 *
 * ## Le repère
 *
 * Tout est construit dans un repère local : `f` regarde le joueur, `s` va vers sa gauche —
 * c'est le sens dans lequel une image se lit —, et `p(a, b, c)` place un point à `a` sur les
 * côtés, `b` en hauteur, `c` vers l'avant. La borne peut donc être posée dans n'importe
 * quelle direction sans qu'une seule coordonnée change.
 */

import { add, cross, normalize, scale, type Vec3 } from '../math/vec3'
import { pushQuad, type Color } from './geometry'
import { pushBar, pushCylinder } from './props'

const TAU = Math.PI * 2

export interface Arcade {
  /** Le milieu de l'emprise au sol. */
  at: Vec3
  /** Vers où la borne regarde. Horizontal, unitaire. */
  facing: Vec3
  width: number
  depth: number
  height: number
  /** La matière de l'écran : une couche du tableau d'images du musée. */
  screen: Color
  /** La tôle du meuble, et son ombre. */
  metal: Color
  dark: Color
  /** La bande du jeu. */
  red: Color
  /** Le bandeau lumineux, émissif. */
  glow: Color
  /** Le logo du jeu : une couche du tableau d'images, posée sur le bandeau. */
  logo: Color
  /** Les boutons. */
  accent: Color
}

/**
 * Un tuyau entre deux points, dans n'importe quelle direction.
 *
 * `pushCylinder` ne sait se tenir que debout — c'est ce qu'il faut à un fût de colonne ou à
 * un pot de fleurs. Une tuyauterie, elle, court le long des flancs, plonge et remonte : il
 * lui faut un cylindre orienté. On construit donc un repère perpendiculaire à l'axe, en
 * prenant garde au cas où l'axe est justement la verticale — le produit vectoriel s'y annule,
 * et le tuyau disparaîtrait sans rien signaler.
 */
export function pushPipe(
  out: number[],
  from: Vec3,
  to: Vec3,
  radius: number,
  sides: number,
  colour: Color,
): void {
  const axis = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  const length = Math.hypot(axis.x, axis.y, axis.z)
  if (length < 1e-6) return

  const dir = scale(axis, 1 / length)
  const guide: Vec3 = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const u = normalize(cross(dir, guide))
  const v = cross(dir, u)

  const ring = (centre: Vec3): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * TAU
      return add(centre, add(scale(u, Math.cos(a) * radius), scale(v, Math.sin(a) * radius)))
    })

  const start = ring(from)
  const end = ring(to)
  const across = radius * TAU

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    const u0 = (i / sides) * across
    const u1 = ((i + 1) / sides) * across
    pushQuad(out, start[i]!, end[i]!, end[j]!, start[j]!, colour, [
      [u0, 0],
      [u0, length],
      [u1, length],
      [u1, 0],
    ])
  }
}

/** Ce que la borne rend à la salle : où regarder, et où appuyer. */
export interface Screen {
  centre: Vec3
  width: number
  height: number
  /** Le bouton d'alimentation, qu'on vise pour l'allumer ou l'éteindre. */
  bouton: Vec3
}

export function pushArcade(out: number[], spec: Arcade): Screen {
  const { at, width: W, depth: D, height: H } = spec
  const up: Vec3 = { x: 0, y: 1, z: 0 }
  const f = normalize(spec.facing)
  const s = cross(f, up)

  const p = (a: number, b: number, c: number): Vec3 =>
    add(add(add(at, scale(s, a)), scale(up, b)), scale(f, c))

  /** Une boîte alignée sur le repère de la borne, donnée par deux coins locaux. */
  const box = (
    a0: number, b0: number, c0: number,
    a1: number, b1: number, c1: number,
    colour: Color,
  ): void => {
    pushBar(out, p(a0, b0, c0), scale(s, a1 - a0), scale(up, b1 - b0), scale(f, c1 - c0), colour)
  }

  const half = W / 2
  const front = D / 2
  const back = -D / 2
  const wall = 0.09
  /**
   * Où s'arrêtent les pièces intérieures — **dans** l'épaisseur des flancs, et non contre.
   *
   * Le musée refuse deux surfaces dans un même plan : elles s'y disputent les pixels, et le
   * scintillement se voit avant tout le reste. Une pièce qui affleure exactement la face
   * intérieure d'un flanc en crée une à chaque fois. On la fait donc mordre de quatre
   * centimètres : la face disparaît dans la tôle, ce qui est à la fois plus juste — c'est
   * ainsi qu'un meuble est assemblé — et plus sûr.
   */
  const inner = half - 0.045

  // ── Le meuble ───────────────────────────────────────────────────────────────
  // Les deux flancs portent toute la silhouette : c'est d'eux qu'une borne se reconnaît, de
  // loin, avant même qu'on distingue l'écran.
  box(half - wall, 0, back, half, H, front, spec.metal)
  box(-half, 0, back, -half + wall, H, front, spec.metal)
  box(-inner, 0.012, back + 0.012, inner, H - 0.012, back + wall, spec.dark)

  // Le socle, en retrait : une borne ne pose pas sa tôle par terre, elle a un pied de
  // caisse — et ce décrochement est ce qui l'empêche de ressembler à une armoire.
  box(-inner, 0.012, front - 0.55, inner, 0.16, front - 0.08, spec.dark)

  // **L'interrupteur.** Sur la face avant, à hauteur de main, dans son écusson de tôle : la
  // borne s'allume et s'éteint comme une vraie, et ce geste n'est pas un ornement — c'est lui
  // qui arrête le jeu derrière l'écran quand personne ne s'en sert.
  const bouton = p(0.52, 0.44, front - 0.012)
  box(0.42, 0.34, front - 0.05, 0.62, 0.54, front - 0.014, spec.dark)
  // Et la face avant s'arrête **un centimètre en deçà** des flancs, qui restent donc en
  // saillie — comme sur tout meuble en panneaux, et parce que deux faces avant dans le même
  // plan se disputeraient les pixels sur toute la largeur des joues.
  box(-inner, 0.16, front - 0.08, inner, 0.94, front - 0.012, spec.metal)

  // ── La tablette de commande ────────────────────────────────────────────────
  {
    const lip = 0.94
    const rear = 1.12
    const reach = 0.44

    pushBar(
      out,
      p(inner, lip, front - 0.012),
      scale(s, -2 * inner),
      add(scale(up, rear - lip), scale(f, -reach)),
      scale(f, -0.07),
      spec.dark,
    )

    // Le manche et trois boutons. Ce sont eux qui disent « on joue », avant l'écran : une
    // tablette nue serait un pupitre, et l'on n'y toucherait pas.
    const deck = (a: number, t: number): Vec3 => p(a, lip + (rear - lip) * t, front - reach * t)
    const stick = deck(0.32, 0.55)
    pushCylinder(out, stick, 0.058, 0.048, 0.02, 10, spec.dark, spec.dark)
    pushCylinder(out, add(stick, { x: 0, y: 0.02, z: 0 }), 0.017, 0.015, 0.13, 8, spec.dark)
    pushCylinder(out, add(stick, { x: 0, y: 0.15, z: 0 }), 0.046, 0.032, 0.055, 10, spec.red, spec.red)

    for (let i = 0; i < 3; i++) {
      const seat = deck(-0.1 - i * 0.15, 0.58 - i * 0.05)
      pushCylinder(out, seat, 0.04, 0.038, 0.012, 10, spec.dark, spec.dark)
      pushCylinder(out, add(seat, { x: 0, y: 0.012, z: 0 }), 0.033, 0.033, 0.02, 10, spec.accent, spec.accent)
    }
  }

  // ── L'écran, dans son cadre penché ─────────────────────────────────────────
  //
  // Le plan penche en arrière. Ce n'est pas un détail de style : une dalle verticale posée
  // à cette hauteur se regarde par en dessous, et l'image y fuit. Toutes les bornes l'ont
  // fait, pour la même raison.
  const base = 1.18
  const top = 2.02
  const lean = 0.2
  const climb = normalize({ x: 0, y: top - base, z: 0 })
  const along = normalize(add(scale(up, top - base), scale(f, -lean)))
  const rise = Math.hypot(top - base, lean)
  const normal = normalize(cross(along, s))
  void climb

  const opening = W - 2 * wall - 0.28
  const high = (opening * 9) / 16
  const t0 = 0.07
  const t1 = t0 + high

  /** Un point du plan de l'écran : `a` sur les côtés, `t` le long de la pente, `o` en avant. */
  const plane = (a: number, t: number, o: number): Vec3 =>
    add(
      add(p(a, base, front - 0.34), scale(along, t)),
      scale(normal, o),
    )

  {
    // Le cadre : quatre traverses autour du vide, dans le plan penché.
    const frame = (a0: number, t0_: number, a1: number, t1_: number): void => {
      pushBar(
        out,
        plane(a0, t0_, 0),
        scale(s, a1 - a0),
        scale(along, t1_ - t0_),
        scale(normal, 0.05),
        spec.dark,
      )
    }
    const edge = inner
    frame(edge, 0, -edge, t0)
    frame(edge, t1, -edge, rise)
    frame(edge, t0, opening / 2, t1)
    frame(-opening / 2, t0, -edge, t1)

    // ── La dalle ────────────────────────────────────────────────────────────
    // L'ordre des coins reprend celui des tableaux du musée : le premier est en bas, du
    // côté gauche du joueur, et l'image se lit dans le bon sens.
    pushQuad(
      out,
      plane(opening / 2, t0, 0.012),
      plane(-opening / 2, t0, 0.012),
      plane(-opening / 2, t1, 0.012),
      plane(opening / 2, t1, 0.012),
      spec.screen,
      [[0, 1], [1, 1], [1, 0], [0, 0]],
    )
  }

  // La visière. Elle avance au-dessus de la dalle : c'est elle qui la rend lisible sous une
  // lumière de plafond, et c'est elle qui donne à la borne son front.
  pushBar(
    out,
    p(inner, top + 0.02, front - 0.34 - lean),
    scale(s, -2 * inner),
    scale(up, 0.09),
    scale(f, 0.36),
    spec.metal,
  )

  // ── Le bandeau lumineux ────────────────────────────────────────────────────
  // Une borne s'annonce par sa lumière avant tout le reste : c'est elle qu'on voit de
  // l'autre bout de la salle, et elle porte la couleur du jeu — l'ambre de son panneau
  // d'armes. Le logo, lui, est au-dessus, sur le mur : une enseigne se lit de plus loin
  // qu'un fronton.
  {
    const y0 = 2.18
    const y1 = H - 0.12
    box(-inner, y0, front - 0.07, inner, y1, front - 0.03, spec.glow)
    // Les deux corniches débordent des joues de deux centimètres : une corniche affleurante
    // partagerait leur plan, et deux surfaces confondues scintillent.
    box(-half - 0.02, y0 - 0.08, front - 0.12, half + 0.02, y0, front + 0.03, spec.dark)
    box(-half - 0.02, y1, front - 0.12, half + 0.02, y1 + 0.08, front + 0.03, spec.dark)

    // **Le logo, au milieu de la lumière.** C'est la place qu'il a sur toutes les bornes, et
    // c'est ce qui fait la différence entre un meuble éclairé et une machine qui s'annonce.
    //
    // La plaque garde le format des tableaux du musée — seize neuvièmes — et non celui du
    // bandeau : l'image y est dessinée avec ses marges, et une plaque à la largeur du
    // fronton étirerait le casque du simple au triple. Elle est donc aussi haute que la
    // lumière et large de ce qu'il faut, ce qui la centre naturellement.
    const high_ = y1 - y0 - 0.06
    const wide_ = (high_ * 16) / 9
    // Six millimètres **devant** la plaque lumineuse : la profondeur croît vers le joueur,
    // et un logo posé derrière la face du bandeau ne se voit pas du tout.
    const face = front - 0.024
    pushQuad(
      out,
      p(wide_ / 2, y0 + 0.03, face),
      p(-wide_ / 2, y0 + 0.03, face),
      p(-wide_ / 2, y1 - 0.03, face),
      p(wide_ / 2, y1 - 0.03, face),
      spec.logo,
      [[0, 1], [1, 1], [1, 0], [0, 0]],
    )
  }
  // ── La bande rouge ─────────────────────────────────────────────────────────
  // Celle qui court dans les couloirs du jeu, à hauteur d'œil. Elle ne sert qu'à une chose,
  // et c'est la bonne : lier le meuble à ce qu'il montre.
  box(half - 0.03, 1.34, back + 0.03, half + 0.007, 1.46, front - 0.03, spec.red)
  box(-half - 0.007, 1.34, back + 0.03, -half + 0.03, 1.46, front - 0.03, spec.red)
  box(-inner + 0.03, 0.62, front - 0.03, inner - 0.03, 0.74, front + 0.012, spec.red)

  // ── La tuyauterie ──────────────────────────────────────────────────────────
  // Deux descentes le long des flancs, leurs colliers, et une traverse par-dessus.
  for (const side of [-1, 1]) {
    const a = side * (half + 0.07)
    pushPipe(out, p(a, 0.08, back + 0.24), p(a, H - 0.28, back + 0.24), 0.045, 8, spec.dark)
    for (const y of [0.55, 1.4, 2.15]) {
      pushPipe(out, p(a, y, back + 0.15), p(a, y, back + 0.33), 0.063, 8, spec.metal)
    }
  }
  pushPipe(
    out,
    p(-half - 0.07, H - 0.28, back + 0.24),
    p(half + 0.07, H - 0.28, back + 0.24),
    0.045,
    8,
    spec.dark,
  )

  // Le bouton lui-même : une pastille en relief, cerclée de tôle. On le pose en dernier
  // pour qu'il passe devant son écusson.
  pushCylinder(out, add(bouton, scale(f, -0.005)), 0.052, 0.05, 0.006, 12, spec.dark, spec.dark)
  {
    const face = add(bouton, scale(f, 0.014))
    const rim = Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * TAU
      return add(face, add(scale(s, Math.cos(angle) * 0.042), scale(up, Math.sin(angle) * 0.042)))
    })
    for (let i = 0; i < 14; i++) {
      const j = (i + 1) % 14
      pushQuad(out, face, rim[j]!, rim[i]!, rim[i]!, spec.accent, [[0, 0], [1, 0], [1, 1], [1, 1]])
    }
  }

  return {
    centre: plane(0, (t0 + t1) / 2, 0.012),
    width: opening,
    height: high,
    bouton,
  }
}
