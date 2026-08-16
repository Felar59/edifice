/**
 * **L'allumage d'une machine.**
 *
 * Une borne qui s'allume ne montre pas son jeu tout de suite. Un tube met une seconde à
 * chauffer, une carte compte sa mémoire, et c'est pendant ce temps-là qu'on comprend qu'on
 * vient d'appuyer sur un vrai bouton. Sans cette seconde, l'écran change d'image et l'on n'a
 * rien fait ; avec elle, on a démarré quelque chose.
 *
 * ## Pourquoi un canevas à deux dimensions
 *
 * Le musée dessine tout par la géométrie et n'a jamais chargé la moindre image. Mais l'écran
 * d'une machine est déjà une exception assumée — c'est une couche du tableau de textures,
 * réécrite à chaque instant par le projet qui tourne derrière. Y écrire une animation ne
 * demande donc rien de nouveau : on peint sur un canevas ordinaire, on lit ses pixels, et on
 * les pose dans la même couche. C'est aussi la seule façon raisonnable d'avoir du **texte**,
 * qu'aucune géométrie ne donnerait à ce prix.
 *
 * ## Ce qui se passe, dans l'ordre
 *
 * Le tube s'allume — un trait horizontal qui s'ouvre depuis le centre, comme une télévision
 * cathodique. Il s'épanouit, blanchit, puis retombe. Le compte rendu de démarrage s'écrit
 * alors ligne à ligne, en ambre sur noir, avec le curseur qui bat. Et pour finir, le nom du
 * jeu, un instant, avant que la machine ne prenne la main.
 */

/** La taille des couches du tableau de textures : c'est là qu'on écrit. */
const LARGE = 512
const HAUT = 288

/** Combien de temps dure l'allumage, en secondes. */
export const DUREE = 2.9

/**
 * Les lignes du compte rendu, et l'instant où chacune apparaît.
 *
 * Elles disent la vérité sur ce qui tourne derrière — le vrai code en C, sa bibliothèque
 * portée, la mémoire du module. Un faux compte rendu serait un décor ; celui-ci est une
 * fiche technique, et c'est ce que le musée doit à un visiteur qui s'arrête.
 */
const JOURNAL: readonly { at: number; texte: string }[] = [
  { at: 0.95, texte: 'EDIFICE ARCADE SYSTEM  v1.0' },
  { at: 1.15, texte: '' },
  { at: 1.25, texte: 'CPU ...... WebAssembly 64k pages' },
  { at: 1.45, texte: 'MEM ...... 2.2 Mo wasm / 14 Mo data' },
  { at: 1.65, texte: 'GPU ...... WebGL 2  (pipeline fixe emule)' },
  { at: 1.85, texte: 'SND ...... OpenAL' },
  { at: 2.05, texte: '' },
  { at: 2.15, texte: 'LOAD ..... wolf3d.c   [OK]' },
  { at: 2.35, texte: 'LOAD ..... SFML 2.6   [PORTEE]' },
  { at: 2.55, texte: '' },
]

/**
 * Peint une image de l'allumage.
 *
 * `t` court de zéro à `DUREE`. Rend les pixels prêts pour `Pictures.paint`, ou `null` quand
 * l'animation est finie — à l'appelant de passer la main au jeu.
 */
export class Demarrage {
  private readonly canevas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D

  constructor() {
    this.canevas = document.createElement('canvas')
    this.canevas.width = LARGE
    this.canevas.height = HAUT
    const ctx = this.canevas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error("pas de contexte 2d pour l'écran de la borne")
    this.ctx = ctx
  }

  /** L'écran éteint : du noir, et le reflet de la salle sur une dalle morte. */
  eteint(): Uint8Array<ArrayBuffer> {
    const c = this.ctx
    c.fillStyle = '#06060a'
    c.fillRect(0, 0, LARGE, HAUT)
    // Un lustre en diagonale : sans lui, une dalle éteinte est un trou noir dans le meuble,
    // et l'on ne croit plus à la vitre.
    const reflet = c.createLinearGradient(0, HAUT, LARGE, 0)
    reflet.addColorStop(0, 'rgba(255,255,255,0)')
    reflet.addColorStop(0.45, 'rgba(190,205,235,0.045)')
    reflet.addColorStop(0.55, 'rgba(190,205,235,0.02)')
    reflet.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = reflet
    c.fillRect(0, 0, LARGE, HAUT)
    this.lignes(0.12)
    return this.pixels()
  }

  /** Une image de l'allumage, à `t` secondes. */
  image(t: number): Uint8Array<ArrayBuffer> {
    const c = this.ctx
    c.fillStyle = '#000'
    c.fillRect(0, 0, LARGE, HAUT)

    // ── Le tube qui chauffe ──────────────────────────────────────────────────
    if (t < 0.85) {
      const ouvre = Math.min(1, t / 0.22)
      const epaisseur = t < 0.34 ? 2 : 2 + ((t - 0.34) / 0.28) ** 2 * HAUT
      const large = LARGE * ouvre
      const halo = c.createLinearGradient(0, HAUT / 2 - epaisseur / 2, 0, HAUT / 2 + epaisseur / 2)
      const force = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.3)
      halo.addColorStop(0, `rgba(255,190,120,0)`)
      halo.addColorStop(0.5, `rgba(255,236,208,${0.95 * force})`)
      halo.addColorStop(1, `rgba(255,190,120,0)`)
      c.fillStyle = halo
      c.fillRect((LARGE - large) / 2, HAUT / 2 - epaisseur / 2, large, epaisseur)
    }

    // ── Le compte rendu ──────────────────────────────────────────────────────
    c.font = '15px "Consolas", "DejaVu Sans Mono", monospace'
    c.textBaseline = 'top'
    let ligne = 0
    for (const entree of JOURNAL) {
      if (t < entree.at) break
      // Chaque ligne s'écrit d'un coup mais s'allume en un dixième de seconde : un texte
      // qui apparaît net est un texte collé, un texte qui monte est un texte affiché.
      const age = Math.min(1, (t - entree.at) / 0.1)
      c.fillStyle = `rgba(228,138,42,${0.85 * age})`
      if (entree.texte) c.fillText(entree.texte, 26, 26 + ligne * 19)
      ligne++
    }

    // Le curseur, qui bat pendant qu'on attend.
    if (t > 0.95 && t < 2.62 && Math.floor(t * 3) % 2 === 0) {
      c.fillStyle = 'rgba(228,138,42,0.85)'
      c.fillRect(26, 26 + ligne * 19 + 3, 9, 13)
    }

    // ── Le nom, pour finir ───────────────────────────────────────────────────
    if (t > 2.6) {
      const monte = Math.min(1, (t - 2.6) / 0.2)
      c.fillStyle = '#000'
      c.fillRect(0, 0, LARGE, HAUT)
      c.font = 'bold 46px "Consolas", "DejaVu Sans Mono", monospace'
      c.textAlign = 'center'
      c.fillStyle = `rgba(232,146,48,${monte})`
      c.fillText('WOLF3D', LARGE / 2, HAUT / 2 - 34)
      c.font = '14px "Consolas", "DejaVu Sans Mono", monospace'
      c.fillStyle = `rgba(150,96,44,${monte})`
      c.fillText('le code d’origine, compile pour le navigateur', LARGE / 2, HAUT / 2 + 26)
      c.textAlign = 'left'
    }

    this.lignes(0.16)
    // Un tremblement de luminance : une dalle qui vient de s'allumer n'est jamais stable.
    const vacille = 0.06 * Math.sin(t * 47) * Math.max(0, 1 - t / DUREE)
    if (vacille > 0) {
      c.fillStyle = `rgba(255,255,255,${vacille})`
      c.fillRect(0, 0, LARGE, HAUT)
    }
    return this.pixels()
  }

  /** Les lignes de balayage. C'est ce qui fait qu'on lit « écran » et non « image ». */
  private lignes(force: number): void {
    this.ctx.fillStyle = `rgba(0,0,0,${force})`
    for (let y = 0; y < HAUT; y += 3) this.ctx.fillRect(0, y, LARGE, 1)
  }

  private pixels(): Uint8Array<ArrayBuffer> {
    const data = this.ctx.getImageData(0, 0, LARGE, HAUT).data
    return new Uint8Array(data.buffer.slice(0)) as Uint8Array<ArrayBuffer>
  }
}
