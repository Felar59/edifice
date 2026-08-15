/**
 * Planche de contact : un balayage entier dans une seule image.
 *
 * L'outil que j'aurais dû écrire en premier. Une transition étalée sur quarante
 * captures demande quarante lectures, interdit toute comparaison, et un accident
 * d'une seule image y passe inaperçu. Sur une planche, il saute aux yeux.
 *
 * Trois balayages, qui correspondent aux trois questions que je me pose vraiment :
 *
 *   crossing  on marche à travers une couture, millimètre par millimètre.
 *             « la transition est-elle propre ? »
 *   orbit     on tourne le regard sur place, par pas de quinze degrés.
 *             « la couture tient-elle sous tous les angles ? »
 *   depth     on fait varier la profondeur de récursion à une pose donnée.
 *             « où la récursion se coupe-t-elle, et cela se voit-il ? »
 *   jump      un saut complet, image par image, à la cadence réelle.
 *             « le saut a-t-il la bonne sensation ? »
 *
 * Exemples
 *   node tools/sheet.mjs crossing
 *   node tools/sheet.mjs crossing --pitch -0.5 --steps 30
 *   node tools/sheet.mjs orbit --at centre
 *   node tools/sheet.mjs depth --at nez
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { open, decode } from './lib/harness.mjs'
import { contactSheet, encode } from './lib/image.mjs'

const argv = process.argv.slice(2)
/** Les valeurs consommées par une option ne doivent pas être relues comme argument. */
const consumed = new Set()
argv.forEach((a, i) => {
  if (a.startsWith('--')) consumed.add(i + 1)
})

const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'crossing'

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0 || i + 1 >= argv.length) return fallback
  const raw = argv[i + 1]
  return Number.isNaN(Number(raw)) ? raw : Number(raw)
}

const steps = flag('steps', mode === 'orbit' ? 24 : 40)
const pitch = flag('pitch', 0)
const millimetres = flag('mm', 1)
const at = flag('at', 'seam')
const out = flag('out', `tools/out/${mode}.png`)

/**
 * Les poses de départ sont **déduites du monde**, jamais écrites en dur : le plan
 * des coutures a déjà bougé une fois quand les parois ont pris de l'épaisseur, et
 * tous les repères codés en dur se sont mis à mesurer autre chose.
 */
function poseFor(name, seam) {
  const before = (metres) => ({
    x: seam.cx + seam.nx * metres,
    z: seam.cz + seam.nz * metres,
    forward: [-seam.nx, pitch, -seam.nz],
  })
  switch (name) {
    case 'nez': return before(0.12)
    case 'embrasure': return before(0.005)
    case 'recursion': return before(13.4)
    // Le centre de la rotonde : d'où l'on voit la couronne des huit portes.
    case 'centre': return before(7.25)
    case 'seam':
    default: return before(0.015)
  }
}

const session = await open({ width: 400, height: 250, port: 9401 })
const labels = []
const frames = []

try {
  const seam = await session.seam()
  const start = poseFor(at, seam)
  await session.pose(start)

  if (mode === 'crossing') {
    for (let i = 0; i < steps; i++) {
      const state = await session.state()
      // Regarder dans la direction voulue, puis remettre le regard dans l'axe de la
      // marche : c'est elle qui doit rester maîtresse du parcours.
      const f = state.forward
      if (pitch !== 0) await session.face([f.x, pitch, f.z])
      frames.push(decode(await session.shot()))
      labels.push(`${i * millimetres} mm · ${state.cell}`)
      if (pitch !== 0) await session.face([f.x, f.y, f.z])
      await session.walk(millimetres / 1000)
    }
  } else if (mode === 'orbit') {
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2
      await session.face([Math.sin(angle), pitch, -Math.cos(angle)])
      frames.push(decode(await session.shot()))
      labels.push(`${Math.round((angle * 180) / Math.PI)}°`)
    }
  } else if (mode === 'jump') {
    // Un saut complet, image par image, à la cadence réelle. C'est la seule façon de
    // juger la *sensation* : une courbe de hauteur ne dit pas si le saut est mou.
    // On suspend la simulation : sinon la boucle d'animation continue de faire avancer
    // le temps entre deux captures, et un saut d'une demi-seconde se joue pendant qu'on
    // photographie — on n'en attrape alors que trois images au hasard.
    await session.eval('window.__edifice.setPaused(true)')
    // Une image pour se poser : après un placement le corps n'est pas encore au sol, et
    // on ne saute que du sol.
    await session.eval('window.__edifice.tick(1/60)')
    await session.eval("window.__edifice.tick(1/60, ['Space'])")
    for (let i = 0; i < steps; i++) {
      const state = await session.state()
      frames.push(decode(await session.shot()))
      labels.push(`${(state.pos.y - 1.65).toFixed(2)} m · ${state.grounded ? 'au sol' : 'en l’air'}`)
      await session.eval('window.__edifice.tick(1/60)')
    }
    await session.eval('window.__edifice.setPaused(false)')
  } else if (mode === 'depth') {
    for (let d = 0; d <= Math.min(steps, 6); d++) {
      await session.depth(d)
      frames.push(decode(await session.shot()))
      labels.push(`profondeur ${d}`)
    }
    await session.depth(3)
  } else {
    throw new Error(`balayage inconnu : ${mode} (crossing, orbit, depth ou jump)`)
  }
} finally {
  await session.close()
}

mkdirSync('tools/out', { recursive: true })
const sheet = contactSheet(frames, { columns: Math.min(8, frames.length) })
writeFileSync(out, encode(sheet))

console.log(`${frames.length} vignettes · ${sheet.width}×${sheet.height} · ${out}`)
console.log('\nordre de lecture, ligne par ligne :')
labels.forEach((label, i) => {
  const end = i % 8 === 7 || i === labels.length - 1 ? '\n' : '  '
  process.stdout.write(`${String(i).padStart(3)}. ${label.padEnd(18)}${end}`)
})
