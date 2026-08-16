import './style.css'

import { initGpu } from './render/gpu'
import { Renderer } from './render/renderer'
import { Player, presets } from './player/player'
import { castRay } from './world/ray'
import { add, normalize, scale, sub, type Vec3 } from './math/vec3'
import { CUBE_SIZE, Projectiles } from './player/projectiles'
import { Physics } from './player/physique'
import { loadPictures, noPictures } from './render/pictures'
import { Jeu, type Rect } from './machines/wolf3d-jeu'
import { Demarrage, DUREE, JALONS } from './machines/demarrage'
import { Sons } from './machines/son'
import musee from './assets/musee1.png?url'
import julia from './assets/Julia1.png?url'
import hunter from './assets/my_hunter1.png?url'
import myworld from './assets/myworld1.png?url'
import shell from './assets/42sh1.png?url'
import antivirus from './assets/antivirus.png?url'
import casque from './assets/wolf-casque.png?url'
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
    pictures = await loadPictures(device, [musee, julia, hunter, myworld, shell, antivirus, casque], 1)
  } catch (err) {
    console.error('tableaux :', err)
  }
  renderer.setPictures(pictures)

  /**
   * **La première machine.** Le vrai Wolf3D, compilé en WebAssembly, qui bâtit son labyrinthe
   * et le rend par son propre lancer de rayon. S'il ne se charge pas, l'écran reste éteint et
   * le musée se visite quand même : une machine en panne ne ferme pas le bâtiment.
   */
  const MACHINE_LAYER = 7

  /**
   * **L'état de la borne**, qui est aussi celui du jeu derrière.
   *
   * Éteinte, le jeu ne tourne pas — pas « au ralenti », pas « en arrière-plan » : sa boucle
   * dort à la fin d'une image et n'exécute plus rien. C'est ce qui permet d'avoir une machine
   * dans une salle sans la payer dans toutes les autres.
   *
   * Le passage de l'un à l'autre n'est pas instantané, et c'est voulu : une borne qu'on
   * allume met une seconde à chauffer. Ce délai n'est pas une décoration — c'est lui qui
   * fait qu'on a appuyé sur un bouton plutôt que basculé un réglage.
   */
  type Etat = 'eteinte' | 'demarrage' | 'allumee'
  let etat: Etat = 'eteinte'
  let allumage = 0
  const ecranBorne = new Demarrage()
  let ecranAPeindre = true
  /** Le son de la borne : synthétisé, jamais chargé. Voir `machines/son.ts`. */
  const sons = new Sons()
  let bipsPasses = 0

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
        // Le jeu s'est refermé — par son bouton « Quit », ou parce qu'on a coupé la borne.
        // Dans les deux cas la borne est éteinte : c'est cohérent, et c'est ce qu'on attend
        // d'un meuble dont on vient de quitter le programme.
        jeu.auQuitter = () => {
          eteindre()
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
  /**
   * Où la dalle de la borne tombe dans l'image, en pixels de mise en page.
   *
   * C'est de là que part l'immersion : le jeu s'ouvre depuis l'écran qu'on regarde, et non
   * depuis le milieu de la page. On projette les quatre coins et l'on prend leur enveloppe —
   * la dalle est penchée, un rectangle droit suffit largement à donner le départ.
   */
  const placeDeLEcran = (): Rect | undefined => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const coins = getLandmarks().machineCorners.map((c) => renderer.ouOnRegarde(c, dpr))
    if (coins.some((c) => c === null)) return undefined
    const xs = coins.map((c) => c!.x)
    const ys = coins.map((c) => c!.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }

  /**
   * **L'immersion** : on n'apparaît pas dans le jeu, on y entre.
   *
   * Pendant qu'elle court, la caméra du musée quitte les yeux du visiteur et **vole vers la
   * dalle** — le visiteur, lui, ne bouge pas — pendant que l'image du jeu reste épinglée sur
   * cette dalle, image après image, à l'endroit exact où la projection la fait tomber. La
   * salle grossit donc autour de l'écran jusqu'à ce qu'il n'y ait plus que lui, et le
   * raccord au plein cadre se fait dans les derniers dixièmes, quand la dalle occupe déjà
   * presque tout. Au retour, le même chemin à l'envers : l'image rentre dans le meuble.
   */
  interface Immersion {
    sens: 'entre' | 'sort'
    t: number
    /** Les yeux du visiteur au moment du geste : le bout fixe du trajet. */
    de: { pos: Vec3; forward: Vec3; up: Vec3 }
  }
  let immersion: Immersion | null = null
  const ENTREE = 0.9
  const SORTIE = 0.55

  const yeux = () => ({
    pos: { ...player.pos },
    forward: { ...player.forward },
    up: { ...player.up },
  })

  const take = (): void => {
    playing = true
    document.body.classList.add('machine')
    sons.plonger(false)
    // Si l'on reprend la machine pendant que l'image finissait de se ranger, on repart
    // d'où elle en est — le trajet est le même, remonté.
    immersion = immersion
      ? { sens: 'entre', t: 1 - immersion.t, de: immersion.de }
      : { sens: 'entre', t: 0, de: yeux() }
    // On ne décide pas du pointeur ici : c'est le portage qui rend au jeu l'état
    // exact qu'il avait demandé — libre dans ses menus, verrouillé dans une partie.
    jeu?.prendre()
    jeu?.placer(placeDeLEcran() ?? null)
  }
  const release = (): void => {
    playing = false
    document.body.classList.remove('machine')
    sons.plonger(true)
    immersion = immersion
      ? { sens: 'sort', t: 1 - immersion.t, de: immersion.de }
      : { sens: 'sort', t: 0, de: yeux() }
    jeu?.lacher()
    // Et l'on reprend le pointeur — à l'image suivante, le temps que le navigateur ait
    // fini de le rendre. Demandé dans la foulée du déverrouillage, il est ignoré.
    requestAnimationFrame(() => void canvas.requestPointerLock())
  }

  /**
   * Allumer la borne, et l'éteindre.
   *
   * Allumer ne rend pas la main au jeu tout de suite : l'écran passe d'abord par l'allumage,
   * que le musée peint lui-même — voir `machines/demarrage.ts`. Éteindre, en revanche, est
   * immédiat : un interrupteur ne négocie pas.
   */
  const allumer = (): void => {
    if (!jeu || etat !== 'eteinte') return
    etat = 'demarrage'
    allumage = 0
    bipsPasses = 0
    sons.interrupteur()
    sons.allumage()
    // Le jeu démarre **maintenant**, pas à la fin de l'animation : il a ses images à
    // charger, et l'allumage de l'écran couvre exactement ce temps-là.
    jeu.demarrer()
  }

  const eteindre = (): void => {
    if (etat === 'eteinte') return
    if (playing) release()
    jeu?.arreter()
    etat = 'eteinte'
    ecranAPeindre = true
    sons.ronron(false)
    sons.interrupteur()
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
  // Trois mètres de la dalle : on est devant la borne, pas dans la salle. Le meuble
  // occupe déjà le premier mètre, et l'on ne prend pas une machine de loin.
  const atMachine = (): boolean => toMachine() < 9

  /**
   * Vise-t-on l'interrupteur ?
   *
   * Le musée sait déjà où le regard rencontre la matière — c'est le rayon d'interaction, qui
   * ne servait jusqu'ici qu'à s'afficher. Il sert maintenant : on regarde le bouton, on
   * appuie. C'est le seul geste du musée qui désigne un objet plutôt qu'une salle.
   */
  const viseBouton = (hit: ReturnType<typeof castRay>): boolean => {
    const marks = getLandmarks()
    if (!hit || hit.cell !== marks.machineCell || hit.distance > 3.5) return false
    const b = marks.machineButton
    const dx = hit.point.x - b.x
    const dy = hit.point.y - b.y
    const dz = hit.point.z - b.z
    return dx * dx + dy * dy + dz * dz < 0.02
  }

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
    if (playing && e.code !== 'KeyP') return

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
      case 'KeyT':
        renderer.flat = !renderer.flat
        break
      case 'KeyE':
        // **`E` fait ce que l'on regarde.** Sur l'interrupteur, il allume ou éteint la
        // borne ; ailleurs devant elle, il en prend la main. Une fois la machine tenue,
        // `E` lui appartient — le jeu s'en sert, et elle s'écrit dans le nom de carte ;
        // c'est `P` qui rend la main.
        if (playing) break
        if (viseBouton(regard)) {
          if (etat === 'eteinte') allumer()
          else eteindre()
        } else if (etat === 'allumee' && atMachine()) {
          take()
        }
        break

      case 'KeyP':
        // **La touche que le musée garde pour lui.**
        //
        // Il en faut une pour sortir d'une machine — une machine dont on ne peut pas
        // sortir est un piège, et le plan y tient : aucune énigme ne doit bloquer. Mais
        // toutes les touches d'un jeu lui appartiennent, jusqu'aux lettres qui s'écrivent
        // dans ses champs de texte : celle-ci, le portage ne la transmet jamais.
        //
        // `P` parce qu'aucun de mes jeux ne s'en sert. C'est déjà la touche des
        // paramètres du musée, et il n'y a pas de conflit : on ne marche pas et on ne
        // joue pas en même temps. Elle est reconnue à sa **place** sur le clavier, la
        // même en AZERTY et en QWERTY.
        if (playing) release()
        else settings.toggle()
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
  /** Où le regard rencontre la matière, cette image-ci. Le clavier s'en sert aussi. */
  let regard: ReturnType<typeof castRay> = null

  const frame = (now: number): void => {
    // Onglet en arrière-plan, point d'arrêt dans le débogueur : un pas de temps
    // énorme traverserait les murs. On le borne.
    const dt = Math.min((now - previous) / 1000, 1 / 20)
    previous = now
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1

    regard = castRay(world, player.cell, player.pos, player.forward)

    sons.distance(Math.sqrt(toMachine()))

    // On s'éloigne, on lâche : sans cela on piloterait un écran qu'on ne voit plus.
    if (playing && !atMachine()) release()

    // **On quitte la salle, la borne s'éteint.** C'est la règle qui rend la machine
    // gratuite partout ailleurs : le jeu ne dort pas « en tâche de fond », il s'arrête.
    if (etat !== 'eteinte' && player.cell !== getLandmarks().machineCell) eteindre()

    // On charge le jeu entier en approchant, une fois. Vingt-cinq mètres, c'est
    // l'autre bout de la grande salle : le temps de la traverser, il est prêt — arrêté,
    // mais prêt, et l'allumage n'a plus rien à attendre.
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
      // **L'écran de la borne**, selon son état.
      //
      // Éteinte, on peint une dalle morte une fois pour toutes — rien ne bouge, il n'y a
      // rien à réécrire. Pendant l'allumage, le musée peint lui-même. Allumée, on recopie
      // le canevas du jeu, et pas à chaque image : un écran vu depuis une salle n'a rien à
      // gagner à soixante recopies par seconde, et le jeu tourne à son rythme derrière.
      if (etat === 'eteinte') {
        if (ecranAPeindre) {
          pictures.paint(MACHINE_LAYER, ecranBorne.eteint(), 512, 288)
          ecranAPeindre = false
        }
      } else if (etat === 'demarrage') {
        allumage += dt
        // Un bip par ligne du compte rendu : c'est le son qui rend l'écriture crédible,
        // et il suffit de compter les lignes déjà écrites pour savoir quand le poser.
        const bips = JALONS.filter((at) => at <= allumage).length
        if (bips > bipsPasses) {
          sons.bip(bips === JALONS.length)
          bipsPasses = bips
        }
        if (allumage >= DUREE) {
          etat = 'allumee'
          sons.ronron(true)
        } else {
          pictures.paint(MACHINE_LAYER, ecranBorne.image(allumage), 512, 288)
        }
      } else if (jeu && !playing && ++ecran % 5 === 0) {
        jeu.projeter(pictures, MACHINE_LAYER)
      }
    }

    // Pendant qu'on tient une machine, son écran couvre toute la page : dessiner le musée
    // derrière ne servirait qu'à lui disputer la carte graphique, et c'est elle qui en a
    // besoin. On ne le dessine que libre — ou pendant l'immersion, où c'est lui qui fait
    // tout le mouvement.
    if (immersion) {
      immersion.t = Math.min(1, immersion.t + dt / (immersion.sens === 'entre' ? ENTREE : SORTIE))
    }

    if (!playing || immersion) {
      // La caméra de l'immersion : des yeux du visiteur vers un point à quarante
      // centimètres de la dalle, le regard se posant sur elle en chemin. Douce au départ,
      // pressée ensuite — la courbe d'une aspiration, pas celle d'un travelling.
      let camera = { cell: player.cell, pos: player.pos, forward: player.forward, up: player.up }
      let v = 0
      if (immersion) {
        const m = getLandmarks()
        const de = immersion.de
        const brut = immersion.sens === 'entre' ? immersion.t : 1 - immersion.t
        v = brut * brut * (3 - 2 * brut)
        const dir = normalize(sub(m.machinePos, de.pos))
        const arret = add(m.machinePos, scale(dir, -0.42))
        const vise = Math.min(1, v * 1.6)
        camera = {
          cell: m.machineCell,
          pos: add(scale(de.pos, 1 - v), scale(arret, v)),
          forward: normalize(add(scale(de.forward, 1 - vise), scale(dir, vise))),
          up: de.up,
        }
      }
      renderer.render(camera, projectiles.toRenderList())

      if (immersion) {
        if (jeu) {
          // L'image du jeu, épinglée sur la dalle que la caméra approche — puis fondue
          // vers le plein cadre dans les derniers dixièmes, quand la dalle emplit déjà
          // presque tout. `couvre` traîne exprès derrière la caméra : c'est elle qui fait
          // le travail, pas l'étirement.
          const couvre = v ** 3
          const dalle = placeDeLEcran()
          const plein = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
          jeu.placer(
            dalle
              ? {
                  x: dalle.x * (1 - couvre),
                  y: dalle.y * (1 - couvre),
                  w: dalle.w + (plein.w - dalle.w) * couvre,
                  h: dalle.h + (plein.h - dalle.h) * couvre,
                }
              : plein,
          )
        }
        if (immersion.t >= 1) {
          if (immersion.sens === 'entre') {
            jeu?.placer(null)
            jeu?.flash()
          } else {
            jeu?.cacher()
            jeu?.placer(null)
          }
          immersion = null
        }
      }
    }

    hud.update({
      fps,
      cell: player.cell,
      pos: player.pos,
      crossings: player.crossings,
      maxDepth: renderer.maxDepth,
      projectiles: projectiles.count,
      stats: renderer.getStats(),
      aim: regard,
      prompt: playing
        ? 'P — lâcher la machine'
        : viseBouton(regard)
          ? etat === 'eteinte'
            ? jeu
              ? 'E — allumer la borne'
              : 'la borne se charge…'
            : 'E — éteindre la borne'
          : etat === 'demarrage'
            ? 'la borne démarre…'
            : etat === 'allumee' && atMachine()
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
