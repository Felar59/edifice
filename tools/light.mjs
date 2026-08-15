/**
 * Profil lumineux d'un parcours : la lumière franchit-elle la couture proprement ?
 *
 * L'outil de cette étape. Ce qu'on veut voir, en deux temps :
 *
 * **La flaque.** En approchant d'une porte, le sol doit prendre la teinte de la
 * pièce d'en face. Les deux salles ont des températures opposées exprès — hall
 * chaud, salle froide — donc le rapport rouge/bleu mesuré au sol doit basculer bien
 * avant qu'on franchisse quoi que ce soit. S'il ne bascule pas, la lumière ne passe
 * pas.
 *
 * **La continuité.** À l'instant du franchissement, l'image ne doit pas sauter. Un
 * millimètre avant, l'ouverture couvre tout le champ et on voit déjà la pièce d'en
 * face ; un millimètre après, on y est. Les deux images regardent la même pièce
 * éclairée par les mêmes lampes, donc la luminance doit se suivre. Un décrochement
 * signalerait un éclairage qui dépend de l'endroit d'où l'on regarde — l'erreur à ne
 * pas commettre, celle qui casserait toute la cohérence de l'espace cousu.
 *
 * Exemples
 *   node tools/light.mjs
 *   node tools/light.mjs --from 2 --to -1 --step 50 --pitch -0.6
 */

import { open, decode } from './lib/harness.mjs'

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

/** Distances au plan de la couture, en mètres : positif = avant, négatif = après. */
const from = flag('from', 1.5)
const to = flag('to', -0.8)
/** Pas, en millimètres. */
const step = flag('step', 50)
/** Regard incliné vers le bas par défaut : c'est au sol que la flaque se voit. */
const pitch = flag('pitch', -0.6)

/** Moyennes par canal, sur l'image entière. */
function channels(image) {
  const { width, height, channels: n, data } = image
  let r = 0
  let g = 0
  let b = 0
  const count = width * height
  for (let i = 0; i < count; i++) {
    r += data[i * n]
    g += data[i * n + 1]
    b += data[i * n + 2]
  }
  return { r: r / count, g: g / count, b: b / count, lum: (r + g + b) / (3 * count) }
}

const session = await open({ width: 480, height: 300, port: 9404 })
const rows = []

try {
  const seam = await session.seam()
  await session.pose({
    x: seam.cx + seam.nx * from,
    z: seam.cz + seam.nz * from,
    forward: [-seam.nx, pitch, -seam.nz],
  })

  const steps = Math.round(((from - to) * 1000) / step)
  for (let i = 0; i <= steps; i++) {
    const state = await session.state()
    const f = state.forward
    await session.face([f.x, pitch, f.z])
    const px = channels(decode(await session.shot()))
    rows.push({
      distance: from - (i * step) / 1000,
      cell: state.cell,
      crossings: state.crossings,
      ...px,
      // Rapport chaud/froid : au-dessus de 1, la lumière est ambrée ; en dessous,
      // bleutée. C'est le témoin le plus lisible du passage de la lumière.
      warmth: px.b > 1 ? px.r / px.b : 0,
    })
    await session.face([f.x, f.y, f.z])
    await session.walk(step / 1000)
  }
} finally {
  await session.close()
}

// --- Le profil ---------------------------------------------------------------

console.log('distance  cellule  luminance                         R     V     B   chaleur')
console.log('  ' + '─'.repeat(76))
for (const r of rows) {
  const bar = '█'.repeat(Math.round(r.lum / 2))
  const mark = r.distance <= 0 && r.distance + step / 1000 > 0 ? ' ←' : ''
  console.log(
    `${r.distance.toFixed(3).padStart(7)}m  ${r.cell.padEnd(7)}  ${r.lum.toFixed(1).padStart(5)} ${bar.padEnd(26)}` +
      ` ${r.r.toFixed(0).padStart(5)} ${r.g.toFixed(0).padStart(5)} ${r.b.toFixed(0).padStart(5)}` +
      ` ${r.warmth.toFixed(2).padStart(7)}${mark}`,
  )
}

// --- Ce qu'on en conclut -----------------------------------------------------

const first = rows[0]
const last = rows.at(-1)
console.log(
  `\nchaleur : ${first.warmth.toFixed(2)} au départ (${first.cell})` +
    ` → ${last.warmth.toFixed(2)} à l'arrivée (${last.cell})`,
)

let worst = { jump: 0, at: 0, crossing: false }
for (let i = 1; i < rows.length; i++) {
  const jump = Math.abs(rows[i].lum - rows[i - 1].lum)
  if (jump > worst.jump) {
    worst = {
      jump,
      at: rows[i].distance,
      crossing: rows[i].crossings > rows[i - 1].crossings,
    }
  }
}
console.log(
  `saut de luminance maximal : ${worst.jump.toFixed(2)} à ${worst.at.toFixed(3)} m` +
    (worst.crossing ? ' — **pendant la traversée**' : ' (hors traversée)'),
)
if (worst.crossing && worst.jump > 4) {
  console.log(
    "l'éclairage décroche au franchissement : il dépend probablement du point de vue.",
  )
  process.exitCode = 1
}
