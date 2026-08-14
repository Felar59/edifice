// Pilotage minimal d'Edge/Chrome via le protocole DevTools, en WebSocket brut.
// Évite d'ajouter Playwright (~300 Mo) pour de simples captures d'écran.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

function findBrowser() {
  for (const p of EDGE_PATHS) if (existsSync(p)) return p
  throw new Error('Ni Edge ni Chrome trouvé.')
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return await r.json()
    } catch {
      /* le navigateur n'écoute pas encore */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Pas de réponse de ${url}`)
}

export async function launch(url, { width = 1440, height = 810, port = 9333 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'museum-shot-'))
  const proc = spawn(
    findBrowser(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      '--force-device-scale-factor=1',
      // WebGPU n'est pas activé par défaut en mode sans interface.
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      url,
    ],
    { stdio: 'ignore', detached: false },
  )

  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`)
  const target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!target) throw new Error('Aucun onglet exploitable')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })

  let id = 0
  const pending = new Map()
  const logs = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push({
        level: msg.params.type,
        text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      })
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push({
        level: 'error',
        text: msg.params.exceptionDetails.exception?.description ?? 'exception',
      })
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'erreur JS')
    }
    return r.result?.value
  }

  return {
    eval: evaluate,
    logs,

    /**
     * Clic « de confiance », indispensable pour tout ce qui exige un geste
     * utilisateur — le verrouillage du pointeur refuse un `element.click()`
     * synthétique. On passe donc par le protocole plutôt que par le DOM.
     */
    async click(x, y) {
      const base = { x, y, button: 'left', clickCount: 1, buttons: 1 }
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
    },

    /** Frappe de confiance. `code` au sens KeyboardEvent.code. */
    async press(code, { key = code, keyCode = 0, modifiers = 0 } = {}) {
      const base = { code, key, windowsVirtualKeyCode: keyCode, modifiers }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    },

    async waitFor(predicate, timeout = 20000) {
      const t0 = Date.now()
      while (Date.now() - t0 < timeout) {
        try {
          if (await evaluate(`(${predicate})()`)) return true
        } catch {
          /* la page n'est pas encore prête */
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      throw new Error(`Délai dépassé : ${predicate}`)
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      return Buffer.from(data, 'base64')
    },

    /**
     * Capture en s'assurant que plusieurs images ont bien été peintes depuis le
     * dernier changement d'état.
     *
     * L'ancien contrôle par luminosité du canevas ne s'applique plus : on ne peut
     * pas relire un canevas WebGPU avec `getImageData`. On s'appuie donc sur le
     * compteur d'images que la page expose elle-même.
     */
    async screenshotStable(minFrames = 4, timeout = 8000) {
      const start = await evaluate('window.__edifice?.frames ?? 0')
      const t0 = Date.now()
      while (Date.now() - t0 < timeout) {
        const now = await evaluate('window.__edifice?.frames ?? 0')
        if (now - start >= minFrames) {
          const { data } = await send('Page.captureScreenshot', { format: 'png' })
          return Buffer.from(data, 'base64')
        }
        await new Promise((r) => setTimeout(r, 80))
      }
      throw new Error("la page n'a pas peint d'image nouvelle")
    },
    async close() {
      ws.close()
      proc.kill()
    },
  }
}
