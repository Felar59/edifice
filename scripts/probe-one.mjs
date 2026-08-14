import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { launch } from './browser.mjs'
import { decode, stats } from './png.mjs'
const URL = 'http://localhost:5190/'
async function wait(u, n = 80) { for (let i = 0; i < n; i++) { try { if ((await fetch(u)).ok) return } catch {} await new Promise(r => setTimeout(r, 250)) } throw new Error('pas de serveur') }
const vite = spawn('npm', ['run', 'dev'], { stdio: 'ignore', shell: true })
let b
try {
  await wait(URL)
  b = await launch(URL, { width: 480, height: 300, port: 9336 })
  await b.waitFor('() => !!window.__edifice')
  await b.eval('window.__edifice.setChrome(false)')
  const seam = await b.eval('window.__edifice.seam()')
  // 2 mm avant la couture, regard vers l'avant en piquant du nez.
  const z = seam.cz + 0.002
  for (const pitch of [0, -0.2, -0.35, -0.5, -0.8]) {
    for (const depth of [3, 0]) {
      await b.eval(`window.__edifice.setDepth(${depth})`)
      await b.eval(`window.__edifice.teleport('hall', 0, 1.65, ${z}, 0, ${pitch}, -1)`)
      const png = await b.screenshotStable(3)
      const px = stats(decode(png))
      const st = await b.eval('window.__edifice.state()')
      console.log(`tangage ${String(pitch).padStart(5)} · profondeur max ${depth} · relief ${px.spread.toFixed(1).padStart(5)} · passes ${st.stats.passes} · atteinte ${st.stats.deepest} · écartées ${st.stats.skipped}`)
      if (pitch === -0.5) writeFileSync(`shots/probe-p${pitch}-d${depth}.png`, png)
    }
  }
} finally { await b?.close(); vite.kill() }
