/**
 * Une pose, tous ses chiffres, et son image.
 *
 * Le petit outil que j'ai réécrit trois fois à la main avant de l'installer ici :
 * placer l'œil à un endroit précis, et voir d'un coup ce que le moteur en fait —
 * combien de passes, quelle profondeur atteinte, combien de bouches écartées, et à
 * quoi ressemble l'image.
 *
 * Les distances sont comptées **le long de la normale de la couture**, en mètres,
 * positif avant et négatif après. Jamais en coordonnées du monde : le plan des
 * coutures a déjà bougé une fois et tous les repères figés se sont mis à mesurer
 * autre chose sans rien signaler.
 *
 * Exemples
 *   node tools/pose.mjs 0.5
 *   node tools/pose.mjs 0 1e-6 -1e-6 --pitch -0.6
 *   node tools/pose.mjs 0.12 --pitch -0.6 --depth 0
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { open, decode, stats } from './lib/harness.mjs'

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

const distances = argv
  .filter((a, i) => !a.startsWith('--') && !consumed.has(i) && !Number.isNaN(Number(a)))
  .map(Number)
if (distances.length === 0) distances.push(0.5)

const pitch = flag('pitch', 0)
const depth = flag('depth', 3)

const session = await open({ width: 480, height: 300, port: 9405 })
mkdirSync('tools/out', { recursive: true })

try {
  const seam = await session.seam()
  await session.depth(depth)
  console.log(
    `couture en (${seam.cx}, ${seam.cz}), normale (${seam.nx}, ${seam.nz})` +
      ` · tangage ${pitch} · profondeur max ${depth}\n`,
  )
  console.log('  distance  cellule  passes  atteinte  écartées  relief  teintes  moyenne RVB')
  console.log('  ' + '─'.repeat(78))

  for (const d of distances) {
    // Garde-fou appris à mes dépens : une position au plan de la couture ou au-delà,
    // tout en restant rattachée à la cellule de départ, est un état que la marche ne
    // produit jamais. La mesurer donne des résultats qui n'ont aucun sens — un faux
    // échec, puis un faux succès.
    if (d <= 1e-4) {
      console.log(
        `  ${String(d).padStart(8)}  ⚠ au plan ou au-delà : état inatteignable en marchant,` +
          ` les chiffres qui suivent ne veulent rien dire`,
      )
    }
    await session.pose({
      x: seam.cx + seam.nx * d,
      z: seam.cz + seam.nz * d,
      forward: [-seam.nx, pitch, -seam.nz],
    })
    const png = await session.shot()
    const image = decode(png)
    const px = stats(image)
    const st = await session.state()

    // Moyenne par canal : c'est ce qui permet de reconnaître un aplat d'effacement,
    // dont la teinte est celle du brouillard encodée en gamma.
    let r = 0
    let g = 0
    let b = 0
    const count = image.width * image.height
    for (let i = 0; i < count; i++) {
      r += image.data[i * image.channels]
      g += image.data[i * image.channels + 1]
      b += image.data[i * image.channels + 2]
    }

    const name = `tools/out/pose-${String(d).replace(/[.\-+]/g, '_')}.png`
    writeFileSync(name, png)
    console.log(
      `  ${String(d).padStart(8)}  ${st.cell.padEnd(7)}  ${String(st.stats.passes).padStart(6)}` +
        `  ${String(st.stats.deepest).padStart(8)}  ${String(st.stats.skipped).padStart(8)}` +
        `  ${px.spread.toFixed(1).padStart(6)}  ${String(px.colours).padStart(7)}` +
        `  ${(r / count).toFixed(0).padStart(3)} ${(g / count).toFixed(0).padStart(3)} ${(b / count).toFixed(0).padStart(3)}` +
        `  ${name}`,
    )
  }
} finally {
  await session.close()
}
