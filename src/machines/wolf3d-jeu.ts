/**
 * Wolf3D **en entier**, accroché au mur de la grande salle.
 *
 * L'autre module de ce dossier fait tourner le noyau du jeu — la génération et le lancer de
 * rayon, recompilés seuls. Celui-ci fait tourner le jeu : son `main`, son menu, ses réglages,
 * sa simulation, son arme, sa minimap. C'est le même code C, compilé par emscripten, et c'est
 * SFML qu'on a portée plutôt que le projet qu'on a réécrit. Le journal complet du portage,
 * avec chaque mur rencontré, est dans `wolf3d-web.txt` ; la frontière est dans
 * `machines/wolf3d/web/`.
 *
 * ## Ce que ce module a en charge, et rien d'autre
 *
 * Trois choses, qui sont les trois endroits où un jeu autonome touche à la page qui l'héberge.
 *
 * **Le canevas.** Le jeu en veut un, à lui, et dessine dedans avec WebGL — pendant que le
 * musée dessine dans le sien avec WebGPU. Ils ne se parlent pas : on recopie simplement
 * l'image de l'un dans la texture de l'autre, et l'écran de la machine devient un tableau
 * comme les autres.
 *
 * **Les touches.** Le clavier est pris sur la fenêtre, pas sur le canevas — un canevas ne
 * reçoit rien sans le focus, et rien ne donne le focus dans une page où l'on marche. Le jeu
 * entend donc tout ce qui se tape, y compris quand on se promène dans le musée. C'est la page
 * qui dit quand il a la main : `edifice_ecoute`, du côté C.
 *
 * **La souris.** Le jeu lit sa position, en déduit le regard, puis remet le curseur au centre.
 * Une page ne peut pas déplacer le pointeur ; le portage tient donc une position imaginaire
 * que le verrouillage fait avancer et que le jeu replace où il veut. Il n'y a rien à faire
 * ici : le musée garde le pointeur, et le jeu reçoit les déplacements comme s'il l'avait.
 */

/** La place d'un écran dans l'image, en pixels de mise en page. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Où sont les fichiers du jeu. C'est la page qui sait, pas le module. */
const RACINE = '/machines/wolf3d/'

/** La taille de l'écran de la machine, celle des tableaux du musée. */
const LARGE = 512
const HAUT = 288

/** Ce que la fabrique d'emscripten rend, réduit à ce dont on se sert. */
interface Module {
  _main(argc: number, argv: number, env: number): void
  _edifice_environ(): number
  _edifice_ecoute(on: number): void
  _edifice_suspend(on: number): void
  _edifice_fermer(): void
  _malloc(bytes: number): number
  setValue(at: number, value: number, type: string): void
  stringToUTF8(text: string, at: number, room: number): void
  lengthBytesUTF8(text: string): number
  /** Appelé par le portage quand le jeu ferme sa fenêtre — son bouton « Quit ». */
  edificeFerme?: () => void
}

declare global {
  interface Window {
    creerWolf3d?: (options: Record<string, unknown>) => Promise<Module>
  }
}

export class Jeu {
  private constructor(
    private readonly module: Module,
    /** Le canevas du jeu. Il vit dans la page, sous celui du musée. */
    readonly canevas: HTMLCanvasElement,
  ) {}

  /** A-t-on la main ? */
  tenu = false

  /**
   * Le jeu tourne-t-il ?
   *
   * Éteindre la borne ne suspend pas le jeu : elle le **coupe**. Il se referme par son
   * propre chemin, libère ce qu'il a pris, et `main` rend la main. Rien ne subsiste — pas
   * de partie en cours qui attendrait, pas de menu resté ouvert. Le prochain allumage est
   * un vrai démarrage, ce qui est la seule chose qu'un interrupteur puisse promettre.
   */
  vivant = false

  /**
   * Ce que le musée fait quand le jeu se referme sur son propre « Quit ».
   *
   * Il faut bien que ce bouton mène quelque part : dans une page, fermer la fenêtre
   * ne veut rien dire. Il ramène donc au musée — et la machine se rallume derrière,
   * pour que l'écran ne reste pas éteint sur le mur.
   */
  auQuitter: (() => void) | null = null

  /** Une recopie est-elle en cours ? Elles sont asynchrones et ne doivent pas se doubler. */
  private copie = false

  /**
   * Charge le jeu et le lance.
   *
   * Dix-sept mégaoctets : on ne les demande pas à l'ouverture du musée, mais en approchant de
   * la machine. Le temps d'arriver devant l'écran, elle tourne.
   */
  static async charger(): Promise<Jeu> {
    const canevas = document.createElement('canvas')
    // **Il doit s'appeler `canvas`.** Le portage désigne son canevas par le sélecteur
    // `#canvas`, qui est la convention d'emscripten, et c'est par lui qu'il fixe la taille du
    // tampon de dessin. Sous un autre nom, le sélecteur ne trouve rien : le redimensionnement
    // échoue sans un mot, le tampon garde ses 300 × 150 par défaut, et le jeu dessine une
    // image de fenêtre entière dedans — on n'en voit qu'un coin, énorme. Le musée, lui, a
    // nommé le sien `scene`, et les deux ne se marchent pas dessus.
    canevas.id = 'canvas'
    // Le jeu s'ouvre en plein écran : il demande la taille du bureau, et le bureau, dans un
    // navigateur, c'est la page. Le canevas occupe donc la fenêtre — invisible tant qu'on ne
    // le tient pas, mais présent, car une taille nulle ne veut rien dire.
    Object.assign(canevas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      display: 'block',
      // Au-dessus des panneaux du musée et de son réticule : quand on tient la machine,
      // il n'y a plus qu'elle à l'écran. Voir la règle `body.machine` dans la feuille de
      // style, qui éteint le réticule et fait remonter l'invite de sortie.
      zIndex: '15',
      visibility: 'hidden',
      pointerEvents: 'none',
    })
    canevas.addEventListener('contextmenu', (e) => e.preventDefault())
    document.body.appendChild(canevas)

    await charger_script(`${RACINE}wolf3d.js`)
    const fabrique = window.creerWolf3d
    if (!fabrique) throw new Error("wolf3d.js n'a pas livré sa fabrique")

    const module = await fabrique({
      canvas: canevas,
      locateFile: (fichier: string) => RACINE + fichier,
      // Le jeu écrit sur sa sortie d'erreur ; on ne la jette pas, elle a servi tout au long
      // du portage et elle servira encore le jour où quelque chose se détraquera.
      printErr: (ligne: string) => console.warn('wolf3d :', ligne),
      print: (ligne: string) => console.log('wolf3d :', ligne),
    })

    // La machine n'écoute pas encore : on marche dans le musée, et les touches y servent
    // déjà à quelque chose. Et **le jeu n'est pas lancé** : le module est là, prêt, mais
    // c'est le bouton de la borne qui appellera `main`. Une borne éteinte ne calcule rien.
    module._edifice_ecoute(0)

    const jeu = new Jeu(module, canevas)

    // Le jeu peut se refermer de lui-même — c'est ce que fait son bouton « Quit », et c'est
    // aussi ce qu'on lui demande en coupant la borne. Dans les deux cas il n'y a plus de jeu
    // derrière l'écran, et le musée doit le savoir.
    module.edificeFerme = () => {
      jeu.vivant = false
      jeu.auQuitter?.()
    }

    return jeu
  }

  /**
   * Démarre le jeu — son `main`, avec ses **trois** arguments.
   *
   * Emscripten n'en passe que deux ; le jeu lit le troisième — l'environnement — dès sa
   * première ligne, pour vérifier qu'il y a un écran. C'est aussi par là qu'on le rallume
   * quand il s'est refermé.
   */
  demarrer(): void {
    if (this.vivant) return
    this.vivant = true
    this.lancer()
  }

  private lancer(): void {
    const nom = 'wolf3d'
    const octets = this.module.lengthBytesUTF8(nom) + 1
    const texte = this.module._malloc(octets)
    this.module.stringToUTF8(nom, texte, octets)
    const argv = this.module._malloc(8)
    // `setValue` plutôt qu'une vue typée : la mémoire peut grandir, et les vues sont alors
    // remplacées.
    this.module.setValue(argv, texte, 'i32')
    this.module.setValue(argv + 4, 0, 'i32')
    this.module._main(1, argv, this.module._edifice_environ())
  }

  /**
   * Prendre la main : le jeu passe devant, et le clavier comme la souris sont pour lui.
   *
   * Le canevas récupère aussi les événements de pointeur — sans quoi les clics traverseraient
   * jusqu'à celui du musée, qui reprendrait le verrouillage au premier clic dans le menu.
   */
  prendre(depuis?: Rect): void {
    this.tenu = true
    this.canevas.style.visibility = 'visible'
    this.canevas.style.pointerEvents = 'auto'
    this.module._edifice_ecoute(1)
    this.plonger(depuis, false)
  }

  /**
   * Couper la machine.
   *
   * On envoie au jeu l'événement de fermeture — le même que la croix d'une fenêtre — et il
   * se referme par son propre chemin. C'est la seule façon honnête d'éteindre un programme
   * qu'on n'a pas écrit : lui demander de s'arrêter, plutôt que de le figer par surprise.
   */
  arreter(): void {
    if (!this.vivant) return
    this.module._edifice_fermer()
  }

  /** La lâcher : l'image se referme sur l'écran de la borne, puis s'efface. */
  lacher(vers?: Rect): void {
    this.tenu = false
    this.canevas.style.pointerEvents = 'none'
    this.module._edifice_ecoute(0)
    // On rend le pointeur explicitement. Le demander directement pour le canevas du
    // musée pendant que celui du jeu le tient ne suffit pas : le navigateur ne
    // transfère pas un verrouillage, il faut le défaire d'abord.
    if (document.pointerLockElement === this.canevas) document.exitPointerLock()

    const animation = this.plonger(vers, true)
    if (!animation) {
      this.canevas.style.visibility = 'hidden'
      return
    }
    animation.addEventListener('finish', () => {
      if (!this.tenu) this.canevas.style.visibility = 'hidden'
    })
  }

  /**
   * **L'immersion.**
   *
   * L'image du jeu grandit depuis l'écran de la borne jusqu'au bord de la page. Le rectangle
   * qu'on reçoit est la place que la dalle occupe dans l'image du musée, mesurée à la
   * projection : sans lui, une image apparaît ; avec lui, on entre dans le meuble qu'on
   * regardait. Le musée continue de se dessiner derrière pendant ce temps-là, de sorte qu'on
   * voie la salle s'éloigner autour de l'écran.
   *
   * Le canevas occupe déjà toute la page : on ne le redimensionne pas, on le **transforme**,
   * ce qui ne coûte rien et ne touche pas au rendu. L'origine étant son coin supérieur
   * gauche, une translation suivie d'une mise à l'échelle le pose exactement dans le
   * rectangle voulu.
   */
  private plonger(rect: Rect | undefined, retour: boolean): Animation | null {
    if (!rect || !this.canevas.animate) return null

    const W = this.canevas.clientWidth || 1
    const H = this.canevas.clientHeight || 1
    const petit = {
      transform: `translate(${rect.x}px, ${rect.y}px) scale(${rect.w / W}, ${rect.h / H})`,
      opacity: '0.4',
      filter: 'brightness(1.6) contrast(1.2)',
    }
    const grand = { transform: 'translate(0px, 0px) scale(1, 1)', opacity: '1', filter: 'none' }

    return this.canevas.animate(retour ? [grand, petit] : [petit, grand], {
      duration: retour ? 360 : 560,
      // Vif au départ, posé à l'arrivée : c'est la courbe d'un objet qu'on approche du
      // visage, et non celle d'un panneau qui coulisse.
      easing: retour ? 'cubic-bezier(0.5, 0, 0.9, 0.4)' : 'cubic-bezier(0.13, 0.75, 0.2, 1)',
      fill: 'both',
    })
  }

  /**
   * Recopie l'image du jeu dans une couche du tableau de textures.
   *
   * Le canevas fait la taille de la fenêtre et l'écran du mur cinq cent douze pixels de large :
   * `copyExternalImageToTexture` ne sait pas redimensionner, alors c'est `createImageBitmap`
   * qui s'en charge — le navigateur le fait bien, et sans repasser par le processeur.
   */
  projeter(ecran: { project(layer: number, source: ImageBitmap): void }, couche: number): void {
    if (this.copie) return
    this.copie = true
    createImageBitmap(this.canevas, {
      resizeWidth: LARGE,
      resizeHeight: HAUT,
      resizeQuality: 'medium',
    })
      .then((image) => {
        ecran.project(couche, image)
        image.close()
      })
      .catch(() => {})
      .finally(() => {
        this.copie = false
      })
  }
}

/**
 * Charge un script classique et attend qu'il ait posé ce qu'il pose.
 *
 * Le fichier d'emscripten n'est pas un module : il définit une fabrique globale. On ne peut
 * donc pas l'importer, et il ne faut surtout pas que l'empaqueteur essaie de l'analyser — il
 * vit dans `public/`, servi tel quel.
 */
function charger_script(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const balise = document.createElement('script')
    balise.src = url
    balise.onload = () => resolve()
    balise.onerror = () => reject(new Error(`${url} introuvable`))
    document.head.appendChild(balise)
  })
}
