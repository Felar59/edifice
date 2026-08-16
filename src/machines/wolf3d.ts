/**
 * Wolf3D, en état de marche.
 *
 * Le musée ne montre pas une capture de mes projets : il les **fait tourner**. Ce module
 * charge le vrai code du dépôt Wolf3D, compilé en WebAssembly, et lui demande un labyrinthe
 * puis des images. La génération — tirage aléatoire, automates cellulaires, deux marches
 * aléatoires, élagage des poches inaccessibles — et le lancer de rayon par DDA sont ceux du
 * jeu, sans une ligne changée. Voir `machines/wolf3d/` pour la frontière exacte.
 *
 * ## L'interface est numérique
 *
 * Comme pour le noyau de physique : des entiers, des flottants, et une adresse dans la
 * mémoire du module. Ni `wasm-bindgen`, ni glu, ni sérialisation — trois lignes suffisent à
 * charger le module, et rien ne se met entre le C et la page.
 *
 * ## On y joue
 *
 * Le plan est catégorique : chaque projet doit être **utilisé pour de vrai**. Devant l'écran,
 * une touche prend la main, et les mêmes touches qui font marcher dans le musée font marcher
 * dans le labyrinthe. Tant que personne ne s'en sert, un arpenteur le parcourt tout seul —
 * c'est l'auto-démonstration que le plan réclame au LOT 5, la machine qui tourne devant le
 * visiteur avant qu'il ait compris qu'il peut s'en servir. Mais c'est un économiseur d'écran,
 * pas la machine : la machine, c'est quand on la tient.
 */

import url from './wolf3d.wasm?url'

/** La taille de l'écran de la machine, celle des tableaux du musée. */
export const SCREEN_W = 512
export const SCREEN_H = 288

interface Kernel {
  memory: WebAssembly.Memory
  wolf_generate(seed: number, difficulty: number): number
  wolf_width(): number
  wolf_height(): number
  wolf_start_x(): number
  wolf_start_y(): number
  wolf_tile(x: number, y: number): number
  wolf_frame(): number
  wolf_view(px: number, py: number, angle: number, fov: number, w: number, h: number): void
}

export class Maze {
  private readonly k: Kernel
  private x = 0
  private y = 0
  private angle = 0
  /** La graine, gardée pour l'afficher : chaque visite a la sienne. */
  readonly seed: number

  private constructor(k: Kernel, seed: number) {
    this.k = k
    this.seed = seed
  }

  /**
   * Charge le module et bâtit un labyrinthe.
   *
   * **Une graine par visite**, ce que le plan demande explicitement : aucune solution ne peut
   * se partager, il n'y a pas de soluce possible. C'est aussi la seule façon de faire tenir
   * une énigme dans un portfolio public.
   */
  static async load(seed = Math.floor(Math.random() * 2 ** 31)): Promise<Maze | null> {
    const response = await fetch(url)
    const bytes = await response.arrayBuffer()
    // Le module est compilé contre une bibliothèque C qui déclare quatre fonctions du
    // système — les arguments du programme, l'horloge, la sortie. Aucune n'est appelée : on
    // passe toujours une graine, et il n'y a pas de programme à quitter. On les fournit
    // vides parce que l'édition de liens les réclame, pas parce qu'elles servent.
    const idle = (): number => 0
    const { instance } = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: {
        args_get: idle,
        args_sizes_get: idle,
        clock_time_get: idle,
        proc_exit: idle,
      },
    })
    const k = instance.exports as unknown as Kernel
    if (!k.wolf_generate(seed, 0)) return null

    const maze = new Maze(k, seed)
    maze.x = k.wolf_start_x()
    maze.y = k.wolf_start_y()
    maze.angle = Math.PI / 2
    return maze
  }

  get width(): number {
    return this.k.wolf_width()
  }

  get height(): number {
    return this.k.wolf_height()
  }

  /** Le labyrinthe est-il fermé à cet endroit ? Le jeu répond, bords compris. */
  wall(x: number, y: number): boolean {
    const t = this.k.wolf_tile(x, y)
    return t === 35 || t === 79 || t === 68 // '#', 'O', 'D'
  }

  /**
   * Fait avancer le jeu d'une image, puis la rend.
   *
   * `keys` est nul quand personne ne tient la machine : elle tourne alors toute seule.
   */
  step(dt: number, keys: Set<string> | null): Uint8Array<ArrayBuffer> {
    if (keys) this.drive(dt, keys)
    else this.walk(dt)
    this.k.wolf_view(this.x, this.y, this.angle, 1.15, SCREEN_W, SCREEN_H)
    // La mémoire d'un module peut se déplacer quand il en demande davantage : la vue se
    // reconstruit à chaque image plutôt que de se garder. C'est le même piège que dans le
    // noyau de physique, et il se paie de la même façon — un tableau qui pointe dans le vide.
    return new Uint8Array(
      this.k.memory.buffer,
      this.k.wolf_frame(),
      SCREEN_W * SCREEN_H * 4,
    ) as Uint8Array<ArrayBuffer>
  }

  /**
   * Les commandes du visiteur.
   *
   * Avancer, reculer, tourner : celles du jeu d'origine. Le pas de côté n'y était pas, et on
   * ne l'ajoute pas — ce n'est pas notre jeu.
   */
  private drive(dt: number, keys: Set<string>): void {
    const turn = 2.4
    const speed = 2.6
    if (keys.has('KeyA') || keys.has('ArrowLeft')) this.angle -= turn * dt
    if (keys.has('KeyD') || keys.has('ArrowRight')) this.angle += turn * dt

    let move = 0
    if (keys.has('KeyW') || keys.has('ArrowUp')) move += 1
    if (keys.has('KeyS') || keys.has('ArrowDown')) move -= 1
    if (move === 0) return

    const step = move * speed * dt
    this.slide(Math.cos(this.angle) * step, Math.sin(this.angle) * step)
  }

  /**
   * Un pas, axe par axe, avec un rayon.
   *
   * Séparer les deux axes est ce qui permet de **glisser le long d'un mur** au lieu de s'y
   * coller net : un pas en diagonale dont la composante en x est bloquée garde sa composante
   * en y. Sans cela, on reste accroché à chaque angle, et un labyrinthe devient injouable.
   */
  private slide(dx: number, dy: number): void {
    const room = 0.28
    const free = (x: number, y: number): boolean =>
      !this.wall(Math.floor(x + room), Math.floor(y)) &&
      !this.wall(Math.floor(x - room), Math.floor(y)) &&
      !this.wall(Math.floor(x), Math.floor(y + room)) &&
      !this.wall(Math.floor(x), Math.floor(y - room))

    if (free(this.x + dx, this.y)) this.x += dx
    if (free(this.x, this.y + dy)) this.y += dy
  }

  private walk(dt: number): void {
    const speed = 1.4
    const nx = this.x + Math.cos(this.angle) * speed * dt
    const ny = this.y + Math.sin(this.angle) * speed * dt

    // Un demi-pas de marge devant les pieds : sans elle, l'arpenteur se colle au mur et la
    // vue n'est plus qu'un aplat gris.
    const clear = (x: number, y: number): boolean =>
      !this.wall(Math.floor(x + Math.cos(this.angle) * 0.4), Math.floor(y + Math.sin(this.angle) * 0.4))

    if (clear(nx, ny)) {
      this.slide(nx - this.x, ny - this.y)
      // Une dérive lente et continue, pour que la vue ne soit jamais tout à fait la même.
      this.angle += Math.sin(this.x * 0.7 + this.y * 0.4) * 0.25 * dt
      return
    }

    // Un mur : on tourne du côté qui dégage le plus, en sondant à gauche et à droite.
    const room = (turn: number): number => {
      let d = 0.4
      while (d < 6 && !this.wall(
        Math.floor(this.x + Math.cos(this.angle + turn) * d),
        Math.floor(this.y + Math.sin(this.angle + turn) * d),
      )) d += 0.4
      return d
    }
    this.angle += (room(0.9) > room(-0.9) ? 1 : -1) * 1.8 * dt
  }
}
