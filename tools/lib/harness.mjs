/**
 * L'échafaudage commun à tous les outils de l'atelier.
 *
 * Sans lui, chaque sonde recommence les mêmes trente lignes : démarrer le serveur,
 * attendre qu'il réponde, lancer le navigateur, attendre le crochet de la page,
 * masquer l'interface. Je l'ai réécrit trois fois dans la même séance avant de le
 * mettre ici.
 *
 * Deux détails qui font gagner du temps :
 *
 *  — Le serveur n'est démarré que s'il ne répond pas déjà. Quand un `npm run dev`
 *    tourne dans un autre terminal, les outils s'y branchent au lieu d'échouer sur
 *    un port occupé.
 *  — Chaque outil prend son propre port de débogage, pour qu'on puisse en lancer
 *    deux en parallèle sans qu'ils se marchent dessus.
 */

import { spawn } from 'node:child_process'
import { launch } from '../../scripts/browser.mjs'
import { decode, stats } from '../../scripts/png.mjs'

const URL = 'http://localhost:5190/'

async function responds(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await responds(URL)) return null

  const proc = spawn('npm', ['run', 'dev'], { stdio: 'ignore', shell: true })
  for (let i = 0; i < 80; i++) {
    if (await responds(URL)) return proc
    await new Promise((r) => setTimeout(r, 250))
  }
  proc.kill()
  throw new Error(`le serveur de développement n'a pas répondu sur ${URL}`)
}

/**
 * Habillage du navigateur, mesuré : la fenêtre demandée n'est pas la vue obtenue.
 *
 * Il faut le compenser, sans quoi `width` et `height` mentent. Une fenêtre de
 * 400 × 250 ne donne que 400 × 111 de vue utile, et les captures se retrouvent
 * aplaties au point qu'une planche de contact devient illisible — c'est ce qui
 * arrivait avant cette correction.
 *
 * Chrome refuse par ailleurs de descendre sous une certaine largeur, d'où le
 * plancher.
 */
const CHROME = { width: 24, height: 139 }
const MIN_WINDOW_WIDTH = 500

/**
 * Ouvre une session de mise au point.
 *
 * `width` et `height` sont ceux de la **vue**, pas de la fenêtre. Le nom `port` est
 * celui du protocole DevTools, pas celui du site : chaque outil doit prendre le sien.
 */
export async function open({ width = 640, height = 400, port = 9400 } = {}) {
  const server = await ensureServer()
  const browser = await launch(URL, {
    width: Math.max(width + CHROME.width, MIN_WINDOW_WIDTH),
    height: height + CHROME.height,
    port,
  })

  let viewport = [width, height]
  let referenceSeam = null
  try {
    await browser.waitFor('() => !!window.__edifice')
    await browser.eval('window.__edifice.setChrome(false)')

    // On vérifie plutôt que de faire confiance à une constante mesurée un jour sur
    // une version donnée : si l'habillage change, autant le savoir tout de suite.
    viewport = await browser.eval('[window.innerWidth, window.innerHeight]')
    if (Math.abs(viewport[1] - height) > 2) {
      console.warn(
        `vue ${viewport[0]}×${viewport[1]} au lieu de ${width}×${height} :` +
          ` l'habillage du navigateur a changé, corriger CHROME dans tools/lib/harness.mjs`,
      )
    }
  } catch (err) {
    await browser.close()
    server?.kill()
    throw err
  }

  const session = {
    /** Dimensions réelles de la vue, telles que la page les voit. */
    width: viewport[0],
    height: viewport[1],
    raw: browser,

    /** Évalue une expression dans la page. */
    eval: (expression) => browser.eval(expression),

    /** L'état du visiteur et les compteurs du rendu. */
    state: () => browser.eval('window.__edifice.state()'),

    /** Où se trouve la couture par laquelle on quitte le hall. */
    seam: () => browser.eval('window.__edifice.seam()'),

    /**
      * Place l'œil exactement, avec sa direction de regard.
      *
      * La cellule par défaut est celle de la couture de référence, demandée au moteur.
      * Elle valait « hall » en dur, ce qui a cessé de désigner quoi que ce soit le jour
      * où le monde est devenu une rotonde : la page levait alors une exception à chaque
      * image, sans rien peindre et sans que les outils sachent pourquoi.
      */
    async pose({ cell, x, y = 1.65, z, forward = [0, 0, -1] }) {
      referenceSeam ??= await browser.eval('window.__edifice.seam()')
      cell ??= referenceSeam.cell
      const [fx, fy, fz] = forward
      await browser.eval(
        `window.__edifice.teleport('${cell}', ${x}, ${y}, ${z}, ${fx}, ${fy}, ${fz})`,
      )
    },

    /** Oriente le regard sans bouger. */
    face: ([fx, fy, fz]) => browser.eval(`window.__edifice.face(${fx}, ${fy}, ${fz})`),

    /** Avance dans la direction du regard, par le vrai code de déplacement. */
    walk: (metres) => browser.eval(`window.__edifice.walk(${metres})`),

    /** Profondeur de récursion maximale — zéro désactive les coutures. */
    depth: (n) => browser.eval(`window.__edifice.setDepth(${n})`),

    throwCube: () => browser.eval('window.__edifice.throwCube()'),

    /** Les invariants vérifiés par le calcul, tels que la page les rend. */
    selfTest: () => browser.eval('window.__edifice.selfTest()'),

    /** Une capture, en octets PNG. */
    shot: () => browser.screenshotStable(2),

    /** Une capture, décodée et mesurée. */
    async measure() {
      const png = await browser.screenshotStable(2)
      const image = decode(png)
      return { png, image, ...stats(image) }
    },

    /** Les messages de la console depuis l'ouverture. */
    logs: () => browser.logs,

    async close() {
      await browser.close()
      server?.kill()
    },
  }

  return session
}

export { decode, stats }
