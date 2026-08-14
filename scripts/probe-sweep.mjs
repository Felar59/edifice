/**
 * Recherche exhaustive de la zone grise du franchissement.
 *
 * Le balayage du test de torture ne regarde que deux directions : dans l'axe de la
 * marche et perpendiculairement. Ça n'a pas suffi à reproduire le défaut signalé,
 * donc on élargit : à chaque millimètre de la traversée, on fait tourner le regard
 * sur trois cent soixante degrés et sur plusieurs inclinaisons, et on garde le pire.
 *
 * Script de diagnostic, pas de non-régression : il est lent et on l'appelle à la
 * main quand quelque chose résiste.
 *
 * Usage : node scripts/probe-sweep.mjs
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { launch } from './browser.mjs'
import { decode, stats } from './png.mjs'

const URL = 'http://localhost:5190/'

async function waitForServer(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* le serveur démarre encore */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('pas de serveur')
}

const vite = spawn('npm', ['run', 'dev'], { stdio: 'ignore', shell: true })
let browser

try {
  await waitForServer(URL)
  browser = await launch(URL, { width: 320, height: 200, port: 9335 })
  await browser.waitFor('() => !!window.__edifice')
  await browser.eval('window.__edifice.setChrome(false)')

  const seam = await browser.eval('window.__edifice.seam()')
  console.log(`couture en (${seam.cx}, ${seam.cz}), normale (${seam.nx}, ${seam.nz})`)

  const YAWS = 24 // pas de 15°
  const PITCHES = [0, -0.5, 0.5]

  let worst = { relief: Infinity, mm: 0, yaw: 0, pitch: 0, png: null, cell: '' }
  const lowByMillimetre = new Map()

  // On part quinze millimètres avant la couture et on avance de quarante millimètres.
  const startX = seam.cx + seam.nx * 0.015
  const startZ = seam.cz + seam.nz * 0.015
  await browser.eval(
    `window.__edifice.teleport('${seam.cell}', ${startX}, 1.65, ${startZ}, ${-seam.nx}, 0, ${-seam.nz})`,
  )

  for (let mm = 0; mm <= 40; mm++) {
    const state = await browser.eval('window.__edifice.state()')
    let lowest = Infinity

    for (let i = 0; i < YAWS; i++) {
      const angle = (i / YAWS) * Math.PI * 2
      for (const pitch of PITCHES) {
        const fx = Math.sin(angle)
        const fz = -Math.cos(angle)
        await browser.eval(`window.__edifice.face(${fx}, ${pitch}, ${fz})`)
        const png = await browser.screenshotStable(2)
        const px = stats(decode(png))
        if (px.spread < lowest) lowest = px.spread
        if (px.spread < worst.relief) {
          worst = {
            relief: px.spread,
            mm,
            yaw: Math.round((angle * 180) / Math.PI),
            pitch,
            png,
            cell: state.cell,
          }
        }
      }
    }
    lowByMillimetre.set(mm, lowest)

    // Remettre le regard dans l'axe de la marche avant d'avancer.
    await browser.eval(
      `window.__edifice.face(${state.forward.x}, ${state.forward.y}, ${state.forward.z})`,
    )
    await browser.eval('window.__edifice.walk(0.001)')
  }

  console.log('\nrelief minimal par millimètre (toutes directions confondues) :')
  for (const [mm, relief] of lowByMillimetre) {
    const bar = '█'.repeat(Math.max(0, Math.round(relief)))
    console.log(`  ${String(mm).padStart(2)} mm  ${relief.toFixed(1).padStart(5)}  ${bar}`)
  }

  console.log(
    `\npire cas : relief ${worst.relief.toFixed(1)} au mm ${worst.mm}` +
      ` (cellule ${worst.cell}), lacet ${worst.yaw}°, tangage ${worst.pitch}`,
  )
  if (worst.png) {
    writeFileSync('shots/probe-pire-cas.png', worst.png)
    console.log('image du pire cas : shots/probe-pire-cas.png')
  }
} finally {
  await browser?.close()
  vite.kill()
}
