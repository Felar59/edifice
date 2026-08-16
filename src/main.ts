import './style.css'

import { initGpu } from './render/gpu'
import { Renderer } from './render/renderer'
import { Player, presets } from './player/player'
import { castRay } from './world/ray'
import { CUBE_SIZE, Projectiles } from './player/projectiles'
import { Physics } from './player/physique'
import { loadPictures, noPictures } from './render/pictures'
import { Maze } from './machines/wolf3d'
import { Jeu } from './machines/wolf3d-jeu'
import musee from './assets/musee1.png?url'
import julia from './assets/Julia1.png?url'
import hunter from './assets/my_hunter1.png?url'
import myworld from './assets/myworld1.png?url'
import shell from './assets/42sh1.png?url'
import antivirus from './assets/antivirus.png?url'
import physiqueUrl from './player/physique.wasm?url'
import { buildWorld, getLandmarks, HUB } from './world/world'
import { buildCube } from './world/geometry'
import { Hud } from './ui/hud'
import { SettingsPage } from './ui/settings'
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
  /** Plafond du nombre de passes par image — le vrai budget de la récursion. */
  setPasses: (n: number) => void
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
  seam: () => {
    cell: string
    cx: number
    cy: number
    cz: number
    nx: number
    ny: number
    nz: number
  }
  /** Avance dans la direction du regard, par le vrai code de déplacement. */
  walk: (metres: number) => void
  /** Fait avancer le temps de `seconds`, touches enfoncées données. */
  tick: (seconds: number, keys?: string[]) => void
  /**
   * Suspend la simulation sans arrêter le rendu.
   *
   * Sans cela, la boucle d'animation continue de faire avancer le temps entre deux
   * captures : un saut d'une demi-seconde se joue pendant qu'on photographie, et on
   * n'en attrape que trois images au hasard. Suspendre rend le temps pilotable, ce qui
   * servira bien au-delà du saut — les murs mobiles et le tunnel-vrille voudront la
   * même chose.
   */
  setPaused: (paused: boolean) => void
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

  // **Les tableaux.** Leurs couches sont désignées par les matières que le monde pose sur ses
  // cadres, dans l'ordre de cette liste. Un échec de chargement ne doit pas empêcher
  // d'entrer : on se rabat sur un aplat, et le musée reste visitable.
  let pictures = noPictures(device)
  try {
    // Une couche de plus que d'images : c'est l'écran de la machine, réécrit à chaque
    // instant par le projet qui tourne derrière.
    pictures = await loadPictures(device, [musee, julia, hunter, myworld, shell, antivirus], 1)
  } catch (err) {
    console.error('tableaux :', err)
  }
  renderer.setPictures(pictures)

  /**
   * **La première machine.** Le vrai Wolf3D, compilé en WebAssembly, qui bâtit son labyrinthe
   * et le rend par son propre lancer de rayon. S'il ne se charge pas, l'écran reste éteint et
   * le musée se visite quand même : une machine en panne ne ferme pas le bâtiment.
   */
  const MACHINE_LAYER = 6
  let maze: Maze | null = null
  try {
    maze = await Maze.load()
  } catch (err) {
    console.error('wolf3d :', err)
  }

  /**
   * **Et le jeu entier, derrière.** Le noyau ci-dessus tourne dès l'ouverture : c'est
   * l'écran allumé qu'on aperçoit en entrant dans la grande salle. Le jeu complet pèse dix-sept
   * mégaoctets et ne se charge qu'en approchant — le temps de traverser la salle, il tourne, et
   * l'écran passe de la démonstration au vrai jeu sans qu'on ait rien à faire.
   */
  let jeu: Jeu | null = null
  let chargement: Promise<void> | null = null
  const approcher = (): void => {
    if (chargement) return
    chargement = Jeu.charger()
      .then((pret) => {
        jeu = pret
        // Le bouton « Quit » du jeu ne peut pas fermer une fenêtre qui n'existe pas :
        // il ramène au musée. Le jeu redémarre derrière, et l'écran se rallume.
        jeu.auQuitter = () => {
          if (playing) release()
        }
      })
      .catch((err) => {
        // Une machine en panne ne ferme pas le bâtiment : le noyau garde l'écran.
        console.error('wolf3d (jeu entier) :', err)
      })
  }

  /**
   * A-t-on la main sur la machine ?
   *
   * Deux états, et rien entre les deux : ou l'on marche dans le musée, ou l'on joue au jeu.
   * Les touches sont les mêmes des deux côtés, ce qui n'est pas une économie mais une
   * intention — on ne change pas de commandes en s'asseyant devant une machine, on change de
   * ce qu'elles commandent.
   */
  let playing = false

  /**
   * Prendre la machine, et la lâcher.
   *
   * **Le pointeur change de mains.** Le musée le garde verrouillé sur son canevas pour
   * tourner la tête du visiteur ; le jeu, lui, en a besoin des deux façons — un curseur
   * visible pour son menu, des déplacements pour viser. C'est exactement ce que fait un
   * bureau, et la seule manière de le reproduire est de le lui rendre entièrement : on
   * déverrouille en prenant la machine, et le jeu reprend le pointeur lui-même quand il
   * lance une partie. On le récupère en le lâchant.
   */
  const take = (): void => {
    playing = true
    document.body.classList.add('machine')
    // On ne décide pas du pointeur ici : c'est le portage qui rend au jeu l'état
    // exact qu'il avait demandé — libre dans ses menus, verrouillé dans une partie.
    jeu?.prendre()
  }
  const release = (): void => {
    playing = false
    document.body.classList.remove('machine')
    jeu?.lacher()
    // Et l'on reprend le pointeur — à l'image suivante, le temps que le navigateur ait
    // fini de le rendre. Demandé dans la foulée du déverrouillage, il est ignoré.
    requestAnimationFrame(() => void canvas.requestPointerLock())
  }

  /** Le carré de la distance à l'écran, ou l'infini si l'on n'est pas dans sa salle. */
  const toMachine = (): number => {
    const m = getLandmarks()
    if (player.cell !== m.machineCell) return Infinity
    const dx = player.pos.x - m.machinePos.x
    const dy = player.pos.y - m.machinePos.y
    const dz = player.pos.z - m.machinePos.z
    return dx * dx + dy * dy + dz * dz
  }

  /** Est-on assez près de l'écran pour s'en servir ? */
  const atMachine = (): boolean => toMachine() < 25

  const player = new Player()

  // **Le noyau de physique est chargé avant la première image.** Il porte le monde, et un
  // cube lancé avant qu'il ne soit prêt n'aurait nulle part où tomber.
  const physics = await Physics.load(await (await fetch(physiqueUrl)).arrayBuffer())
  physics.setWorld(world)
  const projectiles = new Projectiles(physics)
  const hud = new Hud()
  const keys = new Set<string>()

  // Les paramètres s'appliquent dès leur construction : la page relit la valeur retenue de
  // la visite précédente et la pousse au rendu avant la première image.
  const settings = new SettingsPage((values) => {
    renderer.fovY = (values.fov * Math.PI) / 180
  })

  resize()
  window.addEventListener('resize', resize)

  // --- Souris capturée ------------------------------------------------------
  overlay.addEventListener('click', () => void canvas.requestPointerLock())
  // `Échap` rend déjà la souris ; ici, il referme la page et rend la marche.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && settings.open) settings.setOpen(false)
  })
  canvas.addEventListener('click', () => {
    // Pendant qu'on tient une machine, le pointeur est à elle : le lui reprendre au premier
    // clic dans son menu la rendrait inutilisable.
    if (playing) return
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock()
  })
  document.addEventListener('pointerlockchange', () => {
    // L'écran d'entrée revient quand on rend la souris — sauf si c'est la page de
    // paramètres qui l'a demandée, auquel cas c'est elle qu'on regarde, et sauf si c'est une
    // machine qui l'a prise, auquel cas on est en train de jouer.
    overlay.hidden = playing || document.pointerLockElement === canvas || settings.open
  })
  document.addEventListener('mousemove', (e) => {
    // Le pointeur reste verrouillé sur le canevas du musée, même quand on joue : c'est le
    // portage du jeu qui lit les mêmes déplacements de son côté. Ici, on cesse simplement
    // de tourner la tête du visiteur — il ne bouge pas pendant qu'il tient la machine.
    if (playing) return
    if (document.pointerLockElement === canvas) player.look(e.movementX, e.movementY)
  })

  // --- Clavier --------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault()

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

    // **La machine prend tout le clavier**, sauf la touche qui la lâche. C'est la même
    // règle que pour la marche : on ne change pas de commandes en s'asseyant devant un jeu,
    // on change de ce qu'elles commandent — et lancer un cube dans le musée pendant qu'on
    // vise dans le labyrinthe n'aurait aucun sens.
    if (playing && e.code !== 'Backquote') return

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
      case 'KeyP':
        settings.toggle()
        break
      case 'KeyT':
        renderer.flat = !renderer.flat
        break
      case 'KeyE':
        // **On ne prend que devant, et on lâche avec une autre touche.** Une fois la
        // machine tenue, `E` est à elle — le jeu s'en sert, et elle s'écrit dans le nom
        // de carte. C'est `Backquote` qui rend la main : voir plus bas.
        if (!playing && (jeu || maze) && atMachine()) take()
        break

      case 'Backquote':
        // **La touche que le musée garde pour lui.**
        //
        // Il en faut une pour sortir d'une machine — une machine dont on ne peut pas
        // sortir est un piège, et le plan y tient : aucune énigme ne doit bloquer. Mais
        // toutes les touches d'un jeu lui appartiennent, jusqu'aux lettres qui s'écrivent
        // dans ses champs de texte. On en réserve donc une seule, celle du coin gauche du
        // clavier — « ² » en AZERTY, « ` » en QWERTY — et le portage ne la transmet jamais.
        //
        // Elle est désignée par sa **place** et non par son caractère : `Backquote` est la
        // touche physique, la même sur les deux dispositions.
        if (playing) release()
        break
      case 'BracketLeft':
        renderer.maxDepth = Math.max(0, renderer.maxDepth - 1)
        break
      case 'BracketRight':
        renderer.maxDepth = Math.min(8, renderer.maxDepth + 1)
        break
      default: {
        const digit = /^Digit([1-9])$/.exec(e.code)
        const preset = digit ? presets()[Number(digit[1]) - 1] : undefined
        if (preset) player.goTo(preset, world)
      }
    }
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())

  // --- Prise de contrôle pour le script de test -----------------------------
  const hook: DevHook = {
    frames: 0,
    selfTest: () => runSelfTest(world, physics),
    goTo: (index) => {
      const preset = presets()[index]
      if (preset) player.goTo(preset, world)
    },
    look: (dx, dy) => player.look(dx, dy),
    throwCube: () => projectiles.throwFrom(player, world),
    setDepth: (n) => {
      renderer.maxDepth = n
    },
    setPasses: (n) => {
      renderer.maxPasses = n
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
      const mouth = world.cells.get(HUB)!.passages[0]!.from
      return {
        // Le nom de la cellule voyage avec la couture : les scripts ne doivent jamais
        // le réécrire, sous peine de désigner une pièce qui n'existe plus.
        cell: mouth.cell,
        cx: mouth.center.x, cy: mouth.center.y, cz: mouth.center.z,
        nx: mouth.normal.x, ny: mouth.normal.y, nz: mouth.normal.z,
      }
    },
    walk: (metres) => player.walk(world, metres),
    tick: (seconds, pressed = []) => {
      player.update(seconds, world, new Set(pressed))
      projectiles.update(seconds, world)
    },
    setPaused: (value) => {
      paused = value
    },
    face: (fx, fy, fz) => player.face({ x: fx, y: fy, z: fz }),
    teleport: (cell, x, y, z, fx, fy, fz) => {
      player.goTo({ name: 'sonde', cell, pos: { x, y, z }, forward: { x: fx, y: fy, z: fz } }, world)
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
      vertical: player.vertical,
      grounded: player.grounded,
      stats: renderer.getStats(),
    }),
  }
  window.__edifice = hook

  // --- Boucle ---------------------------------------------------------------
  let previous = performance.now()
  let fps = 0
  let paused = false
  let ecran = 0

  const frame = (now: number): void => {
    // Onglet en arrière-plan, point d'arrêt dans le débogueur : un pas de temps
    // énorme traverserait les murs. On le borne.
    const dt = Math.min((now - previous) / 1000, 1 / 20)
    previous = now
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1

    // On s'éloigne, on lâche : sans cela on piloterait un écran qu'on ne voit plus.
    if (playing && !atMachine()) release()

    // On charge le jeu entier en approchant, une fois. Vingt-cinq mètres, c'est
    // l'autre bout de la grande salle : le temps de la traverser, il tourne.
    if (toMachine() < 625) approcher()

    if (!paused) {
      // Ou l'on marche dans le musée, ou l'on joue : le visiteur ne bouge pas pendant qu'il
      // tient la machine, et c'est ce qui rend les mêmes touches lisibles des deux côtés.
      if (!playing) player.update(dt, world, keys)
      projectiles.update(dt, world)
      // La machine tourne, qu'on la tienne ou non — c'est ce qui fait qu'on la découvre
      // déjà en marche plutôt qu'à mettre en marche.
      //
      // Tant que le jeu entier n'est pas là, c'est le noyau qui occupe l'écran ; dès qu'il
      // est là, c'est lui. La recopie n'a pas besoin de suivre l'image du musée — un écran
      // de machine vu depuis une salle n'a rien à gagner à ses soixante images par seconde,
      // et le jeu, lui, tourne à son propre rythme derrière.
      if (jeu) {
        if (!playing && ++ecran % 5 === 0) jeu.projeter(pictures, MACHINE_LAYER)
      } else if (maze) {
        pictures.paint(MACHINE_LAYER, maze.step(dt, null), 512, 288)
      }
    }

    // Pendant qu'on tient une machine, son écran couvre toute la page : dessiner le musée
    // derrière ne servirait qu'à lui disputer la carte graphique, et c'est elle qui en a
    // besoin. Sa dernière image reste là, prête pour le moment où l'on lâchera.
    if (!playing) {
      renderer.render(
        { cell: player.cell, pos: player.pos, forward: player.forward, up: player.up },
        projectiles.toRenderList(),
      )
    }

    hud.update({
      fps,
      cell: player.cell,
      pos: player.pos,
      crossings: player.crossings,
      maxDepth: renderer.maxDepth,
      projectiles: projectiles.count,
      stats: renderer.getStats(),
      aim: castRay(world, player.cell, player.pos, player.forward),
      prompt: playing
        ? '² — lâcher la machine'
        : !atMachine()
          ? null
          : jeu
            ? 'E — prendre la main'
            : chargement
              ? 'Wolf3D démarre…'
              : maze
                ? 'E — prendre la main'
                : null,
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
