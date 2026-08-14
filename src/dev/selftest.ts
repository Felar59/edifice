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
import { add, cross, dot, len, scale, sub, v3, type Vec3 } from '../math/vec3'
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

  // 7. Un contrôle bête et utile : personne ne doit se retrouver hors de sa cellule.
  const stray = v3(0, 1.65, 0)
  for (const cell of world.cells.values()) {
    const p = resolveAgainstCell(cell, stray, 0.35)
    const inside =
      p.x >= cell.min.x - 1.3 && p.x <= cell.max.x + 1.3 && p.z >= cell.min.z - 1.3 && p.z <= cell.max.z + 1.3
    add_(`${cell.id} · collision bornée`, inside, `${p.x.toFixed(2)} ${p.z.toFixed(2)}`)
  }

  return checks
}
