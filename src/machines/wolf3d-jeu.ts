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
      zIndex: '5',
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
    // déjà à quelque chose.
    module._edifice_ecoute(0)

    const jeu = new Jeu(module, canevas)

    // Le jeu peut se refermer tout seul — c'est ce que fait son bouton « Quit ». Le portage
    // nous prévient ; on ramène le visiteur au musée et l'on rallume la machine derrière lui.
    module.edificeFerme = () => {
      jeu.auQuitter?.()
      // Un temps mort avant de relancer : on est appelé depuis le destructeur de la fenêtre,
      // c'est-à-dire depuis l'intérieur du jeu qui s'arrête.
      setTimeout(() => jeu.lancer(), 0)
    }

    jeu.lancer()
    return jeu
  }

  /**
   * Démarre le jeu — son `main`, avec ses **trois** arguments.
   *
   * Emscripten n'en passe que deux ; le jeu lit le troisième — l'environnement — dès sa
   * première ligne, pour vérifier qu'il y a un écran. C'est aussi par là qu'on le rallume
   * quand il s'est refermé.
   */
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
  prendre(): void {
    this.tenu = true
    this.canevas.style.visibility = 'visible'
    this.canevas.style.pointerEvents = 'auto'
    this.module._edifice_ecoute(1)
  }

  /** La lâcher. Le jeu continue de tourner derrière l'écran — on ne l'entend plus. */
  lacher(): void {
    this.tenu = false
    this.canevas.style.visibility = 'hidden'
    this.canevas.style.pointerEvents = 'none'
    this.module._edifice_ecoute(0)
    // On rend le pointeur explicitement. Le demander directement pour le canevas du
    // musée pendant que celui du jeu le tient ne suffit pas : le navigateur ne
    // transfère pas un verrouillage, il faut le défaire d'abord.
    if (document.pointerLockElement === this.canevas) document.exitPointerLock()
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
