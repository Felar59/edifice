/**
 * Où deux images diffèrent, et de combien.
 *
 * Le test de torture sait dire *si* quelque chose a changé — il compare des
 * statistiques et des empreintes. Il ne sait pas dire *où*. Cet outil produit une
 * image de différence amplifiée et la boîte englobante des pixels touchés, ce qui
 * transforme « le relief est passé de 21,5 à 19,0 » en « la moitié droite de
 * l'ouverture a changé ».
 *
 * Deux usages :
 *
 *   deux fichiers   comparer une capture actuelle à une capture d'avant
 *   deux poses      comparer deux points de vue du même monde, par exemple pour
 *                   vérifier qu'une symétrie est bien respectée
 *
 * Exemples
 *   node tools/diff.mjs shots/4-recursion.png tools/out/avant.png
 *   node tools/diff.mjs --pose -5.13 --pose -5.12
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { decode } from '../scripts/png.mjs'
import { difference, encode } from './lib/image.mjs'
import { open } from './lib/harness.mjs'

const argv = process.argv.slice(2)
const poses = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--pose') poses.push(Number(argv[i + 1]))
}
const files = argv.filter((a) => a.endsWith('.png'))
const gainIndex = argv.indexOf('--gain')
const gain = gainIndex < 0 ? 8 : Number(argv[gainIndex + 1])

mkdirSync('tools/out', { recursive: true })

let a
let b
let what

if (poses.length === 2) {
  const session = await open({ width: 640, height: 400, port: 9403 })
  try {
    const seam = await session.seam()
    const shots = []
    for (const z of poses) {
      // La coordonnée donnée est comptée le long de la normale de la couture, donc
      // elle reste valable même si le plan des coutures se déplace.
      await session.pose({ x: seam.cx, z, forward: [-seam.nx, 0, -seam.nz] })
      shots.push(decode(await session.shot()))
    }
    ;[a, b] = shots
    what = `poses z=${poses[0]} et z=${poses[1]}`
  } finally {
    await session.close()
  }
} else if (files.length === 2) {
  a = decode(readFileSync(files[0]))
  b = decode(readFileSync(files[1]))
  what = `${files[0]} et ${files[1]}`
} else {
  console.error(
    'usage : node tools/diff.mjs <a.png> <b.png> [--gain n]\n' +
      '        node tools/diff.mjs --pose <z> --pose <z> [--gain n]',
  )
  process.exit(1)
}

const result = difference(a, b, { gain })
writeFileSync('tools/out/diff.png', encode(result.image))

console.log(`différence entre ${what}`)
console.log(`  écart maximal      ${result.max} / 765`)
console.log(`  écart moyen        ${result.mean.toFixed(2)}`)
console.log(`  pixels touchés     ${(result.changedFraction * 100).toFixed(2)} %`)
if (result.box) {
  const { minX, minY, maxX, maxY } = result.box
  console.log(
    `  zone concernée     x ${minX}–${maxX}, y ${minY}–${maxY}` +
      ` (${maxX - minX + 1}×${maxY - minY + 1})`,
  )
} else {
  console.log('  zone concernée     aucune : les images sont identiques à deux niveaux près')
}
console.log(`  image (gain ×${gain})  tools/out/diff.png`)
