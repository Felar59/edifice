import './style.css'

import { initGpu } from './render/gpu'
import { Renderer } from './render/renderer'
import { Player, PRESETS } from './player/player'
import { CUBE_SIZE, Projectiles } from './player/projectiles'
import { buildWorld } from './world/world'
import { buildCube } from './world/geometry'
import { Hud } from './ui/hud'
import { runSelfTest, type Check } from './dev/selftest'

/**
 * Prise de contrôle exposée à la page.
 *
 * Elle sert au script de test (`npm run torture`) : sans elle, il faudrait
 * simuler des mouvements de souris et espérer tomber au bon endroit, alors qu'on
 * veut des points de vue **exactement** reproductibles d'une exécution à l'autre
 * pour pouvoir comparer les captures.
 */
interface DevHook {
  frames: number
  selfTest: () => Check[]
  goTo: (index: number) => void
  look: (dx: number, dy: number) => void
  throwCube: () => void
  setDepth: (n: number) => void
  /**
   * Distance signée minimale du visiteur aux plans des bouches de sa cellule.
   *
   * Doit rester strictement positive : atteindre le plan sans avoir changé de
   * cellule est l'état dégénéré où l'ouverture est vue par la tranche, donc de
   * surface projetée nulle, donc invisible.
   */
  clearance: () => number
  /** Facteur appliqué à la lumière transmise par les ouvertures. */
  setTransmission: (factor: number) => void
  /** Où se trouve la bouche par laquelle on quitte le hall vers le nord. */
  seam: () => { cx: number; cy: number; cz: number; nx: number; ny: number; nz: number }
  /** Avance dans la direction du regard, par le vrai code de déplacement. */
  walk: (metres: number) => void
  /** Oriente le regard sans bouger. */
  face: (fx: number, fy: number, fz: number) => void
  /** Placement exact, pour sonder les cas limites au dixième de millimètre. */
  teleport: (cell: string, x: number, y: number, z: number, fx: number, fy: number, fz: number) => void
  /** Masque l'écran d'entrée et les panneaux, pour des captures propres. */
  setChrome: (visible: boolean) => void
  state: () => unknown
}

declare global {
  interface Window {
    __edifice?: DevHook
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const overlay = document.querySelector<HTMLElement>('#overlay')!
const errorBox = document.querySelector<HTMLElement>('#error')!

/** Le rendu par récursion allouant une cible plein écran par niveau, on borne la densité. */
const MAX_DPR = 2

main().catch((err: unknown) => {
  overlay.hidden = true
  errorBox.hidden = false
  errorBox.textContent = err instanceof Error ? err.message : String(err)
  console.error(err)
})

async function main(): Promise<void> {
  const { device, context, format } = await initGpu(canvas)

  const renderer = new Renderer(device, context, format)
  const world = buildWorld()
  renderer.setWorld(world, buildCube(CUBE_SIZE, [0.78, 0.5, 0.26]))

  const player = new Player()
  const projectiles = new Projectiles()
  const hud = new Hud()
  const keys = new Set<string>()

  resize()
  window.addEventListener('resize', resize)

  // --- Souris capturée ------------------------------------------------------
  overlay.addEventListener('click', () => void canvas.requestPointerLock())
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock()
  })
  document.addEventListener('pointerlockchange', () => {
    overlay.hidden = document.pointerLockElement === canvas
  })
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) player.look(e.movementX, e.movementY)
  })

  // --- Clavier --------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault()

    // Avec un clavier AZERTY, avancer se fait sur la touche physique `KeyW`, qui
    // porte un Z. Tenir Ctrl en marchant déclenche donc l'annulation du navigateur.
    // On l'étouffe, ainsi que le rétablissement, et on ne traite aucun raccourci
    // tant qu'un modificateur est enfoncé — de sorte que Ctrl+R, F12 et les autres
    // raccourcis du navigateur continuent de fonctionner normalement.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') e.preventDefault()
      return
    }

    keys.add(e.code)

    switch (e.code) {
      case 'KeyF':
        projectiles.throwFrom(player, world)
        break
      case 'KeyR':
        projectiles.clear()
        break
      case 'KeyH':
        hud.toggle()
        break
      case 'BracketLeft':
        renderer.maxDepth = Math.max(0, renderer.maxDepth - 1)
        break
      case 'BracketRight':
        renderer.maxDepth = Math.min(8, renderer.maxDepth + 1)
        break
      default: {
        const digit = /^Digit([1-9])$/.exec(e.code)
        const preset = digit ? PRESETS[Number(digit[1]) - 1] : undefined
        if (preset) player.goTo(preset)
      }
    }
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())

  // --- Prise de contrôle pour le script de test -----------------------------
  const hook: DevHook = {
    frames: 0,
    selfTest: () => runSelfTest(world),
    goTo: (index) => {
      const preset = PRESETS[index]
      if (preset) player.goTo(preset)
    },
    look: (dx, dy) => player.look(dx, dy),
    throwCube: () => projectiles.throwFrom(player, world),
    setDepth: (n) => {
      renderer.maxDepth = n
    },
    clearance: () => {
      const cell = world.cells.get(player.cell)!
      let least = Infinity
      for (const passage of cell.passages) {
        const m = passage.from
        const d =
          m.normal.x * (player.pos.x - m.center.x) +
          m.normal.y * (player.pos.y - m.center.y) +
          m.normal.z * (player.pos.z - m.center.z)
        if (d < least) least = d
      }
      return least
    },
    setTransmission: (factor) => {
      renderer.transmission = factor
    },
    seam: () => {
      // Le script de balayage doit se placer par rapport à la couture, et non à une
      // coordonnée écrite en dur : l'épaisseur des parois a déjà déplacé ce plan une
      // fois, et un test qui n'en tient pas compte se met à mesurer autre chose.
      const mouth = world.cells.get('hall')!.passages[0]!.from
      return {
        cx: mouth.center.x, cy: mouth.center.y, cz: mouth.center.z,
        nx: mouth.normal.x, ny: mouth.normal.y, nz: mouth.normal.z,
      }
    },
    walk: (metres) => player.walk(world, metres),
    face: (fx, fy, fz) => player.face({ x: fx, y: fy, z: fz }),
    teleport: (cell, x, y, z, fx, fy, fz) => {
      player.goTo({ name: 'sonde', cell, pos: { x, y, z }, forward: { x: fx, y: fy, z: fz } })
    },
    setChrome: (visible) => {
      overlay.hidden = !visible
      hud.setVisible(visible)
    },
    state: () => ({
      cell: player.cell,
      pos: player.pos,
      forward: player.forward,
      up: player.up,
      crossings: player.crossings,
      stats: renderer.getStats(),
    }),
  }
  window.__edifice = hook

  // --- Boucle ---------------------------------------------------------------
  let previous = performance.now()
  let fps = 0

  const frame = (now: number): void => {
    // Onglet en arrière-plan, point d'arrêt dans le débogueur : un pas de temps
    // énorme traverserait les murs. On le borne.
    const dt = Math.min((now - previous) / 1000, 1 / 20)
    previous = now
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1

    player.update(dt, world, keys)
    projectiles.update(dt, world)

    renderer.render(
      { cell: player.cell, pos: player.pos, forward: player.forward, up: player.up },
      projectiles.toRenderList(),
    )

    hud.update({
      fps,
      cell: player.cell,
      pos: player.pos,
      crossings: player.crossings,
      maxDepth: renderer.maxDepth,
      projectiles: projectiles.count,
      stats: renderer.getStats(),
    })

    hook.frames++
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
    canvas.width = width
    canvas.height = height
    renderer.resize(width, height)
  }
}
