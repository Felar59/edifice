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
import type { World } from '../world/types'

export interface Check {
  name: string
  ok: boolean
  detail: string
}

const EPS = 1e-5

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
  const hall = world.cells.get('hall')
  if (hall) {
    const mouth = hall.passages[0]!.from
    const start = add(mouth.center, scale(mouth.normal, 1.5))
    const forward = scale(mouth.normal, -1)

    const carried = [{ ...forward }]
    const out = advance(world, 'hall', start, scale(forward, 3), carried, (cell, p) =>
      resolveAgainstCell(cell, p, 0.35),
    )
    add_('marche · la couture est bien franchie', out.crossings === 1, `${out.crossings} traversée(s)`)

    const backCarried = [{ ...carried[0]! }]
    const home = advance(world, out.cell, out.pos, scale(carried[0]!, -3), backCarried, (cell, p) =>
      resolveAgainstCell(cell, p, 0.35),
    )
    const err = distance(home.pos, start)
    add_(
      'marche · aller-retour revient au départ',
      home.cell === 'hall' && err < 1e-3,
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
    let cell = 'hall'
    let pos = { ...start }
    const dir = [{ ...forward }]
    let total = 0
    let worstDrift = 0
    let escaped: string | null = null

    for (let i = 0; i < 400; i++) {
      const step = advance(world, cell, pos, scale(dir[0]!, 4), dir, (c, p) =>
        resolveAgainstCell(c, p, 0.35),
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
      `${total} traversées sur 1600 m`,
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
    player.goTo({ name: 'contrôle', cell: 'hall', pos: v3(0, 1.65, -3), forward: pitched })

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
    thrower.goTo({ name: 'contrôle', cell: 'hall', pos: v3(0, 1.65, -2.2), forward: v3(0, 0, -1) })
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
      if (cube.cell !== 'hall') crossed = true

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

    add_('objet lancé · franchit bien la couture', crossed, crossed ? 'oui' : 'jamais sorti du hall')
    add_('objet lancé · base orthogonale', worstOrtho < 1e-4, `écart ${fmt(worstOrtho)}`)
    add_('objet lancé · base directe', worstDet < 1e-4, `écart ${fmt(worstDet)}`)
    add_(
      'objet lancé · orientation transportée',
      worstJump < 0.12,
      `saut maximal ${worstJump.toFixed(4)} par image (rotation propre : ${(4.5 * step).toFixed(4)})`,
    )
  }

  // 10. Un contrôle bête et utile : personne ne doit se retrouver hors de sa cellule.
  const stray = v3(0, 1.65, 0)
  for (const cell of world.cells.values()) {
    const p = resolveAgainstCell(cell, stray, 0.35)
    const inside =
      p.x >= cell.min.x - 1.3 && p.x <= cell.max.x + 1.3 && p.z >= cell.min.z - 1.3 && p.z <= cell.max.z + 1.3
    add_(`${cell.id} · collision bornée`, inside, `${p.x.toFixed(2)} ${p.z.toFixed(2)}`)
  }

  return checks
}
