/**
 * Les invariants d'une couture, vérifiés par le calcul.
 *
 * Les captures d'écran attrapent ce qui se voit. Ce fichier attrape ce qui ne se
 * voit pas encore : une transformation qui n'est plus tout à fait rigide, un
 * aller-retour qui ne revient pas exactement au point de départ, une bouche dont
 * le repère s'est retourné. Ce sont ces erreurs-là qui produisent, deux semaines
 * plus tard, un scintillement d'un pixel que personne n'arrive à expliquer.
 *
 * Tout est exécutable depuis la console (`__edifice.selfTest()`) et depuis le
 * script de test, ce qui en fait aussi la base du « mode coulisses » prévu plus
 * tard.
 */

import { create, invertRigid, multiply, transformDir, transformPoint, type Mat4 } from '../math/mat4'
import { add, cross, dot, len, normalize, scale, sub, v3, type Vec3 } from '../math/vec3'
import { Player } from '../player/player'
import type { Physics } from '../player/physique'
import { CUBE_SIZE, Projectiles } from '../player/projectiles'
import { cameraToWorld } from '../render/camera'
import { FLOATS_PER_VERTEX } from '../world/geometry'
import { MAX_LIGHTS } from '../world/light'
import { advance, resolveAgainstCell } from '../world/motion'
import { heightAtTurn, onSquare, rampHeight, stepHeight } from '../world/spiral'
import { angleAt, frameAt, toLocal } from '../world/twist'
import type { Mouth } from '../world/types'
import { getLandmarks, HUB } from '../world/world'
import type { World } from '../world/types'

export interface Check {
  name: string
  ok: boolean
  detail: string
}

const EPS = 1e-5

/** Un corps de sonde, aux mesures du visiteur. */
const PROBE_BODY = { radius: 0.35, eyeHeight: 1.65, headroom: 0.15, up: v3(0, 1, 0) }

/** Et un corps de cube lancé, qui n'a ni tête ni pieds : son repère est en son centre. */
const CUBE_BODY = {
  radius: CUBE_SIZE / 2,
  eyeHeight: CUBE_SIZE / 2,
  headroom: CUBE_SIZE / 2,
  up: v3(0, 1, 0),
}

function fmt(n: number): string {
  return n.toExponential(1)
}

/** Écart maximal entre m et l'identité. */
function identityError(m: Mat4): number {
  let worst = 0
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      const expected = c === r ? 1 : 0
      worst = Math.max(worst, Math.abs(m[c * 4 + r]! - expected))
    }
  }
  return worst
}

function distance(a: Vec3, b: Vec3): number {
  return len(sub(a, b))
}

export function runSelfTest(world: World, physics: Physics): Check[] {
  const checks: Check[] = []
  const add_ = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail })
  }

  for (const cell of world.cells.values()) {
    for (const passage of cell.passages) {
      const label = `${passage.from.id} → ${passage.to.id}`
      const t = passage.transform

      // 1. La transformation doit être rigide : sans quoi les distances, donc les
      //    vitesses et les collisions, changent en traversant.
      const rot = create()
      rot.set(t)
      rot[12] = 0; rot[13] = 0; rot[14] = 0
      const rotT = invertRigid(create(), rot)
      const shouldBeIdentity = multiply(create(), rot, rotT)
      const rigidErr = identityError(shouldBeIdentity)
      add_(`${label} · transformation rigide`, rigidErr < EPS, `écart ${fmt(rigidErr)}`)

      // 2. Repère direct : un déterminant négatif produirait une image en miroir,
      //    ce qui passe presque inaperçu sur une pièce symétrique et saute aux
      //    yeux dès qu'il y a une inscription au mur.
      const cx = { x: t[0]!, y: t[1]!, z: t[2]! }
      const cy = { x: t[4]!, y: t[5]!, z: t[6]! }
      const cz = { x: t[8]!, y: t[9]!, z: t[10]! }
      const det = dot(cross(cx, cy), cz)
      add_(`${label} · orientation conservée`, Math.abs(det - 1) < EPS, `déterminant ${det.toFixed(6)}`)

      // 3. Le centre de la bouche d'entrée doit tomber sur le centre de la bouche
      //    de sortie, et la normale doit s'inverser : on sort, on n'entre pas.
      const centerErr = distance(transformPoint(t, passage.from.center), passage.to.center)
      add_(`${label} · les bouches coïncident`, centerErr < EPS, `écart ${fmt(centerErr)} m`)

      const normalErr = distance(transformDir(t, passage.from.normal), scale(passage.to.normal, -1))
      add_(`${label} · normale retournée`, normalErr < EPS, `écart ${fmt(normalErr)}`)

      const upErr = distance(transformDir(t, passage.from.up), passage.to.up)
      add_(`${label} · verticale conservée`, upErr < EPS, `écart ${fmt(upErr)}`)

      // 4. Aller-retour : la couture jumelle doit défaire exactement ce que
      //    celle-ci fait. Sinon, faire un pas en avant puis un pas en arrière
      //    déplace le visiteur — l'erreur la plus insidieuse de toutes, parce
      //    qu'elle s'accumule sans jamais être visible sur une seule traversée.
      const back = world.cells
        .get(passage.to.cell)
        ?.passages.find((p) => p.to.cell === passage.from.cell && p.from === passage.to)
      if (passage.oneWay) {
        // **Un aller sans retour doit être déclaré, jamais découvert.** L'escalier de
        // Penrose en a un, et c'est ce qui le rend impossible : on le monte indéfiniment,
        // on ne le descend pas indéfiniment. Ailleurs, une jumelle manquante est un oubli.
        add_(`${label} · aller sans retour, et déclaré tel`, back === undefined, back ? 'une jumelle existe pourtant' : 'sans jumelle, comme annoncé')
      } else if (!back) {
        add_(`${label} · couture jumelle`, false, 'introuvable')
      } else {
        const round = multiply(create(), back.transform, t)
        const err = identityError(round)
        add_(`${label} · aller-retour neutre`, err < EPS, `écart ${fmt(err)}`)
      }
    }
  }

  // 5. Le même aller-retour, mais en marchant réellement : cette fois on teste le
  //    code de déplacement (sous-pas, décalage au-delà du plan, report du reste
  //    du mouvement) et non plus seulement les matrices.
  const hall = world.cells.get(HUB)
  if (hall) {
    const mouth = hall.passages[0]!.from
    // À hauteur d'œil, pas à hauteur de bouche : depuis que le corps a des pieds, une
    // position au centre de la porte serait à cinquante centimètres sous le sol, et la
    // collision la remonterait — ce qui fausserait l'aller-retour.
    const start = {
      ...add(mouth.center, scale(mouth.normal, 1.5)),
      y: hall.min.y + PROBE_BODY.eyeHeight,
    }
    const forward = scale(mouth.normal, -1)

    const carried = [{ ...forward }]
    const out = advance(world, HUB, start, scale(forward, 3), carried, (cell, p) =>
      resolveAgainstCell(cell, p, PROBE_BODY).pos,
    )
    add_('marche · la couture est bien franchie', out.crossings === 1, `${out.crossings} traversée(s)`)

    const backCarried = [{ ...carried[0]! }]
    const home = advance(world, out.cell, out.pos, scale(carried[0]!, -3), backCarried, (cell, p) =>
      resolveAgainstCell(cell, p, PROBE_BODY).pos,
    )
    const err = distance(home.pos, start)
    add_(
      'marche · aller-retour revient au départ',
      home.cell === HUB && err < 1e-3,
      `cellule ${home.cell}, écart ${fmt(err)} m`,
    )

    // 6. Marcher longtemps dans le couloir infini. C'est le cas réel — un visiteur
    //    peut l'arpenter pendant des minutes — et c'est là que l'erreur d'arrondi
    //    s'accumulerait.
    //
    //    Ce qu'on vérifie n'est pas un nombre de traversées : avec des pièces de
    //    10 et 16 mètres, quatre cents mètres de marche en donnent une trentaine,
    //    et pas davantage. Ce qu'on vérifie, ce sont les trois propriétés qui
    //    doivent tenir indéfiniment : le couloir ne se referme jamais, la
    //    direction du regard reste unitaire, et le corps reste dans sa cellule.
    let cell = HUB
    let pos = { ...start }
    const dir = [{ ...forward }]
    let total = 0
    let worstDrift = 0
    let escaped: string | null = null

    for (let i = 0; i < 400; i++) {
      const step = advance(world, cell, pos, scale(dir[0]!, 4), dir, (c, p) =>
        resolveAgainstCell(c, p, PROBE_BODY).pos,
      )
      cell = step.cell
      pos = step.pos
      total += step.crossings
      worstDrift = Math.max(worstDrift, Math.abs(len(dir[0]!) - 1))

      const c = world.cells.get(cell)!
      const margin = 1.3 // l'embrasure autorise un léger débord, pas davantage
      if (
        pos.x < c.min.x - margin || pos.x > c.max.x + margin ||
        pos.z < c.min.z - margin || pos.z > c.max.z + margin
      ) {
        escaped ??= `sorti de ${cell} au pas ${i} (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`
      }
    }

    add_(
      'marche · le couloir ne se referme jamais',
      total > 20,
      `${total} traversées sur 1600 m · arrêté dans ${cell} en ` +
        `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})` +
        ` · direction (${dir[0]!.x.toFixed(3)}, ${dir[0]!.y.toFixed(3)}, ${dir[0]!.z.toFixed(3)})`,
    )
    add_(
      'marche · le regard ne dérive pas',
      worstDrift < 1e-5,
      `écart maximal à la norme ${fmt(worstDrift)}`,
    )
    add_('marche · jamais hors de la cellule', escaped === null, escaped ?? 'toujours dedans')
  }

  // 7. Le repère de la caméra doit rester orthonormé à toutes les inclinaisons.
  //
  //    C'est l'invariant qui manquait, et son absence a laissé passer le défaut le
  //    plus visible du prototype. Aucune statistique d'image ne pouvait l'attraper :
  //    une vue cisaillée a exactement autant de relief qu'une vue correcte, et tous
  //    les compteurs du moteur restaient justes.
  //
  //    L'enjeu est que `invertRigid` n'est valable que sur une base orthonormée.
  //    Lui donner un repère oblique ne provoque aucune erreur : ça renvoie
  //    simplement une matrice de vue fausse, en silence.
  {
    const gravityUp = v3(0, 1, 0)
    let worstOrtho = 0
    let worstNorm = 0
    let worstDet = 0

    for (let deg = -80; deg <= 80; deg += 5) {
      const a = (deg * Math.PI) / 180
      const forward = v3(0, Math.sin(a), -Math.cos(a))
      const m = cameraToWorld({ cell: 'hall', pos: v3(1, 2, 3), forward, up: gravityUp })

      const cx = v3(m[0]!, m[1]!, m[2]!)
      const cy = v3(m[4]!, m[5]!, m[6]!)
      const cz = v3(m[8]!, m[9]!, m[10]!)

      worstOrtho = Math.max(worstOrtho, Math.abs(dot(cx, cy)), Math.abs(dot(cy, cz)), Math.abs(dot(cx, cz)))
      worstNorm = Math.max(worstNorm, Math.abs(len(cx) - 1), Math.abs(len(cy) - 1), Math.abs(len(cz) - 1))
      worstDet = Math.max(worstDet, Math.abs(dot(cross(cx, cy), cz) - 1))

      // Et la propriété qui compte vraiment : l'inverse doit être un inverse.
      const shouldBeIdentity = multiply(create(), invertRigid(create(), m), m)
      worstOrtho = Math.max(worstOrtho, identityError(shouldBeIdentity))
    }

    add_('caméra · axes orthogonaux à tout tangage', worstOrtho < EPS, `écart ${fmt(worstOrtho)}`)
    add_('caméra · axes unitaires', worstNorm < EPS, `écart ${fmt(worstNorm)}`)
    add_('caméra · repère direct', worstDet < EPS, `écart ${fmt(worstDet)}`)
  }

  // 8. Le tangage doit survivre au placement et à la traversée.
  //
  //    Le défaut était brutal — le regard se redressait à l'horizontale chaque fois
  //    qu'on franchissait une porte — et il venait d'un excès de zèle : une routine
  //    censée corriger la dérive d'arrondi projetait aussi le regard
  //    perpendiculairement à la verticale, écrasant l'inclinaison.
  //
  //    On mesure le cosinus de l'angle entre le regard et la verticale locale : il
  //    doit être exactement le même avant et après.
  {
    const pitched = normalize(v3(0, -0.5, -0.866))
    const player = new Player()
    const marks0 = getLandmarks()
    player.goTo({
      name: 'contrôle',
      cell: marks0.hub,
      pos: add(marks0.seamCenter, scale(marks0.seamNormal, 3)),
      forward: pitched,
    })

    const placed = dot(player.forward, player.up)
    add_(
      'visiteur · le placement conserve le tangage',
      Math.abs(placed - dot(pitched, v3(0, 1, 0))) < 1e-6,
      `cosinus ${placed.toFixed(6)} au lieu de ${pitched.y.toFixed(6)}`,
    )

    const keys = new Set(['KeyW'])
    for (let i = 0; i < 120 && player.crossings === 0; i++) player.update(1 / 60, world, keys)
    const crossed = dot(player.forward, player.up)
    add_(
      'visiteur · la traversée conserve le tangage',
      player.crossings > 0 && Math.abs(crossed - placed) < 1e-4,
      `${player.crossings} traversée(s), cosinus ${crossed.toFixed(6)} au lieu de ${placed.toFixed(6)}`,
    )
  }

  // 9. La verticalité : on tombe, on atterrit, on saute, et on se cogne au linteau.
  //
  //    Quatre propriétés, dont la dernière est la seule vraiment subtile.
  //
  //    Le corps a cessé d'être un point le jour où il a pu monter : c'est le crâne qui
  //    heurte le linteau et ce sont les pieds qui touchent le sol. Sans cette hauteur,
  //    on entrerait dans une porte en pleine détente, la tête dans le mur — et la
  //    traversée réussirait, puisque le test de franchissement ne regarde que l'œil.
  {
    const marks = getLandmarks()
    const floorOf = (id: string): number => world.cells.get(id)!.min.y
    const EYE = 1.65
    const HEAD = 0.15

    // --- On tombe, et on s'arrête au sol ------------------------------------
    const faller = new Player()
    faller.goTo({
      name: 'chute',
      cell: marks.hub,
      pos: add(marks.hubCenter, v3(0, 3, 0)),
      forward: v3(0, 0, -1),
    })
    let frames = 0
    while (!faller.grounded && frames < 600) {
      faller.update(1 / 120, world, new Set())
      frames++
    }
    const restY = faller.pos.y
    add_(
      'verticalité · la chute s’arrête au sol',
      faller.grounded && Math.abs(restY - (floorOf(marks.hub) + EYE)) < 1e-6,
      `œil à ${restY.toFixed(4)} m après ${frames} images, attendu ${(floorOf(marks.hub) + EYE).toFixed(4)}`,
    )
    add_(
      'verticalité · la vitesse retombe à zéro',
      Math.abs(faller.vertical) < 1e-9,
      `vitesse ${faller.vertical.toExponential(1)}`,
    )

    // --- Le saut culmine, puis retombe --------------------------------------
    const jumper = new Player()
    jumper.goTo({
      name: 'saut',
      cell: marks.hub,
      pos: marks.hubCenter,
      forward: v3(0, 0, -1),
    })
    jumper.update(1 / 120, world, new Set()) // une image pour toucher le sol
    const ground = jumper.pos.y

    let apex = ground
    let airborne = 0
    jumper.update(1 / 120, world, new Set(['Space']))
    while (!jumper.grounded && airborne < 600) {
      jumper.update(1 / 120, world, new Set())
      apex = Math.max(apex, jumper.pos.y)
      airborne++
    }
    const height = apex - ground
    add_(
      'verticalité · le saut culmine puis retombe',
      jumper.grounded && height > 0.35 && height < 0.85,
      `${height.toFixed(3)} m d’élévation en ${airborne} images`,
    )

    // --- On ne traverse pas le sol, même en tombant vite --------------------
    const diver = new Player()
    diver.goTo({
      name: 'plongeon',
      cell: marks.hub,
      pos: add(marks.hubCenter, v3(0, 2, 0)),
      forward: v3(0, 0, -1),
    })
    diver.vertical = -28
    // Un pas de temps volontairement énorme : c'est celui que la boucle de rendu borne,
    // et donc le pire cas réel.
    for (let i = 0; i < 6; i++) diver.update(1 / 20, world, new Set())
    add_(
      'verticalité · le sol ne se traverse pas à pleine vitesse',
      diver.pos.y >= floorOf(marks.hub) + EYE - 1e-6,
      `œil à ${diver.pos.y.toFixed(4)} m, plancher à ${(floorOf(marks.hub) + EYE).toFixed(4)}`,
    )

    // --- Le linteau arrête celui qui saute ---------------------------------
    //
    //    On place le corps en l'air, crâne au-dessus du linteau, juste devant la porte,
    //    et on pousse fort. La paroi doit tenir.
    const bumper = new Player()
    const lintel = marks.seamCenter.y + 1.1
    bumper.goTo({
      name: 'linteau',
      cell: marks.hub,
      pos: add(marks.seamCenter, scale(marks.seamNormal, 0.6)),
      forward: { x: -marks.seamNormal.x, y: 0, z: -marks.seamNormal.z },
    })
    bumper.pos = { ...bumper.pos, y: lintel - HEAD + 0.12 }
    bumper.walk(world, 1.5)
    const stillBefore =
      (bumper.pos.x - marks.seamCenter.x) * marks.seamNormal.x +
      (bumper.pos.z - marks.seamCenter.z) * marks.seamNormal.z
    add_(
      'verticalité · le linteau arrête celui qui saute trop haut',
      bumper.crossings === 0 && stillBefore > 0,
      `${bumper.crossings} traversée(s), marge ${stillBefore.toFixed(3)} m`,
    )

    // --- Mais franchir en retombant doit marcher ---------------------------
    const stooper = new Player()
    stooper.goTo({
      name: 'retombée',
      cell: marks.hub,
      pos: add(marks.seamCenter, scale(marks.seamNormal, 0.6)),
      forward: { x: -marks.seamNormal.x, y: 0, z: -marks.seamNormal.z },
    })
    stooper.walk(world, 1.5)
    add_(
      'verticalité · on franchit debout, comme avant',
      stooper.crossings > 0,
      `${stooper.crossings} traversée(s) vers ${stooper.cell}`,
    )
  }

  // 9. L'orientation d'un objet lancé doit traverser la couture avec lui.
  //
  //    Ce qui est vérifié n'est **pas** la continuité de l'orientation dans le repère
  //    du monde : celle-là doit sauter en franchissant une couture, puisque le repère
  //    change. C'est l'angle entre les axes de l'objet et sa propre vitesse qui doit
  //    rester continu — une transformation rigide agit identiquement sur les deux,
  //    donc leur angle relatif ne peut pas bouger d'un coup.
  //
  //    Le défaut d'origine ne transportait que la vitesse : la rotation de l'objet
  //    ignorait le changement de repère, et cet angle relatif sautait brusquement.
  {
    const thrower = new Player()
    const marks = getLandmarks()
    thrower.goTo({
      name: 'contrôle',
      cell: marks.hub,
      pos: add(marks.seamCenter, scale(marks.seamNormal, 2.2)),
      forward: { x: -marks.seamNormal.x, y: 0, z: -marks.seamNormal.z },
    })
    const cubes = new Projectiles(physics)
    cubes.throwFrom(thrower, world)

    const step = 1 / 120
    let crossed = false
    let worstOrtho = 0
    let worstDet = 0
    let worstJump = 0
    let previous: number | null = null
    let seams = 0
    let where = HUB

    for (let i = 0; i < 300; i++) {
      cubes.update(step, world)
      const cube = cubes.inspect()[0]
      if (!cube) break
      if (cube.cell !== HUB) crossed = true

      worstOrtho = Math.max(
        worstOrtho,
        Math.abs(dot(cube.ex, cube.ey)),
        Math.abs(dot(cube.ey, cube.ez)),
        Math.abs(dot(cube.ex, cube.ez)),
      )
      worstDet = Math.max(worstDet, Math.abs(dot(cross(cube.ex, cube.ey), cube.ez) - 1))

      // **La mesure se fait au franchissement, et là seulement.**
      //
      // Ce qu'on veut interdire est une discontinuité de l'orientation **à la traversée** :
      // le cube doit ressortir tourné comme la couture le demande, ni plus ni moins. Mesurer
      // image par image n'a plus de sens depuis que les cubes sont des solides — un choc
      // change d'un coup la direction de leur vitesse, et l'angle qu'elle fait avec leurs
      // axes avec elle, ce qui est parfaitement légitime.
      //
      // On compare donc l'angle entre l'axe du cube et sa trajectoire de part et d'autre de
      // la couture. Entre ces deux images il ne se passe qu'un tour de rotation propre et un
      // pas de gravité : l'écart doit rester petit.
      const speed = len(cube.vel)
      if (speed < 0.5) break
      const relative = dot(cube.ex, scale(cube.vel, 1 / speed))
      if (cube.cell !== where && previous !== null) {
        worstJump = Math.max(worstJump, Math.abs(relative - previous))
        seams++
      }
      where = cube.cell
      previous = relative
    }

    add_('objet lancé · franchit bien la couture', crossed, crossed ? 'oui' : 'jamais sorti de la rotonde')
    add_('objet lancé · base orthogonale', worstOrtho < 1e-4, `écart ${fmt(worstOrtho)}`)
    add_('objet lancé · base directe', worstDet < 1e-4, `écart ${fmt(worstDet)}`)
    add_(
      'objet lancé · orientation transportée',
      seams > 0 && worstJump < 0.05,
      `${seams} traversée(s), écart maximal ${worstJump.toFixed(4)} de part et d’autre`,
    )
  }

  // 10. Le tunnel-vrille.
  //
  //    Quatre propriétés, et la deuxième est la seule qui demande de la réflexion.
  //
  //    **La vrille est complète.** D'un bout à l'autre, la verticale locale doit avoir
  //    tourné de l'angle annoncé — un quart de tour. C'est ce qui fait que le sol de
  //    l'entrée devient exactement le mur de gauche.
  //
  //    **Le regard ne dérive pas.** L'angle entre le regard et la verticale locale doit
  //    rester constant sur toute la longueur. Si seule la verticale tournait, cet angle
  //    changerait au fil de la marche : on avancerait tout droit et l'image piquerait
  //    lentement du nez. C'est pourquoi le regard est transporté lui aussi.
  //
  //    **Pas de dérive latérale.** Marcher droit dans le couloir doit garder sa place
  //    dans la section. Un pas exprimé en coordonnées du monde plutôt que locales dérive
  //    de vingt-cinq centimètres par passage : on finit plaqué contre une paroi, hors
  //    d'atteinte de la porte, et le couloir infini se referme.
  //
  //    **On ressort debout.** La couture de sortie absorbe la vrille accumulée, puisque
  //    c'est une transformation rigide et qu'elle emporte le repère entier.
  {
    const tube = world.cells.get('vrille')
    if (!tube?.twist) {
      add_('vrille · le tube existe', false, 'l’aile vrille n’a pas de vrille')
    } else {
      const twist = tube.twist
      const marks = getLandmarks()
      const walker = new Player()
      walker.goTo(
        {
          name: 'vrille',
          cell: marks.hub,
          pos: add(marks.seamCenter, scale(marks.seamNormal, 0.5)),
          forward: { x: -marks.seamNormal.x, y: 0, z: -marks.seamNormal.z },
        },
        world,
      )

      let guard = 0
      while (walker.cell !== 'vrille' && guard++ < 40) walker.walk(world, 0.2)

      const entry = toLocal(twist, walker.pos)
      const upAtEntry = { ...walker.up }

      // Le regard est incliné **de biais** avant de mesurer, et ce n'est pas un détail :
      // en visant exactement l'axe, l'angle avec la verticale reste nul quoi qu'il
      // arrive, puisque la verticale tourne autour de cet axe. L'invariant serait vide,
      // et il l'a été — il laissait passer un transport qui oubliait le regard.
      const atEntry = frameAt(twist, entry.s)
      walker.face(
        normalize(add(scale(twist.axis, 0.9), scale(atEntry.up, -0.4))),
      )
      const tiltAtEntry = dot(walker.forward, walker.up)

      // L'amorce doit être franchement droite : c'est elle qui fait l'effet. Depuis le
      // seuil, le couloir se présente comme un couloir, et la vrille arrive de nulle
      // part. Répartie sur toute la longueur, elle se verrait dès l'entrée.
      add_(
        'vrille · une amorce droite existe',
        twist.straight >= 2 && angleAt(twist, twist.straight) === 0,
        `${twist.straight.toFixed(1)} m sans rotation, puis` +
          ` ${((twist.turn * 180) / Math.PI).toFixed(0)}° sur les ${(twist.length - twist.straight).toFixed(1)} m suivants`,
      )

      let worstTilt = 0
      guard = 0
      while (walker.cell === 'vrille' && toLocal(twist, walker.pos).s < twist.length - 0.4 && guard++ < 400) {
        walker.walk(world, 0.2)
        if (walker.cell === 'vrille') {
          worstTilt = Math.max(worstTilt, Math.abs(dot(walker.forward, walker.up) - tiltAtEntry))
        }
      }

      const exit = toLocal(twist, walker.pos)
      const turned = Math.acos(Math.max(-1, Math.min(1, dot(upAtEntry, walker.up))))
      // L'angle attendu est lu sur le profil et non recalculé : celui-ci n'est pas
      // linéaire — amorce droite puis montée en fondu — et le supposer tel ferait
      // échouer l'invariant pour une bonne raison de dessin.
      const expected = angleAt(twist, exit.s) - angleAt(twist, entry.s)

      add_(
        'vrille · la verticale tourne de l’angle annoncé',
        Math.abs(turned - expected) < 0.02,
        `${((turned * 180) / Math.PI).toFixed(1)}° sur ${(exit.s - entry.s).toFixed(1)} m,` +
          ` attendu ${((expected * 180) / Math.PI).toFixed(1)}°`,
      )
      add_(
        'vrille · le regard ne dérive pas',
        worstTilt < 2e-3,
        `écart maximal d’inclinaison ${worstTilt.toExponential(1)}`,
      )
      add_(
        'vrille · pas de dérive latérale',
        Math.abs(exit.u - entry.u) < 0.03,
        `${(exit.u - entry.u).toFixed(4)} m de déport sur ${(exit.s - entry.s).toFixed(1)} m`,
      )

      guard = 0
      while (walker.cell === 'vrille' && guard++ < 40) walker.walk(world, 0.2)
      const uprightness = dot(walker.up, v3(0, 1, 0))
      add_(
        'vrille · on ressort debout',
        walker.cell === marks.hub && uprightness > 1 - 1e-6,
        `cellule ${walker.cell}, verticale à ${(Math.acos(Math.min(1, uprightness)) * 180 / Math.PI).toFixed(2)}° de l’aplomb`,
      )
    }
  }

  // 11. Le reliquaire — le premier volume impossible.
  //
  //    Quatre propriétés, et la première est la seule qui soit vraiment nouvelle pour le
  //    moteur.
  //
  //    **Un bloc plein est plein.** Jusqu'ici un corps savait rester dans une boîte ; il
  //    ne savait pas en contourner une. On vérifie donc qu'on ne traverse pas le coffre,
  //    et surtout qu'on n'y reste pas coincé : un point posé en son centre doit ressortir,
  //    et ressortir dehors. C'est le cas dégénéré du contournement, celui qu'une descente
  //    de gravité d'un cheveu peut produire pour de vrai.
  //
  //    **La porte laisse passer.** L'exception d'ouverture existe déjà pour les parois ;
  //    il fallait la même pour les blocs, sans quoi le coffre serait hermétique.
  //
  //    **On ressort dans la salle de départ, ailleurs.** C'est toute l'affaire : une
  //    traversée, la **même cellule** au bout, et une bonne distance entre l'entrée et la
  //    sortie. La couture a ses deux bouches dans la même pièce, ce qui est un cas que le
  //    moteur n'avait jamais rencontré — et qu'il traite sans rien de particulier,
  //    puisqu'il relie des bouches et non des pièces.
  //
  //    **Le contenu ne tient pas dans le contenant.** Le rapport des volumes est l'énoncé
  //    même de la tricherie ; le mesurer évite qu'un jour on rapetisse la salle sans s'en
  //    apercevoir, et que le musée se mette à mentir un peu moins.
  {
    const marks = getLandmarks()
    const room = world.cells.get(marks.chestCell)
    const chest = room?.blocks?.[0]

    if (!room || !chest) {
      add_('reliquaire · le coffre existe', false, 'aucun bloc dans la salle du reliquaire')
    } else {
      const side = chest.max.x - chest.min.x
      const centre = {
        x: (chest.min.x + chest.max.x) / 2,
        y: chest.min.y + PROBE_BODY.eyeHeight,
        z: (chest.min.z + chest.max.z) / 2,
      }

      // Posé au centre du coffre, donc dans la matière : on doit en ressortir.
      const expelled = resolveAgainstCell(room, centre, PROBE_BODY).pos
      const outside =
        expelled.x <= chest.min.x - PROBE_BODY.radius + 1e-6 ||
        expelled.x >= chest.max.x + PROBE_BODY.radius - 1e-6 ||
        expelled.z <= chest.min.z - PROBE_BODY.radius + 1e-6 ||
        expelled.z >= chest.max.z + PROBE_BODY.radius - 1e-6 ||
        expelled.y - PROBE_BODY.eyeHeight >= chest.max.y - 1e-6
      add_(
        'reliquaire · on ne reste pas pris dans le coffre',
        outside,
        `du centre vers (${expelled.x.toFixed(2)}, ${expelled.y.toFixed(2)}, ${expelled.z.toFixed(2)})`,
      )

      // Et on ne le traverse pas : le corps qui pousse contre une face pleine s'arrête à
      // son rayon, quelle que soit la face.
      const pierced = chest.door!.normal
      const blind = { x: -pierced.z, y: 0, z: pierced.x } // une face sans porte
      const against = {
        x: centre.x + blind.x * (side / 2 + 2),
        y: centre.y,
        z: centre.z + blind.z * (side / 2 + 2),
      }
      const walker = new Player()
      walker.goTo({ name: 'coffre', cell: room.id, pos: against, forward: scale(blind, -1) }, world)
      walker.walk(world, 4)
      const gap = Math.max(
        Math.abs(walker.pos.x - centre.x) - side / 2,
        Math.abs(walker.pos.z - centre.z) - side / 2,
      )
      add_(
        'reliquaire · une face pleine arrête',
        walker.cell === room.id && gap >= PROBE_BODY.radius - 1e-3,
        `arrêté à ${gap.toFixed(3)} m de la paroi, rayon ${PROBE_BODY.radius}`,
      )

      // La boucle : on entre par la porte du coffre, et l'on ressort **dans la même
      // salle**, par le mur du fond. C'est là toute l'affaire, et c'est ce qu'on mesure :
      // une traversée, la même cellule au bout, et une bonne distance entre les deux —
      // sans quoi rien ne distinguerait la chose d'une porte qui donne sur elle-même.
      const seamInto = room.passages.find((p) => p.from === chest.door)
      add_(
        'reliquaire · le coffre donne sur sa propre salle',
        seamInto !== undefined && seamInto.to.cell === room.id,
        seamInto ? `vers ${seamInto.to.id}, cellule ${seamInto.to.cell}` : 'couture introuvable',
      )

      const visitor = new Player()
      visitor.goTo(
        { name: 'reliquaire', cell: marks.chestCell, pos: marks.chestPos, forward: marks.chestForward },
        world,
      )
      const start = { ...visitor.pos }

      let guard = 0
      while (visitor.crossings === 0 && guard++ < 60) visitor.walk(world, 0.2)
      add_(
        'reliquaire · la porte du coffre laisse entrer',
        visitor.crossings === 1,
        `${visitor.crossings} traversée(s), cellule ${visitor.cell}`,
      )
      add_(
        'reliquaire · on ressort dans la salle de départ',
        visitor.crossings === 1 && visitor.cell === room.id,
        `cellule ${visitor.cell} après ${visitor.crossings} traversée(s)`,
      )
      add_(
        'reliquaire · on ressort ailleurs qu’on est entré',
        distance(visitor.pos, start) > 6,
        `${distance(visitor.pos, start).toFixed(1)} m entre le seuil du coffre et la sortie`,
      )

      // Le rapport des volumes, qui est l'énoncé de la tricherie. La salle est ici son
      // propre contenu : le coffre contient la pièce où il est posé.
      const volume = (c: { min: Vec3; max: Vec3 }): number =>
        (c.max.x - c.min.x) * (c.max.y - c.min.y) * (c.max.z - c.min.z)
      const ratio = volume(room) / volume(chest)
      add_(
        'reliquaire · le contenu ne tient pas dans le contenant',
        ratio > 30,
        `le coffre contient une salle ${ratio.toFixed(0)} fois plus grande que lui —` +
          ` et c'est la sienne`,
      )

      // Et rien ne rétrécit en passant : les deux bouches ont la même taille, ce qui est
      // la condition pour que la transformation reste rigide. Le jour où l'on voudra une
      // vraie porte minuscule, c'est cet invariant-là qu'il faudra remplacer, pas
      // contourner.
      add_(
        'reliquaire · aucun changement d’échelle',
        seamInto !== undefined &&
          seamInto.from.halfWidth === seamInto.to.halfWidth &&
          seamInto.from.halfHeight === seamInto.to.halfHeight,
        seamInto
          ? `${(seamInto.from.halfWidth * 2).toFixed(2)} × ${(seamInto.from.halfHeight * 2).toFixed(2)} m des deux côtés`
          : 'couture du coffre introuvable',
      )
    }
  }

  // 12. La salle aux six sols.
  //
  //    **La bande d'accroche fait exactement une hauteur d'œil.** C'est l'invariant qui
  //    porte tout le reste : au moment où l'on arrive à cette distance de la face voisine,
  //    on est déjà précisément à la distance où l'on se tiendra debout dessus. Le
  //    basculement n'a donc rien à déplacer. Une bande d'une autre largeur ferait sauter le
  //    corps d'autant, et l'à-coup passerait pour un défaut de rendu.
  //
  //    **Le basculement ne déplace pas le corps.** On le vérifie plutôt que de s'en
  //    remettre au calcul ci-dessus : à l'image où la face change, le pas ne doit pas être
  //    plus long qu'un pas ordinaire.
  //
  //    **Les six faces sont habitables.** Deux traversées de la salle, l'une vers l'est et
  //    l'autre vers le sud, doivent faire visiter les six.
  //
  //    **La salle a une sortie.** Ce contrôle-là est né d'un défaut : la bande d'accroche
  //    faisait grimper le mur juste avant qu'on atteigne la porte, si bien qu'on tournait
  //    indéfiniment autour du cube sans pouvoir en sortir. On ne bascule donc pas devant
  //    une ouverture — on entre.
  //
  //    **On en sort d'aplomb quand on y marche d'aplomb.** Une couture emporte le repère
  //    tel quel : qui traverse debout arrive debout.
  //
  //    **Une arête ne fait pas basculer.** Deux faces abordées exactement de biais ne se
  //    départagent pas ; on choisissait la plus proche, et dans un angle les deux distances
  //    sont égales au bruit près — le vainqueur changeait d'une image à l'autre et la salle
  //    tournait sur place. Rester debout dans un coin est un état stable.
  //
  //    **La porte du sol se franchit, et mène loin.** Qui marche sur la paroi qui porte la
  //    porte a cette porte sous les pieds. Il y tombe, emporte sa gravité, traverse la
  //    rotonde en vol et va s'écraser dans l'aile d'en face, où la verticale du monde
  //    reprend ses droits au premier contact.
  {
    const room = [...world.cells.values()].find((c) => c.gravity)
    if (!room) {
      add_('six sols · la salle existe', false, 'aucune cellule à gravité par face')
    } else {
      const floor = room.min.y
      const middle = {
        x: (room.min.x + room.max.x) / 2,
        y: floor + PROBE_BODY.eyeHeight,
        z: (room.min.z + room.max.z) / 2,
      }

      add_(
        'six sols · la bande d’accroche fait une hauteur d’œil',
        Math.abs(room.gravity!.grip - PROBE_BODY.eyeHeight) < 1e-9,
        `${room.gravity!.grip.toFixed(2)} m contre ${PROBE_BODY.eyeHeight.toFixed(2)} m`,
      )

      /** Une traversée de la salle, tenue en marche avant. Renvoie ce qu'on y observe. */
      const cross = (forward: Vec3, steps: number) => {
        const walker = new Player()
        walker.goTo({ name: 'six sols', cell: room.id, pos: { ...middle }, forward }, world)
        // Le regard est incliné avant de partir : sans inclinaison, l'angle entre le regard
        // et le haut resterait nul quoi qu'il arrive, et l'invariant serait vide.
        walker.look(0, 90)
        const tilt = dot(walker.forward, walker.up)

        const faces = new Set<string>()
        const key = (v: Vec3): string => `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`
        faces.add(key(walker.stance))

        let jump = 0
        let drift = 0
        for (let i = 0; i < steps && walker.cell === room.id; i++) {
          const was = { ...walker.pos }
          const stance = { ...walker.stance }
          walker.update(1 / 60, world, new Set(['KeyW']))
          faces.add(key(walker.stance))
          if (key(stance) !== key(walker.stance)) jump = Math.max(jump, distance(was, walker.pos))
          drift = Math.max(drift, Math.abs(dot(walker.forward, walker.up) - tilt))
        }
        return { faces, jump, drift, walker }
      }

      // Un pas de marche ordinaire à soixante images par seconde, plus la chute d'une
      // image : au-delà, le basculement aurait déplacé le corps.
      const stride = 6.8 / 60 + 18 / 3600 + 1e-3

      const east = cross({ x: 1, y: 0, z: 0 }, 900)
      const south = cross({ x: 0, y: 0, z: 1 }, 900)
      const seen = new Set([...east.faces, ...south.faces])

      add_(
        'six sols · les six faces sont habitables',
        seen.size === 6,
        `${seen.size} face(s) foulée(s) : ${[...seen].join(' · ')}`,
      )
      add_(
        'six sols · le basculement ne déplace pas le corps',
        Math.max(east.jump, south.jump) <= stride,
        `pas maximal ${Math.max(east.jump, south.jump).toFixed(4)} m à l’image du changement,` +
          ` pour ${stride.toFixed(4)} m de marche ordinaire`,
      )
      add_(
        'six sols · le regard ne dérive pas',
        Math.max(east.drift, south.drift) < 2e-3,
        `écart maximal d’inclinaison ${fmt(Math.max(east.drift, south.drift))}`,
      )

      // La sortie. On part du milieu, face à la porte, et l'on doit finir dehors et debout.
      const door = room.passages[0]!.from
      const leaver = new Player()
      leaver.goTo(
        {
          name: 'sortie',
          cell: room.id,
          pos: { ...middle },
          forward: scale(door.normal, -1),
        },
        world,
      )
      for (let i = 0; i < 600 && leaver.cell === room.id; i++) {
        leaver.update(1 / 60, world, new Set(['KeyW']))
      }
      add_(
        'six sols · la salle a une sortie',
        leaver.cell !== room.id,
        leaver.cell === room.id ? 'toujours dedans après dix secondes de marche' : `sorti vers ${leaver.cell}`,
      )
      add_(
        'six sols · on en sort d’aplomb quand on y marche d’aplomb',
        dot(leaver.up, v3(0, 1, 0)) > 1 - 1e-6,
        `verticale à ${(Math.acos(Math.min(1, dot(leaver.up, v3(0, 1, 0)))) * 180 / Math.PI).toFixed(2)}° de l’aplomb`,
      )

      // L'arête. On part du centre et l'on marche exactement dans l'angle : les deux faces
      // sont abordées à quarante-cinq degrés, donc à égalité, et rien ne doit basculer.
      const corner = new Player()
      corner.goTo(
        { name: 'arête', cell: room.id, pos: { ...middle }, forward: normalize(v3(-1, 0, -1)) },
        world,
      )
      let flips = 0
      let previous = { ...corner.stance }
      for (let i = 0; i < 600 && corner.cell === room.id; i++) {
        corner.update(1 / 60, world, new Set(['KeyW']))
        if (distance(previous, corner.stance) > 1e-6) {
          flips++
          previous = { ...corner.stance }
        }
      }
      add_(
        'six sols · une arête ne fait pas basculer',
        flips === 0,
        flips === 0 ? 'debout dans l’angle, dix secondes durant' : `${flips} bascule(s) dans l’angle`,
      )

      // La trappe. On monte sur la paroi qui porte la porte, en abordant loin de celle-ci,
      // puis on longe la paroi jusqu'à l'embrasure — qui est alors un trou dans le sol.
      const sill = room.passages[0]!.from
      const faller = new Player()
      faller.goTo(
        {
          name: 'trappe',
          cell: room.id,
          pos: add(add(sill.center, scale(sill.normal, 5)), scale(sill.right, 3)),
          forward: scale(sill.normal, -1),
        },
        world,
      )
      // La hauteur du départ vaut celle de l'œil ; celle de la porte doit l'englober, sans
      // quoi le trou passerait sous les pieds sans qu'on y tombe.
      let dropped = false
      for (let i = 0; i < 900; i++) {
        // Dès que la paroi devient le sol, on vise l'embrasure en longeant la paroi. Viser
        // plus tôt empêcherait d'y monter ; viser plus tard laisserait le corps dériver.
        if (dot(faller.stance, v3(0, 1, 0)) < 0.9 && !dropped) {
          const toward = sub(sill.center, faller.pos)
          faller.face(scale(sill.right, dot(toward, sill.right)))
        }
        // On lâche la touche dès que les pieds quittent la paroi : une chute n'est pas une
        // marche, et continuer d'avancer en vol ferait dériver la trajectoire hors de la
        // porte d'en face. C'est ce que mesure l'invariant — la chute, pas le pilotage.
        faller.update(1 / 60, world, new Set(faller.grounded ? ['KeyW'] : []))
        if (faller.cell !== room.id) dropped = true
        if (dropped && faller.grounded) break
      }
      // La rotonde n'est qu'un passage : la chute la traverse de part en part et finit dans
      // l'aile qui fait face à celle qu'on vient de quitter.
      add_(
        'six sols · la porte du sol mène à l’aile d’en face',
        dropped && faller.cell !== room.id && faller.cell !== HUB,
        dropped ? `tombé jusqu’à ${faller.cell}` : 'jamais sorti par le trou',
      )
      // **La chute garde sa gravité.** L'aile où l'on tombe est faite pour ça : on y atterrit
      // sur le mur du fond, debout dessus, et non relevé d'office. C'est cette gravité-là qui
      // met la trémie du plafond à hauteur de marche.
      add_(
        'six sols · la chute garde sa gravité',
        faller.grounded && Math.abs(dot(faller.stance, v3(0, 1, 0))) < 0.01,
        `verticale ${fmt(dot(faller.stance, v3(0, 1, 0)))} · ${faller.grounded ? 'posé' : 'en l’air'}`,
      )

      // La trémie. Elle est dans un coin : debout sur le mur du fond, il faut d'abord longer
      // la paroi jusqu'à son aplomb, et seulement ensuite monter dedans. C'est exactement le
      // trajet qu'on demande au visiteur, et c'est pour cela qu'on le mesure en deux temps
      // plutôt qu'en visant le coin en diagonale — en biais, on rencontre le plafond avant.
      const landed = faller.cell
      const shaft = world.cells
        .get(landed)!
        .passages.map((p) => p.from)
        .find((m) => m.normal.y < -0.5)
      if (!shaft) {
        add_('aile rouge · la trémie existe', false, `aucune ouverture au plafond de ${landed}`)
      }
      for (let i = 0; i < 900 && faller.cell === landed && shaft; i++) {
        const sideways = shaft.center.x - faller.pos.x
        faller.face(Math.abs(sideways) > 0.3 ? v3(sideways, 0, 0) : v3(0, 1, 0))
        faller.update(1 / 60, world, new Set(['KeyW']))
      }
      add_(
        'aile rouge · la trémie s’atteint depuis le mur du fond',
        faller.cell !== landed,
        faller.cell !== landed ? `monté jusqu’à ${faller.cell}` : `resté dans ${landed}`,
      )

      // Le conduit débouche. On continue de monter le long de la même paroi — elle court
      // d'une cellule à l'autre sans rupture, et c'est ce qui permet de monter un tunnel
      // debout sur un mur.
      const inside = faller.cell
      faller.face(v3(0, 1, 0))
      for (let i = 0; i < 900 && faller.cell === inside; i++) {
        faller.face(v3(0, 1, 0))
        faller.update(1 / 60, world, new Set(['KeyW']))
      }
      add_(
        'le conduit débouche sur la grande salle',
        faller.cell !== inside && faller.cell !== landed,
        faller.cell !== inside ? `${inside} → ${faller.cell}` : `bloqué dans ${inside}`,
      )

      // Et le contrôle qui donne son sens au précédent : d'aplomb, sur le plancher, la même
      // trémie est hors de portée. Sans quoi la trappe ne servirait à rien — il suffirait de
      // marcher jusqu'au fond de l'aile rouge pour monter, et la gravité de travers ne serait
      // qu'une décoration.
      const red = world.cells.get(landed)
      if (!red) {
        add_('aile rouge · la salle existe', false, `cellule inconnue : ${landed}`)
      } else {
        const upright_ = new Player()
        upright_.goTo(
          {
            name: 'aile rouge',
            cell: landed,
            pos: {
              x: (red.min.x + red.max.x) / 2,
              y: red.min.y + PROBE_BODY.eyeHeight,
              z: red.min.z + 2,
            },
            forward: v3(0, 0, 1),
          },
          world,
        )
        for (let i = 0; i < 600 && upright_.cell === landed; i++) {
          upright_.update(1 / 60, world, new Set(['KeyW']))
        }
        add_(
          'aile rouge · la trémie est hors de portée d’aplomb',
          upright_.cell === landed && dot(upright_.stance, v3(0, 1, 0)) > 0.999,
          upright_.cell === landed
            ? 'le mur du fond reste un mur'
            : `sorti vers ${upright_.cell} en marchant simplement`,
        )
      }
    }
  }

  // 13. L'escalier de Penrose.
  //
  //    **Un tour rend exactement la montée.** C'est l'égalité dont tout dépend : la
  //    couture translate de `rise`, et si le profil ne montait pas exactement de cela sur
  //    un tour, la marche d'après le raccord tomberait à côté de celle d'avant. On le
  //    vérifie sur le profil, paliers compris — c'est précisément ce qu'un palier pourrait
  //    casser sans qu'on s'en aperçoive.
  //
  //    **Le raccord ne se voit pas.** La rampe juste avant, moins un tour, doit valoir la
  //    rampe juste après. Sinon le corps monte ou descend d'un coup en le franchissant.
  //
  //    **Monter est sans fin.** On tient la touche d'avance en suivant la volée, et l'on
  //    doit repasser le raccord encore et encore, en revenant chaque fois au pied.
  //
  //    **Descendre ne boucle pas.** Le même trajet en sens inverse ne doit franchir aucune
  //    couture : on arrive au pied des marches, contre la cloison. C'est l'asymétrie qui
  //    fait l'escalier impossible, et elle tient à une couture sans jumelle — donc à
  //    quelque chose de solide qui s'oppose à la descente. Sans la cloison, on traversait
  //    comme un fantôme et l'on ressortait en haut.
  //
  //    **La descente mène ailleurs.** Depuis le pied, la porte du pilier donne sur la
  //    salle basse.
  {
    const stair = [...world.cells.values()].find((c) => c.spiral)
    if (!stair?.spiral) {
      add_('penrose · l’escalier existe', false, 'aucune cellule à escalier tournant')
    } else {
      const spiral = stair.spiral
      const gained = stepHeight(spiral, spiral.steps) - stepHeight(spiral, 0)
      add_(
        'penrose · un tour rend exactement la montée',
        Math.abs(gained - spiral.rise) < 1e-9,
        `${gained.toFixed(6)} m pour ${spiral.rise} annoncés,` +
          ` sur ${spiral.steps} marches dont ${spiral.landings.reduce((n, l) => n + l.count, 0)} de palier`,
      )

      // **Le profil est périodique d'un tour.** C'est ce qui rend le raccord invisible :
      // la couture translate de `rise`, et la volée d'après retombe exactement sur celle
      // d'avant. On l'éprouve en une trentaine de points plutôt qu'aux seules extrémités,
      // parce qu'un palier mal placé casserait l'égalité au milieu sans toucher aux bouts.
      let worstPeriod = 0
      for (let i = 0; i <= 32; i++) {
        const t = i / 32
        worstPeriod = Math.max(
          worstPeriod,
          Math.abs(heightAtTurn(spiral, t + 1) - heightAtTurn(spiral, t) - spiral.rise),
        )
      }
      add_(
        'penrose · le profil se répète exactement d’un tour',
        worstPeriod < 1e-9,
        `écart maximal ${fmt(worstPeriod)} m sur trente-deux points du tour`,
      )

      // Et le plafond suit, à distance constante : sans quoi on le sent s'éloigner d'un
      // tour au passage du raccord, ce qui trahit la boucle aussi sûrement qu'un décrochement.
      add_(
        'penrose · le plafond suit les marches',
        spiral.headroom > 2 && spiral.headroom < spiral.rise,
        `${spiral.headroom.toFixed(2)} m de hauteur libre, partout la même`,
      )

      /**
       * Suit la volée pendant `seconds`, dans le sens donné, en partant d'une porte — et
       * s'arrête plus tôt si `stop` le demande.
       */
      const follow = (dir: 1 | -1, seconds: number, door: Mouth, stop?: (w: Player) => boolean) => {
        const walker = new Player()
        walker.goTo(
          {
            name: 'penrose',
            cell: stair.id,
            // Deux mètres dans la salle, en partant de sa porte : jamais une coordonnée
            // écrite en dur, la porte ayant déjà changé de paroi une fois.
            pos: {
              ...add(door.center, scale(door.normal, 2.2)),
              y: door.center.y - 1.1 + PROBE_BODY.eyeHeight,
            },
            forward: scale(door.normal, -1),
          },
          world,
        )
        let lowest = Infinity
        let highest = -Infinity
        for (let i = 0; i < seconds * 60 && walker.cell === stair.id; i++) {
          if (stop && i > 60 && stop(walker)) break
          const rx = walker.pos.x - spiral.centre.x
          const rz = walker.pos.z - spiral.centre.z
          walker.face({ x: -rz * dir, y: 0, z: rx * dir })
          walker.update(1 / 60, world, new Set(['KeyW']))
          lowest = Math.min(lowest, walker.pos.y)
          highest = Math.max(highest, walker.pos.y)
        }
        return { walker, lowest, highest }
      }

      // **Chaque porte de l'escalier est sur la partie plate d'un palier.**
      //
      // L'invariant est né deux fois du même défaut, à deux endroits différents : une porte
      // dont le seuil tombe sur une marche qui monte encore est **infranchissable**, et
      // pour une raison qu'aucune image ne montre. Les pieds passent quelques centimètres
      // sous le seuil, la collision juge que le corps ne tient pas dans l'ouverture, et le
      // mur le repousse — on se cogne à une porte grande ouverte.
      //
      // Attention : un palier n'est pas plat sur toute sa longueur. La rampe est centrée
      // sur les marches, donc elle monte déjà sur la dernière du palier. C'est exactement
      // là que la porte était tombée.
      /** Une porte de paroi, par opposition à un raccord : sa bouche est hors de la boîte. */
      const isDoor = (m: Mouth): boolean =>
        m.center.x < stair.min.x ||
        m.center.x > stair.max.x ||
        m.center.z < stair.min.z ||
        m.center.z > stair.max.z

      let worstSlope = 0
      for (const passage of stair.passages) {
        const m = passage.from
        if (!isDoor(m)) continue
        const level = (side: number): number => {
          const at = add(m.center, scale(m.right, side * (m.halfWidth + PROBE_BODY.radius)))
          return rampHeight(spiral, add(at, scale(m.normal, PROBE_BODY.radius * 2)))
        }
        worstSlope = Math.max(worstSlope, Math.abs(level(1) - level(-1)))
      }
      add_(
        'penrose · chaque porte est sur un palier',
        worstSlope < 1e-9,
        `dénivelé maximal ${fmt(worstSlope)} m sur la largeur d’une ouverture`,
      )

      // **Le sol ne dépend pas de la taille du corps.**
      //
      // Deux volées se superposent à chaque secteur, séparées de douze mètres, et il faut
      // savoir sur laquelle on se tient. La réponse se lisait sur le repère du corps en le
      // supposant haut — un œil est à un mètre soixante-cinq de son sol. Le centre d'un cube
      // posé n'est qu'à dix-sept centimètres du sien : il était rangé sur la volée d'en
      // dessous, et tombait de douze mètres à travers un sol sur lequel un visiteur, au même
      // endroit, tenait debout. On éprouve donc les deux tailles au même endroit.
      let worstDrop = 0
      let dropAt = ''
      const midRadius = (spiral.inner + spiral.outer) / 2
      for (let i = 0; i <= 24; i++) {
        const turn = spiral.from + (spiral.turns * i) / 24
        const ground = heightAtTurn(spiral, turn)
        const at = onSquare(spiral.centre, midRadius, spiral.cut + 2 * Math.PI * turn, 0)
        for (const body of [PROBE_BODY, CUBE_BODY]) {
          const want = ground + body.eyeHeight
          const got = resolveAgainstCell(stair, { ...at, y: want }, body).pos.y
          if (Math.abs(got - want) > worstDrop) {
            worstDrop = Math.abs(got - want)
            dropAt = `au tour ${turn.toFixed(2)}, corps de ${body.eyeHeight.toFixed(2)} m`
          }
        }
      }
      add_(
        'penrose · le sol ne dépend pas de la taille du corps',
        worstDrop < 1e-9,
        worstDrop < 1e-9 ? 'visiteur et cube posés au même endroit' : `${fmt(worstDrop)} m d’écart ${dropAt}`,
      )

      const doorway = stair.passages.map((p) => p.from).filter(isDoor)
      const hubDoor = stair.passages.find((p) => p.to.cell === HUB)!.from
      const exit = stair.passages.find((p) => p.to.cell !== stair.id && p.to.cell !== HUB)
      const lowDoor = exit?.from

      // Les deux étages, repérés par leur sol : l'étage haut occupe [0, 1] et l'étage bas
      // [−1, 0]. Un visiteur est dans l'un ou dans l'autre, jamais entre les deux.
      const middle = heightAtTurn(spiral, 0)

      add_(
        'penrose · deux portes, deux étages',
        doorway.length === 2 &&
          lowDoor !== undefined &&
          hubDoor.center.y > middle &&
          lowDoor.center.y < middle,
        `${doorway.length} porte(s) ; rotonde à ${hubDoor.center.y.toFixed(1)} m,` +
          ` salle basse à ${lowDoor ? lowDoor.center.y.toFixed(1) : '—'} m,` +
          ` séparation à ${middle.toFixed(1)} m`,
      )

      const up = follow(1, 60, hubDoor)
      add_(
        'penrose · monter est sans fin',
        up.walker.crossings >= 3 && up.highest - up.lowest > spiral.rise * 0.8,
        `${up.walker.crossings} raccord(s) en une minute, entre ${up.lowest.toFixed(1)} et ${up.highest.toFixed(1)} m`,
      )

      // **Monter ne change jamais d'étage**, et c'est là tout le double escalier : la boucle
      // de chaque étage se referme sur elle-même, donc on ne rencontre en montant que la
      // porte de son propre étage. Le contrôle est exact — une hauteur, pas une distance —
      // parce que le défaut qu'il attrape est visuel et n'a pas d'autre trace numérique :
      // on apercevait, en montant, la salle basse s'ouvrir en contrebas.
      //
      // La mesure se fait contre la **porte d'en face**, et non contre la simple séparation
      // des deux étages : ce qu'on veut interdire, ce n'est pas de frôler l'autre étage,
      // c'est d'arriver à hauteur de son ouverture — donc de la voir.
      add_(
        'penrose · monter depuis la rotonde ne descend jamais à la salle basse',
        lowDoor === undefined || up.lowest > lowDoor.center.y + lowDoor.halfHeight,
        `descendu au plus bas à ${up.lowest.toFixed(2)} m,` +
          ` pour une porte de salle basse dont le linteau est à` +
          ` ${lowDoor ? (lowDoor.center.y + lowDoor.halfHeight).toFixed(2) : '—'} m`,
      )

      if (lowDoor) {
        const below = follow(1, 60, lowDoor)
        add_(
          'penrose · monter depuis la salle basse n’atteint jamais la rotonde',
          below.walker.crossings >= 3 && below.highest < hubDoor.center.y - hubDoor.halfHeight,
          `${below.walker.crossings} raccord(s), monté au plus haut à ${below.highest.toFixed(2)} m` +
            ` pour un seuil de rotonde à ${(hubDoor.center.y - hubDoor.halfHeight).toFixed(2)} m`,
        )
      }

      /**
       * Descend depuis une porte jusqu'au niveau de l'ouverture visée, puis marche dessus.
       *
       * On s'arrête à une **hauteur**, et non au bout d'un temps donné : dans cet escalier
       * la hauteur ne dépend que de l'angle, donc être au bon niveau, c'est être au bon
       * endroit du tour. Descendre trop longtemps ferait repasser par l'autre étage.
       */
      const descendTo = (from: Mouth, target: Mouth): Player => {
        const level = target.center.y - target.halfHeight + PROBE_BODY.eyeHeight
        // Une bande étroite, et non un simple « en dessous de » : en descendant depuis la
        // salle basse on commence **sous** le niveau visé, on plonge encore, et c'est le
        // raccord du bas qui reporte au-dessus de la porte de la rotonde.
        const { walker } = follow(-1, 60, from, (w) => w.pos.y <= level + 0.01 && w.pos.y > level - 0.4)
        for (let i = 0; i < 900 && walker.cell === stair.id; i++) {
          walker.face({
            x: target.center.x - walker.pos.x,
            y: 0,
            z: target.center.z - walker.pos.z,
          })
          walker.update(1 / 60, world, new Set(['KeyW']))
        }
        return walker
      }

      if (!exit || !lowDoor) {
        add_('penrose · la descente mène ailleurs', false, 'aucune porte vers une autre salle')
      } else {
        // **Descendre est le seul chemin.** Depuis la rotonde on trouve la salle basse ; et
        // depuis la salle basse, en descendant encore, on retrouve la rotonde. C'est la
        // seule façon de sortir de l'escalier, dans un sens comme dans l'autre.
        const down = descendTo(hubDoor, lowDoor)
        add_(
          'penrose · descendre depuis la rotonde mène à la salle basse',
          down.cell === exit.to.cell,
          `arrivé dans ${down.cell}, attendu ${exit.to.cell}`,
        )

        const back = descendTo(lowDoor, hubDoor)
        add_(
          'penrose · descendre depuis la salle basse ramène à la rotonde',
          back.cell === HUB,
          `arrivé dans ${back.cell}, attendu ${HUB}`,
        )
      }
    }
  }

  // 14. Aucune surface ne doit en recouvrir une autre.
  //
  //    Deux quads dans le même plan, qui partagent des pixels, se départagent au dernier
  //    bit de la profondeur interpolée — différemment d'un pixel à l'autre et d'une image
  //    à l'autre. Cela donne une bande qui grésille, et le défaut est d'autant plus voyant
  //    que les deux surfaces n'ont pas la même teinte.
  //
  //    Le musée s'était déjà débarrassé de ce défaut une fois, en remplaçant l'encadrement
  //    peint des ouvertures par le relief des embrasures — c'est ce qui a permis de
  //    rapprocher le plan proche à quatre millimètres. Il est revenu par une porte à
  //    laquelle personne n'avait pensé : celle d'un **coffre posé au milieu d'une salle**.
  //    L'embrasure d'une paroi est creusée dans son épaisseur, donc hors de l'emprise du
  //    sol ; celle d'un coffre est en plein milieu de la pièce, et sa dalle de seuil tombe
  //    exactement sur le sol qui passe dessous.
  //
  //    D'où ce contrôle, qui ne regarde pas une salle en particulier mais **toute** la
  //    géométrie du monde. C'est le genre de défaut qu'on ne relie pas à sa cause quand on
  //    le voit à l'écran : on croit à un problème de rendu, et on cherche des heures du
  //    mauvais côté.
  {
    let pairs = 0
    let worst = ''

    /** Deux polygones convexes du plan se recouvrent-ils ? Par axes séparateurs. */
    const overlap = (p: number[][], q: number[][]): boolean => {
      for (const poly of [p, q]) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]!
          const b = poly[(i + 1) % poly.length]!
          const nx = -(b[1]! - a[1]!)
          const ny = b[0]! - a[0]!
          const span = (r: number[][]): [number, number] => {
            let lo = Infinity
            let hi = -Infinity
            for (const s of r) {
              const d = s[0]! * nx + s[1]! * ny
              lo = Math.min(lo, d)
              hi = Math.max(hi, d)
            }
            return [lo, hi]
          }
          const [alo, ahi] = span(p)
          const [blo, bhi] = span(q)
          // Une marge, pour que deux quads qui se touchent par une arête ne comptent pas.
          const margin = 1e-3 * Math.hypot(nx, ny)
          if (ahi < blo + margin || bhi < alo + margin) return false
        }
      }
      return true
    }

    for (const cell of world.cells.values()) {
      // La géométrie est émise par quads de six sommets.
      const quads: { axis: number; sign: number; plane: number; poly: number[][] }[] = []
      const v = cell.verts
      for (let q = 0; q + 6 * FLOATS_PER_VERTEX <= v.length; q += 6 * FLOATS_PER_VERTEX) {
        const n = [v[q + 3]!, v[q + 4]!, v[q + 5]!]
        let axis = 0
        for (let k = 1; k < 3; k++) if (Math.abs(n[k]!) > Math.abs(n[axis]!)) axis = k
        // Les faces obliques — celles du tube vrillé — ne sont pas traitées : deux quads
        // qui tournent ne peuvent pas se recouvrir sans que la vrille elle-même soit
        // fausse, et c'est déjà vérifié ailleurs.
        if (Math.abs(n[axis]!) < 0.999) continue

        // Les deux axes du plan, et les quatre coins distincts des six sommets.
        const flat = [0, 1, 2].filter((k) => k !== axis)
        const seen = new Set<string>()
        const poly: number[][] = []
        for (const i of [0, 1, 2, 5]) {
          const at = q + i * FLOATS_PER_VERTEX
          const p = [v[at + flat[0]!]!, v[at + flat[1]!]!]
          const key = `${p[0]!.toFixed(4)},${p[1]!.toFixed(4)}`
          if (seen.has(key)) continue
          seen.add(key)
          poly.push(p)
        }
        if (poly.length < 3) continue
        quads.push({ axis, sign: Math.sign(n[axis]!), plane: v[q + axis]!, poly })
      }

      for (let i = 0; i < quads.length; i++) {
        for (let j = i + 1; j < quads.length; j++) {
          const a = quads[i]!
          const b = quads[j]!
          if (a.axis !== b.axis || Math.abs(a.plane - b.plane) > 1e-4) continue
          // **Deux faces opposées dans le même plan ne se disputent rien** : à un pixel
          // donné, le tri des faces arrière n'en garde qu'une. C'est le cas ordinaire du
          // dessus et du dessous d'une marche, et le compter serait crier au loup.
          if (a.sign !== b.sign) continue
          if (!overlap(a.poly, b.poly)) continue
          pairs++
          if (!worst) worst = `${cell.id}, plan ${'xyz'[a.axis]}=${a.plane.toFixed(3)}`
        }
      }
    }

    add_(
      'géométrie · aucune surface n’en recouvre une autre',
      pairs === 0,
      pairs === 0 ? 'aucun plan partagé' : `${pairs} paire(s) coplanaires — la première dans ${worst}`,
    )
  }

  // 15. Toute porte perce la paroi où elle est posée.
  //
  //    Une bouche et son trou sont décrits **séparément** : la bouche par la couture, le
  //    trou par la paroi qu'on découpe autour. Rien ne les tient ensemble, et le jour où la
  //    porte de l'escalier a déménagé sur un palier d'angle, la bouche a suivi mais pas le
  //    trou : l'aile déclarait toujours le milieu de sa paroi nord.
  //
  //    Ce qui en résulte est déroutant, et n'a rien qui ressemble à une erreur. On entre
  //    dans l'escalier normalement — la collision, elle, connaît la bouche et laisse
  //    passer —, mais une fois dedans **il n'y a plus de porte** : rien qu'un mur plein là
  //    où l'on vient d'entrer. Aucune sonde numérique ne le voit, aucune image ne l'explique.
  //
  //    Le contrôle est direct : au centre d'une porte, dans le plan de sa paroi, il ne doit
  //    y avoir aucune surface.
  {
    const walled: string[] = []
    for (const cell of world.cells.values()) {
      const v = cell.verts
      for (const passage of cell.passages) {
        const m = passage.from
        const k = Math.abs(m.normal.x) > 0.99 ? 0 : Math.abs(m.normal.z) > 0.99 ? 2 : -1
        if (k < 0) continue // un raccord posé en biais n'est pas une porte de paroi
        const along = k === 0 ? m.center.x : m.center.z
        const lo = k === 0 ? cell.min.x : cell.min.z
        const hi = k === 0 ? cell.max.x : cell.max.z
        // Une porte de paroi est au fond de son embrasure, donc **hors** de la boîte de la
        // cellule. Ce qui est dedans est un raccord, ou la porte d'un coffre.
        if (along > lo && along < hi) continue
        const plane = along < lo ? lo : hi
        const lateral = k === 0 ? m.center.z : m.center.x

        for (let q = 0; q + 6 * FLOATS_PER_VERTEX <= v.length; q += 6 * FLOATS_PER_VERTEX) {
          let uLo = Infinity
          let uHi = -Infinity
          let yLo = Infinity
          let yHi = -Infinity
          let inPlane = true
          for (const i of [0, 1, 2, 5]) {
            const at = q + i * FLOATS_PER_VERTEX
            if (Math.abs(v[at + k]! - plane) > 1e-4) {
              inPlane = false
              break
            }
            const u = v[at + (k === 0 ? 2 : 0)]!
            uLo = Math.min(uLo, u)
            uHi = Math.max(uHi, u)
            yLo = Math.min(yLo, v[at + 1]!)
            yHi = Math.max(yHi, v[at + 1]!)
          }
          if (!inPlane) continue
          if (
            lateral > uLo + 1e-4 &&
            lateral < uHi - 1e-4 &&
            m.center.y > yLo + 1e-4 &&
            m.center.y < yHi - 1e-4
          ) {
            walled.push(m.id)
            break
          }
        }
      }
    }
    add_(
      'géométrie · toute porte perce sa paroi',
      walled.length === 0,
      walled.length === 0
        ? 'aucune ouverture murée'
        : `${walled.length} porte(s) murée(s) : ${walled.join(', ')}`,
    )
  }

  // 16. Le réseau d'une salle pavée s'accorde à ses coutures.
  //
  //    Une salle pavée est décrite **deux fois** : par ses coutures, qui disent où le corps
  //    se retrouve quand il sort d'un côté, et par son réseau, qui dit où l'on dessine ses
  //    copies. Rien n'oblige les deux à s'accorder — et s'ils divergent, le musée devient
  //    un mensonge : on voit une salle à dix mètres, on y marche, et l'on arrive ailleurs.
  //
  //    Le contrôle est exact. Chaque couture d'une salle en réseau doit être une **pure
  //    translation** d'un pas du réseau, ni plus ni moins : pas de rotation, pas de dérive,
  //    pas un centimètre de trop.
  {
    const wrong: string[] = []
    for (const cell of world.cells.values()) {
      if (!cell.lattice) continue
      for (const passage of cell.passages) {
        if (passage.to.cell !== cell.id) continue
        const t = passage.transform
        // La partie rotation doit être l'identité.
        const rot = create()
        rot.set(t)
        rot[12] = 0; rot[13] = 0; rot[14] = 0
        if (identityError(rot) > EPS) {
          wrong.push(`${passage.from.id} tourne`)
          continue
        }
        const step = { x: Math.abs(t[12]!), y: Math.abs(t[13]!), z: Math.abs(t[14]!) }
        const alongX = step.x > 0 && step.z === 0
        const wanted = alongX ? cell.lattice.x : cell.lattice.z
        const got = alongX ? step.x : step.z
        if (step.y !== 0 || Math.abs(got - wanted) > EPS) {
          wrong.push(`${passage.from.id} translate de ${got.toFixed(4)} au lieu de ${wanted}`)
        }
      }
    }
    add_(
      'pavé · le réseau s’accorde aux coutures',
      wrong.length === 0,
      wrong.length === 0 ? 'chaque couture vaut un pas du réseau' : wrong.join(' ; '),
    )
  }

  // 17. Et l'on revient chez soi en marchant tout droit.
  //
  //    C'est la promesse de la salle : elle n'a pas de bord. Un pas de réseau parcouru en
  //    ligne droite doit ramener **exactement** au point de départ — pas à un centimètre
  //    près, exactement, sans quoi tourner en rond quelques minutes suffirait à dériver.
  {
    for (const cell of world.cells.values()) {
      if (!cell.lattice) continue
      const start = {
        x: cell.min.x + 2,
        y: cell.min.y + PROBE_BODY.eyeHeight,
        z: cell.max.z - 1,
      }
      const walker = new Player()
      walker.goTo({ name: 'pavé', cell: cell.id, pos: start, forward: v3(0, 0, -1) }, world)
      // Le pas du réseau, en marchant : on s'arrête dès qu'on a repassé sa cote de départ.
      let drift = Infinity
      for (let i = 0; i < 600; i++) {
        walker.update(1 / 60, world, new Set(['KeyW']))
        if (walker.crossings > 0 && walker.pos.z <= start.z) {
          drift = Math.hypot(walker.pos.x - start.x, walker.pos.y - start.y)
          break
        }
      }
      add_(
        `${cell.id} · marcher tout droit ramène au départ`,
        drift < 1e-6,
        drift === Infinity ? 'le tour n’a pas été bouclé' : `dérive latérale ${fmt(drift)} m`,
      )
    }
  }

  // 18. Une couture qui relie une cellule à elle-même ne transmet aucune lumière.
  //
  //    La radiance d'une bouche sert à faire entrer chez soi l'éclairage d'ailleurs. Quand
  //    cet ailleurs est ici, il est déjà compté par les lampes de la salle, et l'ajouter une
  //    seconde fois pose une flaque claire au pied de l'ouverture — une bande plus lumineuse
  //    en travers du seuil que rien dans le dessin n'explique.
  //
  //    La règle était connue et appliquée à la main aux raccords de l'escalier ; la salle du
  //    reliquaire, dont les deux bouches se répondent, y avait échappé.
  {
    const leaking: string[] = []
    for (const cell of world.cells.values()) {
      for (const passage of cell.passages) {
        if (passage.to.cell !== cell.id) continue
        const [r, g, b] = passage.radiance
        if (r !== 0 || g !== 0 || b !== 0) leaking.push(passage.from.id)
      }
    }
    add_(
      'éclairage · une couture vers soi-même ne s’éclaire pas elle-même',
      leaking.length === 0,
      leaking.length === 0
        ? 'aucune fuite'
        : `${leaking.length} couture(s) qui rayonnent chez elles : ${leaking.join(', ')}`,
    )
  }

  // 18 bis. Le pont sur le vide.
  //
  //    **La passerelle porte.** Un mètre cinquante sans garde-corps : on doit pouvoir la
  //    parcourir jusqu'au bout en marchant droit, et n'en tomber qu'en s'en écartant. Une
  //    passerelle dont on tombe en marchant droit ne serait pas un vertige mais un défaut.
  //
  //    **On en tombe, et le vide reboucle.** C'est la réponse à « que se passe-t-il si je
  //    saute ? », et elle ne peut être ni la mort — le plan dit « aucun danger » — ni un sol
  //    vingt mètres plus bas, qui supprimerait le vide. Le plancher de la cellule est recollé
  //    à son plafond : on tombe, on repasse par le haut, et l'on retombe.
  //
  //    **Et la chute n'est pas une punition.** On garde la maîtrise de son déplacement en
  //    l'air : en se replaçant au-dessus du belvédère pendant la descente, on y atterrit. Un
  //    tour suffit. C'est ce qui fait de la chute un trajet plutôt qu'un piège.
  {
    const marks = getLandmarks()
    const outside = world.cells.get(marks.bridgeCell)

    if (!outside) {
      add_('pont · la cellule existe', false, `cellule inconnue : ${marks.bridgeCell}`)
    } else {
      // Le long de la passerelle, droit devant.
      const walker = new Player()
      walker.goTo({ name: 'pont', cell: outside.id, pos: { ...marks.bridgePos }, forward: v3(0, 0, 1) }, world)
      let lowest = walker.pos.y
      // Cinq secondes, soit dix-sept mètres : de quoi couvrir la portée restante sans
      // atteindre le bout, qui est en l'air et dont on doit tomber.
      for (let i = 0; i < 300; i++) {
        walker.update(1 / 60, world, new Set(['KeyW']))
        lowest = Math.min(lowest, walker.pos.y)
      }
      add_(
        'pont · la passerelle porte',
        walker.grounded && lowest > marks.bridgePos.y - 0.5,
        `descendu à ${fmt(lowest)} m, ${walker.grounded ? 'posé' : 'en l’air'}`,
      )

      // Puis on s'en écarte, et l'on vise le belvédère en tombant.
      const faller = new Player()
      faller.goTo({ name: 'pont', cell: outside.id, pos: { ...marks.bridgePos }, forward: v3(1, 0, 0) }, world)
      const landing = { x: marks.bridgePos.x, z: outside.min.z + 3 }
      let loops = 0
      let steps = 0
      for (let i = 0; i < 3000; i++) {
        if (faller.grounded && loops === 0 && faller.pos.y > 0) faller.face(v3(1, 0, 0))
        else faller.face(v3(landing.x - faller.pos.x, 0, landing.z - faller.pos.z))
        const before = faller.pos.y
        faller.update(1 / 60, world, new Set(['KeyW']))
        // Un bond de cent mètres vers le haut n'arrive que d'une façon : par la couture.
        if (faller.pos.y > before + 100) loops++
        steps = i
        if (loops > 0 && faller.grounded) break
      }
      add_(
        'pont · le vide reboucle',
        loops >= 1,
        loops >= 1 ? `${loops} tour(s) de chute` : 'jamais repassé par le haut',
      )
      add_(
        'pont · la chute n’est pas une punition',
        loops >= 1 && faller.grounded,
        faller.grounded
          ? `reposé après ${(steps / 60).toFixed(1)} s à ${fmt(faller.pos.y)} m`
          : 'toujours en chute au bout de cinquante secondes',
      )
    }
  }

  // 19. Aucune cellule ne dépasse le budget de lampes du nuanceur.
  //
  //    Le dépassement est **silencieux** : le rendu prend les premières et laisse tomber le
  //    reste. Une salle mal éclairée n'a alors aucune cause visible, et l'on cherche du côté
  //    des couleurs ou des rayons pendant que la lampe manquante n'a jamais été envoyée.
  {
    let worst = 0
    let where = ''
    for (const cell of world.cells.values()) {
      if (cell.lighting.lights.length > worst) {
        worst = cell.lighting.lights.length
        where = cell.id
      }
    }
    add_(
      'éclairage · aucune cellule ne dépasse le budget de lampes',
      worst <= MAX_LIGHTS,
      `${worst} lampes au plus, dans ${where}, pour un budget de ${MAX_LIGHTS}`,
    )
  }

  // 20. Un contrôle bête et utile : personne ne doit se retrouver hors de sa cellule.
  const stray = v3(0, 1.65, 0)
  for (const cell of world.cells.values()) {
    const p = resolveAgainstCell(cell, stray, PROBE_BODY).pos
    const inside =
      p.x >= cell.min.x - 1.3 && p.x <= cell.max.x + 1.3 && p.z >= cell.min.z - 1.3 && p.z <= cell.max.z + 1.3
    add_(`${cell.id} · collision bornée`, inside, `${p.x.toFixed(2)} ${p.z.toFixed(2)}`)
  }

  return checks
}
