/**
 * Trace numérique d'un parcours : ce que les images ne montrent pas.
 *
 * Certains défauts ne se voient pas sur une capture. Le repère de la caméra faussé
 * en piquant du nez cisaillait l'image d'une façon que ni l'œil ni une mesure de
 * relief ne signalaient — seul un invariant l'attrapait. Cet outil est fait pour ce
 * genre de choses : on marche, et on relève à chaque pas la position, le regard, la
 * verticale locale, le roulis et les compteurs du rendu, puis on signale toute
 * discontinuité.
 *
 * Il est écrit en prévision du **tunnel-vrille** et de la **gravité par face**, où
 * la verticale locale doit tourner de façon parfaitement continue : une marche
 * d'escalier de quelques degrés y sera invisible à l'œil et donnera la nausée.
 *
 * Ce qui doit rester continu d'un pas au suivant :
 *   — le regard et la verticale, sauf à l'instant d'une traversée, où ils tournent
 *     tous deux de la rotation de la couture ;
 *   — **l'angle entre les deux**, y compris pendant une traversée : une
 *     transformation rigide agit identiquement sur l'un et sur l'autre ;
 *   — la norme de chacun, qui vaut un.
 *
 * Exemples
 *   node tools/trace.mjs
 *   node tools/trace.mjs --steps 200 --mm 5 --pitch -0.4
 */

import { open } from './lib/harness.mjs'

const argv = process.argv.slice(2)
/** Les valeurs consommées par une option ne doivent pas être relues comme argument. */
const consumed = new Set()
argv.forEach((a, i) => {
  if (a.startsWith('--')) consumed.add(i + 1)
})

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i < 0 || i + 1 >= argv.length ? fallback : Number(argv[i + 1])
}

const steps = flag('steps', 60)
const millimetres = flag('mm', 1)
const pitch = flag('pitch', 0)

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const norm = (a) => Math.sqrt(dot(a, a))
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

const session = await open({ width: 200, height: 140, port: 9402 })
const rows = []

try {
  const seam = await session.seam()
  await session.pose({
    x: seam.cx + seam.nx * 0.02,
    z: seam.cz + seam.nz * 0.02,
    forward: [-seam.nx, pitch, -seam.nz],
  })

  for (let i = 0; i < steps; i++) {
    const s = await session.state()
    const right = cross(s.forward, s.up)
    rows.push({
      mm: i * millimetres,
      cell: s.cell,
      crossings: s.crossings,
      pos: s.pos,
      forward: s.forward,
      up: s.up,
      // Angle entre le regard et la verticale locale : invariant par traversée.
      tilt: dot(s.forward, s.up),
      // Roulis apparent : le côté doit rester perpendiculaire à la verticale du
      // monde tant que la gravité ne tourne pas. Ce sera le témoin du tunnel-vrille.
      roll: norm(right) > 1e-9 ? right.y / norm(right) : 0,
      normForward: norm(s.forward),
      normUp: norm(s.up),
      passes: s.stats.passes,
      deepest: s.stats.deepest,
    })
    await session.walk(millimetres / 1000)
  }
} finally {
  await session.close()
}

// --- Le relevé ---------------------------------------------------------------

console.log(
  '  mm  cellule  trav.      x       y       z   incl.  roulis  |f|-1  |u|-1  passes',
)
console.log('  ' + '─'.repeat(76))
for (const r of rows) {
  console.log(
    `${String(r.mm).padStart(4)}  ${r.cell.padEnd(7)}  ${String(r.crossings).padStart(4)}` +
      ` ${r.pos.x.toFixed(2).padStart(7)} ${r.pos.y.toFixed(2).padStart(7)} ${r.pos.z.toFixed(2).padStart(7)}` +
      ` ${r.tilt.toFixed(3).padStart(6)} ${r.roll.toFixed(3).padStart(7)}` +
      ` ${(r.normForward - 1).toExponential(0).padStart(6)} ${(r.normUp - 1).toExponential(0).padStart(6)}` +
      ` ${String(r.passes).padStart(6)}`,
  )
}

// --- Ce qui ne devrait jamais arriver ---------------------------------------

const problems = []
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1]
  const b = rows[i]

  if (Math.abs(b.tilt - a.tilt) > 1e-4) {
    problems.push(
      `mm ${b.mm} : l'inclinaison du regard saute de ${a.tilt.toFixed(5)} à ${b.tilt.toFixed(5)}` +
        `${b.crossings > a.crossings ? ' (pendant une traversée — donc un vecteur n’a pas été transporté)' : ''}`,
    )
  }
  if (Math.abs(b.normForward - 1) > 1e-5 || Math.abs(b.normUp - 1) > 1e-5) {
    problems.push(`mm ${b.mm} : un vecteur n'est plus unitaire`)
  }
  if (b.passes === 0) {
    problems.push(`mm ${b.mm} : aucune passe de rendu`)
  }
}

const crossed = rows.at(-1).crossings - rows[0].crossings
console.log(
  `\n${rows.length} pas sur ${(rows.length * millimetres) / 1000} m · ${crossed} traversée(s)` +
    ` · cellules : ${[...new Set(rows.map((r) => r.cell))].join(', ')}`,
)

if (problems.length === 0) {
  console.log('aucune discontinuité.')
} else {
  console.log(`\n${problems.length} anomalie(s) :`)
  for (const p of problems) console.log(`  ${p}`)
  process.exitCode = 1
}
