/**
 * **L'allumage d'une machine.**
 *
 * Une borne qui s'allume ne montre pas son jeu tout de suite. Un tube met une seconde à
 * chauffer, une carte compte sa mémoire, et c'est pendant ce temps-là qu'on comprend qu'on
 * vient d'appuyer sur un vrai bouton. Sans cette seconde, l'écran change d'image et l'on n'a
 * rien fait ; avec elle, on a démarré quelque chose.
 *
 * ## Ce qui se passe, dans l'ordre
 *
 * D'abord **le tube** : un point au centre, qui claque en une ligne, qui s'épanouit en une
 * image — et ce que l'image contient à cet instant, c'est de la neige, parce qu'un tube qui
 * chauffe reçoit du signal avant d'avoir de quoi l'interpréter. L'image roule une fois sur
 * elle-même le temps que la synchronisation accroche, puis la neige meurt.
 *
 * Ensuite **le compte rendu**, en ambre sur la rémanence : il dit la vérité sur ce qui tourne
 * derrière — le vrai code en C, sa bibliothèque portée, la mémoire du module — et la mémoire
 * se compte sous les yeux, parce que c'est ce que faisait toute carte de cette époque.
 *
 * Enfin **le casque** : le vrai logo du jeu, repris pixel pour pixel de ses ressources, qui
 * se matérialise dans un halo et dont les yeux s'allument en dernier. C'est lui qui dit à
 * quel jeu on vient de rendre le courant, sans qu'un mot soit nécessaire.
 *
 * ## Pourquoi un canevas à deux dimensions
 *
 * Le musée dessine tout par la géométrie et n'a jamais chargé la moindre image. Mais l'écran
 * d'une machine est déjà une exception assumée — c'est une couche du tableau de textures,
 * réécrite à chaque instant par le projet qui tourne derrière. Y peindre une animation ne
 * demande donc rien de nouveau, et c'est la seule façon raisonnable d'avoir du **texte**.
 */

import tubeUrl from '../assets/wolf-tube.png?url'

/** La taille des couches du tableau de textures : c'est là qu'on écrit. */
const LARGE = 512
const HAUT = 288

/** Combien de temps dure l'allumage, en secondes. */
export const DUREE = 3.5

/** Les jalons du tube : le point, la ligne, l'ouverture, la neige morte. */
const T_POINT = 0.14
const T_LIGNE = 0.34
const T_OUVERT = 0.52
const T_STABLE = 1.0
/** Et celui du casque. */
const T_CASQUE = 2.56

/**
 * Les lignes du compte rendu, et l'instant où chacune apparaît.
 *
 * Elles disent la vérité sur ce qui tourne derrière. Un faux compte rendu serait un décor ;
 * celui-ci est une fiche technique, et c'est ce que le musée doit à un visiteur qui s'arrête.
 * La ligne `compte` s'écrit en comptant : voir le rendu, plus bas.
 */
const JOURNAL: readonly { at: number; texte: string; compte?: number }[] = [
  { at: 0.98, texte: 'EDIFICE ARCADE SYSTEM  v1.0' },
  { at: 1.14, texte: '' },
  { at: 1.22, texte: 'CPU ...... WebAssembly · 64k pages' },
  { at: 1.38, texte: 'MEM ...... ', compte: 16384 },
  { at: 1.92, texte: 'GPU ...... WebGL 2 · pipeline fixe emule' },
  { at: 2.06, texte: 'SND ...... OpenAL' },
  { at: 2.16, texte: '' },
  { at: 2.24, texte: 'LOAD ..... wolf3d.c        [OK]' },
  { at: 2.36, texte: 'LOAD ..... SFML 2.6        [PORTEE]' },
  { at: 2.46, texte: '' },
]

/**
 * Les instants où une ligne s'écrit, pour que le son suive l'image.
 *
 * Le musée n'a pas à savoir ce qui est écrit — seulement quand quelque chose apparaît, pour
 * poser un bip dessus. Les lignes vides n'en font pas partie : on ne bipe pas un silence.
 */
export const JALONS: readonly number[] = JOURNAL.filter((l) => l.texte).map((l) => l.at)

/** Où sont les yeux du casque, mesuré sur le sprite. Voir le script de fabrication. */
const YEUX: readonly [number, number][] = [
  [0.301, 0.57],
  [0.69, 0.553],
]

const AMBRE = '228,138,42'

/** Départ vif, arrivée posée. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3
/** Un dépassement bref, comme une grandeur physique qui accroche sa consigne. */
const overshoot = (t: number): number => 1 + 2.6 * (1 - t) ** 2 * Math.sin(t * Math.PI * 2.2) * 0.14

export class Demarrage {
  private readonly canevas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  /** Un second canevas, pour les effets qui relisent l'image — le roulement, les tranches. */
  private readonly tampon: HTMLCanvasElement
  private readonly tctx: CanvasRenderingContext2D
  /** Trois plaques de neige, tirées une fois : les recomposer par décalage suffit. */
  private readonly neiges: HTMLCanvasElement[]
  /** Le casque du jeu. S'il n'est pas encore chargé, la fin de l'allumage s'en passe. */
  private readonly casque = new Image()

  constructor() {
    this.canevas = document.createElement('canvas')
    this.canevas.width = LARGE
    this.canevas.height = HAUT
    const ctx = this.canevas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error("pas de contexte 2d pour l'écran de la borne")
    this.ctx = ctx

    this.tampon = document.createElement('canvas')
    this.tampon.width = LARGE
    this.tampon.height = HAUT
    this.tctx = this.tampon.getContext('2d')!

    this.neiges = [0, 1, 2].map(() => {
      const c = document.createElement('canvas')
      c.width = 128
      c.height = 72
      const cc = c.getContext('2d')!
      const donnees = cc.createImageData(128, 72)
      for (let i = 0; i < donnees.data.length; i += 4) {
        const v = Math.random() * 255
        donnees.data[i] = v
        donnees.data[i + 1] = v
        donnees.data[i + 2] = v
        donnees.data[i + 3] = 255
      }
      cc.putImageData(donnees, 0, 0)
      return c
    })

    this.casque.src = tubeUrl
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

    if (t < T_OUVERT) this.tube(t)
    else {
      this.neige(t)
      this.journal(t)
      if (t >= T_CASQUE) this.revelation(t)
      this.roulement(t)
      this.tranches(t)
    }

    this.balayage(t)
    this.lignes(0.16)
    this.vignette()

    // À la toute fin, l'image plonge au noir : c'est la coupure de signal qui précède le
    // vrai jeu, et c'est elle qui fait lire le raccord comme un changement de source.
    if (t > DUREE - 0.12) {
      c.fillStyle = `rgba(0,0,0,${(t - (DUREE - 0.12)) / 0.12})`
      c.fillRect(0, 0, LARGE, HAUT)
    }
    return this.pixels()
  }

  // ── Le tube ─────────────────────────────────────────────────────────────────
  //
  // Un point, une ligne, une image. Chaque étape claque au lieu de glisser : un tube
  // cathodique n'est pas un fondu, c'est une décharge qui accroche.
  private tube(t: number): void {
    const c = this.ctx
    const cx = LARGE / 2
    const cy = HAUT / 2

    if (t < T_POINT) {
      // Le point : une braise qui force au centre.
      const monte = easeOut(t / T_POINT)
      const rayon = 1 + monte * 3.2
      const halo = c.createRadialGradient(cx, cy, 0, cx, cy, rayon * 7)
      halo.addColorStop(0, `rgba(255,244,224,${0.95 * monte})`)
      halo.addColorStop(0.25, `rgba(255,196,120,${0.5 * monte})`)
      halo.addColorStop(1, 'rgba(255,150,60,0)')
      c.fillStyle = halo
      c.fillRect(cx - rayon * 8, cy - rayon * 8, rayon * 16, rayon * 16)
      return
    }

    if (t < T_LIGNE) {
      // La ligne : elle part du point et file jusqu'aux bords, avec un léger dépassement
      // de brillance au moment où elle touche.
      const f = easeOut((t - T_POINT) / (T_LIGNE - T_POINT))
      const demi = (LARGE / 2) * f
      const grad = c.createLinearGradient(cx - demi, 0, cx + demi, 0)
      grad.addColorStop(0, 'rgba(255,170,90,0)')
      grad.addColorStop(0.12, 'rgba(255,220,170,0.85)')
      grad.addColorStop(0.5, 'rgba(255,252,240,1)')
      grad.addColorStop(0.88, 'rgba(255,220,170,0.85)')
      grad.addColorStop(1, 'rgba(255,170,90,0)')
      c.fillStyle = grad
      c.fillRect(cx - demi, cy - 1.4, demi * 2, 2.8)
      // Le halo au-dessus et au-dessous de la ligne.
      const doux = c.createLinearGradient(0, cy - 14, 0, cy + 14)
      doux.addColorStop(0, 'rgba(255,180,100,0)')
      doux.addColorStop(0.5, `rgba(255,200,130,${0.3 * f})`)
      doux.addColorStop(1, 'rgba(255,180,100,0)')
      c.fillStyle = doux
      c.fillRect(cx - demi, cy - 14, demi * 2, 28)
      return
    }

    // L'ouverture : la ligne s'épanouit en une image pleine de neige, avec le
    // dépassement d'une grandeur qui accroche — l'image est un instant **trop** haute.
    const f = easeOut((t - T_LIGNE) / (T_OUVERT - T_LIGNE))
    const demiHaut = Math.min(HAUT / 2, (HAUT / 2) * f * overshoot(f))
    c.save()
    c.beginPath()
    c.rect(0, cy - demiHaut, LARGE, demiHaut * 2)
    c.clip()
    this.neigeBrute(1)
    c.restore()
    // Les deux lèvres de l'ouverture restent incandescentes.
    for (const y of [cy - demiHaut, cy + demiHaut]) {
      c.fillStyle = `rgba(255,240,215,${0.9 * (1 - f)})`
      c.fillRect(0, y - 1.2, LARGE, 2.4)
    }
    // Et l'éclair de la décharge, qui blanchit tout au moment où l'image s'ouvre.
    c.fillStyle = `rgba(255,248,235,${0.55 * (1 - f)})`
    c.fillRect(0, 0, LARGE, HAUT)
  }

  // ── La neige ────────────────────────────────────────────────────────────────
  //
  // Le tube reçoit du signal avant d'avoir de quoi l'interpréter : de la neige pleine
  // image d'abord, qui meurt en une demi-seconde et laisse un fourmillement résiduel.
  private neige(t: number): void {
    let force = t < T_STABLE ? 0.85 * (1 - (t - T_OUVERT) / (T_STABLE - T_OUVERT)) ** 1.6 : 0.04
    // Le fourmillement résiduel s'éteint quand le casque paraît : le logo mérite un noir
    // propre, et un tube qui a accroché son signal ne fourmille plus.
    if (t >= T_CASQUE) force *= Math.max(0, 1 - (t - T_CASQUE) / 0.25)
    if (force <= 0.005) return
    this.neigeBrute(force)
  }

  private neigeBrute(alpha: number): void {
    const c = this.ctx
    const plaque = this.neiges[Math.floor(Math.random() * this.neiges.length)]!
    c.save()
    c.globalAlpha = alpha
    c.imageSmoothingEnabled = false
    // Deux passes décalées : la trame de 128×72 disparaît, il ne reste que du grain.
    c.drawImage(plaque, Math.random() * -18, Math.random() * -14, LARGE + 20, HAUT + 16)
    c.globalAlpha = alpha * 0.6
    c.drawImage(plaque, Math.random() * -30, Math.random() * -22, LARGE + 34, HAUT + 26)
    c.restore()
  }

  // ── Le compte rendu ─────────────────────────────────────────────────────────
  private journal(t: number): void {
    const c = this.ctx
    if (t >= T_CASQUE) return
    c.font = '15px "Consolas", "DejaVu Sans Mono", monospace'
    c.textBaseline = 'top'
    c.textAlign = 'left'

    let ligne = 0
    for (const entree of JOURNAL) {
      if (t < entree.at) break
      const age = t - entree.at
      const y = 24 + ligne * 19
      ligne++
      if (!entree.texte) continue

      // Une ligne neuve brille un instant au-dessus de sa teinte de croisière : c'est le
      // phosphore qui reçoit son premier balayage.
      const brulure = Math.max(0, 1 - age / 0.14)
      c.fillStyle = `rgba(${AMBRE},${0.82 + 0.18 * brulure})`
      if (brulure > 0.35) c.fillStyle = `rgba(255,220,170,${0.85 + 0.15 * brulure})`

      if (entree.compte) {
        // La mémoire se compte sous les yeux, par pas irréguliers — une vraie carte ne
        // compte pas rond — puis la ligne se conclut d'un OK.
        const fini = Math.min(1, age / 0.48)
        const valeur = Math.floor(entree.compte * easeOut(fini))
        const texte = `${entree.texte}${String(valeur).padStart(5, ' ')} Ko${fini >= 1 ? '   OK' : ''}`
        c.fillText(texte, 26, y)
      } else {
        c.fillText(entree.texte, 26, y)
      }
    }

    // Le curseur, qui bat au pied du texte pendant qu'on attend.
    if (Math.floor(t * 3.4) % 2 === 0) {
      c.fillStyle = `rgba(${AMBRE},0.85)`
      c.fillRect(26, 24 + ligne * 19 + 2, 9, 14)
    }

    // La rémanence du tube : un voile chaud qui respire à peine, pour que le noir du
    // fond ne soit jamais le noir d'un écran éteint.
    const souffle = 0.05 + 0.012 * Math.sin(t * 9)
    const fond = c.createRadialGradient(LARGE / 2, HAUT / 2, 40, LARGE / 2, HAUT / 2, LARGE * 0.62)
    fond.addColorStop(0, `rgba(255,180,90,${souffle})`)
    fond.addColorStop(1, 'rgba(255,180,90,0)')
    c.fillStyle = fond
    c.fillRect(0, 0, LARGE, HAUT)
  }

  // ── Le casque ───────────────────────────────────────────────────────────────
  //
  // Le logo se matérialise : le halo d'abord, le casque qui monte dedans avec deux
  // vacillements, les yeux qui s'allument en dernier, et le nom qui resserre son
  // espacement comme un titre qui se pose.
  private revelation(t: number): void {
    const c = this.ctx
    const age = t - T_CASQUE
    const cx = LARGE / 2
    const cy = HAUT / 2 - 18

    // Le halo, qui précède la forme.
    const halo = Math.min(1, age / 0.25)
    const grad = c.createRadialGradient(cx, cy, 6, cx, cy, 130)
    grad.addColorStop(0, `rgba(255,170,80,${0.24 * halo})`)
    grad.addColorStop(0.6, `rgba(200,90,30,${0.1 * halo})`)
    grad.addColorStop(1, 'rgba(120,50,20,0)')
    c.fillStyle = grad
    c.fillRect(0, 0, LARGE, HAUT)

    // Le casque. Deux vacillements francs pendant qu'il monte — un tube n'affiche
    // jamais une image neuve du premier coup — puis il tient.
    if (this.casque.complete && this.casque.naturalWidth > 0) {
      const monte = Math.min(1, age / 0.3)
      let alpha = easeOut(monte)
      if (age > 0.08 && age < 0.12) alpha *= 0.25
      if (age > 0.19 && age < 0.22) alpha *= 0.45
      const taille = 132 * (0.92 + 0.08 * easeOut(monte))
      const x = cx - taille / 2
      const y = cy - taille / 2
      c.save()
      c.imageSmoothingEnabled = false
      c.globalAlpha = alpha
      c.drawImage(this.casque, x, y, taille, taille)
      c.restore()

      // Les yeux, en dernier : deux lueurs additives sur les verres du masque, qui
      // clignent une fois puis restent — c'est le moment où la machine regarde.
      const oeil = age - 0.42
      if (oeil > 0) {
        let force = Math.min(1, oeil / 0.1)
        if (oeil > 0.14 && oeil < 0.2) force *= 0.15
        force *= 0.85 + 0.15 * Math.sin(t * 5.2)
        c.save()
        c.globalCompositeOperation = 'lighter'
        for (const [ex, ey] of YEUX) {
          const px = x + ex * taille
          const py = y + ey * taille
          const lueur = c.createRadialGradient(px, py, 0, px, py, 15)
          lueur.addColorStop(0, `rgba(255,190,90,${0.85 * force})`)
          lueur.addColorStop(0.3, `rgba(255,130,30,${0.5 * force})`)
          lueur.addColorStop(1, 'rgba(255,90,10,0)')
          c.fillStyle = lueur
          c.fillRect(px - 16, py - 16, 32, 32)
        }
        c.restore()
      }
    }

    // Le nom, avec un espacement qui se resserre et une frange colorée qui se résorbe :
    // la convergence d'un tube n'est jamais parfaite au premier instant.
    const titre = Math.min(1, Math.max(0, (age - 0.3) / 0.3))
    if (titre > 0) {
      const y = cy + 86
      const espacement = 6 + 14 * (1 - easeOut(titre))
      const frange = 2.5 * (1 - easeOut(titre))
      c.font = 'bold 34px "Consolas", "DejaVu Sans Mono", monospace'
      c.textBaseline = 'middle'
      this.titre('WOLF3D', cx, y, espacement, frange, titre)

      c.font = '12px "Consolas", "DejaVu Sans Mono", monospace'
      c.textAlign = 'center'
      c.fillStyle = `rgba(170,105,50,${0.8 * Math.max(0, titre - 0.4) * 1.7})`
      c.fillText('le code d’origine, compilé pour le navigateur', cx, y + 32)
      c.textAlign = 'left'
    }
  }

  /** Un titre espacé à la main, avec sa frange rouge/cyan de convergence. */
  private titre(texte: string, cx: number, y: number, espacement: number, frange: number, alpha: number): void {
    const c = this.ctx
    c.textAlign = 'left'
    const largeurs = [...texte].map((l) => c.measureText(l).width)
    const total = largeurs.reduce((a, b) => a + b, 0) + espacement * (texte.length - 1)
    let x = cx - total / 2
    for (let i = 0; i < texte.length; i++) {
      const lettre = texte[i]!
      if (frange > 0.2) {
        c.fillStyle = `rgba(255,60,40,${0.4 * alpha})`
        c.fillText(lettre, x - frange, y)
        c.fillStyle = `rgba(60,200,255,${0.32 * alpha})`
        c.fillText(lettre, x + frange, y)
      }
      c.fillStyle = `rgba(255,208,150,${alpha})`
      c.fillText(lettre, x, y)
      x += largeurs[i]! + espacement
    }
  }

  // ── Les défauts du tube ─────────────────────────────────────────────────────

  /**
   * Le roulement de synchronisation : l'image tourne une fois sur elle-même juste après
   * l'ouverture, le temps que la trame accroche, avec la barre claire de déchirure au pli.
   */
  private roulement(t: number): void {
    if (t < T_OUVERT || t > T_STABLE) return
    const f = easeOut((t - T_OUVERT) / (T_STABLE - T_OUVERT))
    const decalage = Math.round(HAUT * (1 - f) * 1.35) % HAUT
    if (decalage === 0) return

    const c = this.ctx
    this.tctx.clearRect(0, 0, LARGE, HAUT)
    this.tctx.drawImage(this.canevas, 0, 0)
    c.clearRect(0, 0, LARGE, HAUT)
    c.drawImage(this.tampon, 0, decalage)
    c.drawImage(this.tampon, 0, decalage - HAUT)
    c.fillStyle = 'rgba(255,235,205,0.35)'
    c.fillRect(0, decalage - 1.5, LARGE, 3)
  }

  /**
   * Deux accrocs : une tranche de l'image qui glisse de côté un instant, comme un signal
   * qui hésite. Déclenchés à des instants fixes, courts, et jamais pendant le casque.
   */
  private tranches(t: number): void {
    for (const [debut, y, haut, saut] of [
      [1.66, 60, 22, 9],
      [2.28, 128, 14, -7],
    ] as const) {
      if (t < debut || t > debut + 0.07) continue
      const c = this.ctx
      this.tctx.clearRect(0, y, LARGE, haut)
      this.tctx.drawImage(this.canevas, 0, y, LARGE, haut, 0, y, LARGE, haut)
      c.clearRect(0, y, LARGE, haut)
      c.drawImage(this.tampon, 0, y, LARGE, haut, saut, y, LARGE, haut)
    }
  }

  /** La barre sombre qui descend lentement : le battement entre la trame et le secteur. */
  private balayage(t: number): void {
    const c = this.ctx
    const y = ((t * 46) % (HAUT + 80)) - 40
    const bande = c.createLinearGradient(0, y - 26, 0, y + 26)
    bande.addColorStop(0, 'rgba(0,0,0,0)')
    bande.addColorStop(0.5, 'rgba(0,0,0,0.10)')
    bande.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = bande
    c.fillRect(0, y - 26, LARGE, 52)
  }

  /** Les lignes de balayage. C'est ce qui fait qu'on lit « écran » et non « image ». */
  private lignes(force: number): void {
    this.ctx.fillStyle = `rgba(0,0,0,${force})`
    for (let y = 0; y < HAUT; y += 3) this.ctx.fillRect(0, y, LARGE, 1)
  }

  /** Les coins s'assombrissent : c'est la courbure du verre, sans courber quoi que ce soit. */
  private vignette(): void {
    const c = this.ctx
    const v = c.createRadialGradient(LARGE / 2, HAUT / 2, HAUT * 0.55, LARGE / 2, HAUT / 2, LARGE * 0.72)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,0.42)')
    c.fillStyle = v
    c.fillRect(0, 0, LARGE, HAUT)
  }

  private pixels(): Uint8Array<ArrayBuffer> {
    const data = this.ctx.getImageData(0, 0, LARGE, HAUT).data
    return new Uint8Array(data.buffer.slice(0)) as Uint8Array<ArrayBuffer>
  }
}
