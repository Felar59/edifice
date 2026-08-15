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
import { Projectiles } from '../player/projectiles'
import { cameraToWorld } from '../render/camera'
import { advance, resolveAgainstCell } from '../world/motion'
import { angleAt, frameAt, profileAngle, toLocal, toWorld } from '../world/twist'
import { getLandmarks, HUB } from '../world/world'
import type { Mouth, World } from '../world/types'

export interface Check {
  name: string
  ok: boolean
  detail: string
}

const EPS = 1e-5

/** Un corps de sonde, aux mesures du visiteur. */
const PROBE_BODY = { radius: 0.35, eyeHeight: 1.65, headroom: 0.15 }

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

export function runSelfTest(world: World): Check[] {
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
      if (!back) {
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
    const cubes = new Projectiles()
    cubes.throwFrom(thrower, world)

    const step = 1 / 120
    let crossed = false
    let worstOrtho = 0
    let worstDet = 0
    let worstJump = 0
    let previous: number | null = null

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

      // Un cube au repos a une vitesse nulle : plus de trajectoire, plus d'angle.
      const speed = len(cube.vel)
      if (speed < 0.5) break
      const relative = dot(cube.ex, scale(cube.vel, 1 / speed))
      if (previous !== null) worstJump = Math.max(worstJump, Math.abs(relative - previous))
      previous = relative
    }

    add_('objet lancé · franchit bien la couture', crossed, crossed ? 'oui' : 'jamais sorti de la rotonde')
    add_('objet lancé · base orthogonale', worstOrtho < 1e-4, `écart ${fmt(worstOrtho)}`)
    add_('objet lancé · base directe', worstDet < 1e-4, `écart ${fmt(worstDet)}`)
    add_(
      'objet lancé · orientation transportée',
      worstJump < 0.12,
      `saut maximal ${worstJump.toFixed(4)} par image (rotation propre : ${(4.5 * step).toFixed(4)})`,
    )
  }

  // 10. Le tunnel-vrille.
  //
  //    Sept propriétés. Les trois premières tiennent à ce qui fait l'effet — on ne doit
  //    jamais **voir** le couloir tourner — et les quatre suivantes à la vrille elle-même.
  //
  //    **De la rotonde, le couloir est droit.** Pas « presque droit » : l'angle vu doit
  //    être nul au bit près sur toute la longueur du tube. Une vrille construite une fois
  //    pour toutes se lit depuis le seuil, et l'effet est mort avant le premier pas.
  //
  //    **Entrer ne déplace aucune paroi.** C'est l'invariant qui a de la valeur, parce que
  //    c'est celui qu'on ne verrait pas venir : un tube dont la forme dépend du visiteur
  //    peut tressaillir à l'instant précis où il arrive, et cet instant-là est celui où
  //    l'on regarde le couloir. On mesure donc le déplacement de la paroi de part et
  //    d'autre du franchissement — par les deux portes, puisque le tunnel a deux bouts.
  //
  //    **Au-delà du fondu, plus rien ne tourne.** Toutes les sections qui suivent portent
  //    le même angle, exactement : le couloir lointain est droit. Ce qui le sépare du
  //    visiteur n'est qu'un roulis, et celui-là on le veut — c'est le seul signe qu'on
  //    donne au marcheur que quelque chose se passe. On vérifie donc les deux ensemble :
  //    aucune courbure au loin, et un roulis franc mais mesuré.
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

      /** L'angle vu le plus fort de tout le tube. */
      const worstAngle = (): number => {
        let worst = 0
        for (let i = 0; i <= 120; i++) {
          worst = Math.max(worst, Math.abs(angleAt(twist, (i * twist.length) / 120)))
        }
        return worst
      }

      /**
       * Les quatre arêtes du tube, échantillonnées d'un bout à l'autre.
       *
       * On mesure la paroi elle-même, en coordonnées du monde, et non l'angle : c'est ce
       * que l'œil voit, et c'est la seule façon d'attraper un tressaillement quelle qu'en
       * soit la cause — un angle, un repère, une bouche qui aurait bougé sans les autres.
       */
      const surface = (): Vec3[] => {
        const h = twist.halfSize
        const out: Vec3[] = []
        for (let i = 0; i <= 60; i++) {
          const s = (i * twist.length) / 60
          for (const [u, v] of [[-h, -h], [h, -h], [h, h], [-h, h]] as const) {
            out.push(toWorld(twist, { s, u, v }))
          }
        }
        return out
      }
      const shift = (a: Vec3[], b: Vec3[]): number =>
        a.reduce((worst, p, i) => Math.max(worst, distance(p, b[i]!)), 0)

      /**
       * Fait entrer un visiteur par une porte donnée de la rotonde, et mesure de combien
       * la paroi du tube a bougé pendant qu'il franchissait le seuil.
       */
      const enterBy = (door: Mouth): { crossed: boolean; moved: number; walker: Player } => {
        const walker = new Player()
        walker.goTo(
          {
            name: 'vrille',
            cell: HUB,
            pos: {
              ...add(door.center, scale(door.normal, 0.5)),
              y: world.cells.get(HUB)!.min.y + PROBE_BODY.eyeHeight,
            },
            forward: scale(door.normal, -1),
          },
          world,
        )

        const before = surface()
        let guard = 0
        while (walker.cell !== tube.id && guard++ < 40) walker.walk(world, 0.2)
        return { crossed: walker.cell === tube.id, moved: shift(before, surface()), walker }
      }

      // Depuis la rotonde, avant d'être entré : un couloir droit, et rien d'autre.
      add_(
        'vrille · de la rotonde, le couloir est droit',
        worstAngle() === 0,
        `angle vu maximal ${fmt(worstAngle())} rad sur ${twist.length} m`,
      )

      // Les deux portes de la rotonde qui mènent au tunnel, prises côté rotonde. On entre
      // par les deux : le tunnel a deux bouts, et celui qui essaie l'autre porte ne doit
      // pas en apprendre davantage que le premier.
      const doors = world.cells.get(HUB)!.passages.filter((p) => p.to.cell === tube.id)
      const front = doors.find((p) => dot(p.to.normal, twist.axis) > 0)
      const back = doors.find((p) => dot(p.to.normal, twist.axis) < 0)
      add_(
        'vrille · les deux bouts donnent sur la rotonde',
        front !== undefined && back !== undefined,
        `${doors.length} porte(s) vers le tunnel`,
      )

      if (back) {
        const byTheBack = enterBy(back.from)
        add_(
          'vrille · entrer par le fond ne déplace aucune paroi',
          byTheBack.crossed && byTheBack.moved < 1e-9,
          `${byTheBack.crossed ? '' : 'jamais entré · '}déplacement maximal ${fmt(byTheBack.moved)} m`,
        )
      }

      const entered = enterBy(front ? front.from : world.cells.get(HUB)!.passages[0]!.from)
      add_(
        'vrille · entrer ne déplace aucune paroi',
        entered.crossed && entered.moved < 1e-9,
        `${entered.crossed ? '' : 'jamais entré · '}déplacement maximal ${fmt(entered.moved)} m`,
      )
      const walker = entered.walker

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

      // Les paliers droits doivent excéder le fondu, sinon les bouches ne sont plus
      // exactement à l'angle de leur couture — un pivotement d'un degré au moment du
      // franchissement, assez petit pour qu'on l'attribue à autre chose.
      add_(
        'vrille · les paliers droits couvrent le fondu',
        twist.blend > 0 && twist.blend <= twist.straight && twist.blend <= twist.runout &&
          profileAngle(twist, twist.straight) === 0 &&
          profileAngle(twist, twist.length - twist.runout) === twist.turn,
        `fondu ${twist.blend.toFixed(1)} m · paliers ${twist.straight.toFixed(1)} et` +
          ` ${twist.runout.toFixed(1)} m · ${((twist.turn * 180) / Math.PI).toFixed(0)}° répartis sur` +
          ` ${(twist.length - twist.straight - twist.runout).toFixed(1)} m`,
      )

      let worstTilt = 0
      let worstAhead = 0
      let worstRoll = 0
      let guard = 0
      while (walker.cell === 'vrille' && toLocal(twist, walker.pos).s < twist.length - 0.4 && guard++ < 400) {
        walker.walk(world, 0.2)
        if (walker.cell !== 'vrille') continue
        worstTilt = Math.max(worstTilt, Math.abs(dot(walker.forward, walker.up) - tiltAtEntry))

        // Au-delà du fondu, plus une seule section ne tourne : toutes portent le même
        // angle, et c'est de cette égalité que vient le couloir droit qu'on a sous les
        // yeux. Ce qui les sépare du visiteur est un **roulis**, pas une courbure — et
        // c'est lui, au contraire, qu'on veut voir.
        const here = toLocal(twist, walker.pos).s
        const far = Math.min(here + twist.blend, twist.length)
        const settled = angleAt(twist, far)
        for (let i = 0; i <= 24; i++) {
          const s = far + ((twist.length - far) * i) / 24
          worstAhead = Math.max(worstAhead, Math.abs(angleAt(twist, s) - settled))
        }
        worstRoll = Math.max(worstRoll, Math.abs(settled - angleAt(twist, here)))
      }

      add_(
        'vrille · au-delà du fondu, le couloir ne tourne plus',
        worstAhead === 0,
        `écart maximal ${fmt(worstAhead)} rad sur tout ce qui suit les` +
          ` ${twist.blend.toFixed(1)} m du fondu`,
      )
      // Le roulis résiduel est le prix du fondu, et il doit rester un signe discret : de
      // l'ordre du dixième de tour, jamais du quart, sans quoi le couloir lointain
      // paraîtrait franchement couché et vendrait la mèche depuis l'entrée.
      add_(
        'vrille · le couloir lointain roule sans se courber',
        worstRoll > 0.02 && worstRoll < twist.turn / 4,
        `${((worstRoll * 180) / Math.PI).toFixed(1)}° au plus fort de la vrille`,
      )

      const exit = toLocal(twist, walker.pos)
      const turned = Math.acos(Math.max(-1, Math.min(1, dot(upAtEntry, walker.up))))
      // L'angle attendu est lu sur le **profil**, et non sur ce que la paroi montre : le
      // profil n'est pas linéaire — paliers droits et montée en fondu — et le supposer tel
      // ferait échouer l'invariant pour une bonne raison de dessin. C'est bien le profil
      // que le visiteur accumule, puisqu'il se tient toujours au front du fondu.
      const expected = profileAngle(twist, exit.s) - profileAngle(twist, entry.s)

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

      // Et le tunnel se referme comme il était : droit. Sans cette remise au repos, le
      // visiteur suivant — ou le même, revenu par l'autre porte — trouverait un couloir
      // déjà tordu par son passage précédent, ce qui est exactement ce qu'on lui cache.
      add_(
        'vrille · une fois sorti, le couloir est de nouveau droit',
        worstAngle() === 0,
        `angle vu maximal ${fmt(worstAngle())} rad`,
      )
    }
  }

  // 10. Un contrôle bête et utile : personne ne doit se retrouver hors de sa cellule.
  const stray = v3(0, 1.65, 0)
  for (const cell of world.cells.values()) {
    const p = resolveAgainstCell(cell, stray, PROBE_BODY).pos
    const inside =
      p.x >= cell.min.x - 1.3 && p.x <= cell.max.x + 1.3 && p.z >= cell.min.z - 1.3 && p.z <= cell.max.z + 1.3
    add_(`${cell.id} · collision bornée`, inside, `${p.x.toFixed(2)} ${p.z.toFixed(2)}`)
  }

  return checks
}
