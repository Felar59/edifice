/**
 * **Le son d'une borne**, calculé et non enregistré.
 *
 * Le musée n'a jamais chargé de matière : ses bétons, ses tôles et ses bois sont des
 * fonctions. Le son suit la même règle, et pour les mêmes raisons — un fichier pèse, se
 * charge, et fige. Trois oscillateurs et un souffle filtré donnent le déclic d'un
 * interrupteur, la montée d'un tube et le ronronnement d'un meuble, et cela ne coûte rien.
 *
 * ## Ce qu'on entend
 *
 * Le **déclic** : un contact qui se ferme. Une impulsion très courte de bruit passée dans un
 * passe-bande aigu, doublée d'un coup sourd — c'est le corps du meuble qui répond, et c'est
 * lui qui donne au geste son poids.
 *
 * L'**allumage** : la décharge d'un tube cathodique. Un glissando descendant, court, sur une
 * onde en dents de scie très filtrée, avec un souffle qui s'éteint derrière. Puis les
 * **bips** du compte rendu, un par ligne, une sinusoïde nette de trente millisecondes.
 *
 * Le **ronronnement** : deux sinusoïdes graves désaccordées d'un hertz, plus un chuintement
 * très faible. Le battement lent qui en résulte est ce qui distingue une machine allumée
 * d'un silence — on ne l'entend pas, on s'aperçoit qu'il s'arrête.
 *
 * ## Le contexte, et la permission du navigateur
 *
 * Aucun son ne peut naître avant un geste de l'utilisateur. On ne crée donc le contexte
 * qu'au premier appui sur l'interrupteur, ce qui est par construction un geste.
 */

export class Sons {
  private ctx: AudioContext | null = null
  /** Le volume d'ensemble, que la distance à la borne fait varier. */
  private maitre: GainNode | null = null
  private ronronnement: { gain: GainNode; sources: AudioScheduledSourceNode[] } | null = null

  /** Le contexte, créé au premier son — c'est-à-dire au premier geste. */
  private ouvrir(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    }
    const Fabrique = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Fabrique) return null
    this.ctx = new Fabrique()
    this.maitre = this.ctx.createGain()
    this.maitre.gain.value = 0.9
    this.maitre.connect(this.ctx.destination)
    return this.ctx
  }

  /**
   * Le volume selon la distance à la borne.
   *
   * Une borne qu'on entend de l'autre bout du musée n'est pas une borne, c'est une bande
   * sonore. À trois mètres elle est franche, à douze on ne l'entend plus.
   */
  distance(metres: number): void {
    if (!this.maitre || !this.ctx) return
    const force = Math.max(0, Math.min(1, 1 - (metres - 3) / 9))
    this.maitre.gain.setTargetAtTime(0.9 * force, this.ctx.currentTime, 0.12)
  }

  /** Le contact qui se ferme. */
  interrupteur(): void {
    const ctx = this.ouvrir()
    if (!ctx || !this.maitre) return
    const t = ctx.currentTime

    // Le claquement : un souffle très bref, serré dans l'aigu.
    const bruit = ctx.createBufferSource()
    bruit.buffer = this.souffle(ctx, 0.05)
    const bande = ctx.createBiquadFilter()
    bande.type = 'bandpass'
    bande.frequency.value = 2600
    bande.Q.value = 1.4
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.55, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045)
    bruit.connect(bande).connect(g).connect(this.maitre)
    bruit.start(t)
    bruit.stop(t + 0.06)

    // Et le coup sourd du meuble, qui donne au geste son poids.
    const corps = ctx.createOscillator()
    corps.type = 'sine'
    corps.frequency.setValueAtTime(160, t)
    corps.frequency.exponentialRampToValueAtTime(55, t + 0.09)
    const gc = ctx.createGain()
    gc.gain.setValueAtTime(0.32, t)
    gc.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
    corps.connect(gc).connect(this.maitre)
    corps.start(t)
    corps.stop(t + 0.14)
  }

  /** La décharge du tube, au moment où l'écran s'ouvre. */
  allumage(): void {
    const ctx = this.ouvrir()
    if (!ctx || !this.maitre) return
    const t = ctx.currentTime + 0.06

    const tube = ctx.createOscillator()
    tube.type = 'sawtooth'
    tube.frequency.setValueAtTime(1750, t)
    tube.frequency.exponentialRampToValueAtTime(180, t + 0.55)
    const passe = ctx.createBiquadFilter()
    passe.type = 'lowpass'
    passe.frequency.setValueAtTime(3200, t)
    passe.frequency.exponentialRampToValueAtTime(600, t + 0.55)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.06)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    tube.connect(passe).connect(g).connect(this.maitre)
    tube.start(t)
    tube.stop(t + 0.65)

    // Le souffle de la haute tension, derrière.
    const bruit = ctx.createBufferSource()
    bruit.buffer = this.souffle(ctx, 0.7)
    const haut = ctx.createBiquadFilter()
    haut.type = 'highpass'
    haut.frequency.value = 5200
    const gb = ctx.createGain()
    gb.gain.setValueAtTime(0.09, t)
    gb.gain.exponentialRampToValueAtTime(0.0006, t + 0.7)
    bruit.connect(haut).connect(gb).connect(this.maitre)
    bruit.start(t)
    bruit.stop(t + 0.75)
  }

  /** Un bip du compte rendu. Net, court, sans queue. */
  bip(aigu = false): void {
    const ctx = this.ouvrir()
    if (!ctx || !this.maitre) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'square'
    o.frequency.value = aigu ? 1560 : 880
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
    o.connect(g).connect(this.maitre)
    o.start(t)
    o.stop(t + 0.05)
  }

  /**
   * Le souffle de l'immersion : on entre dans la borne, ou l'on en sort.
   *
   * Une montée pour entrer, une descente pour sortir — et du souffle balayé par un filtre
   * qui s'ouvre. C'est court, et cela ne fait qu'une chose : dire au corps que l'image qui
   * grandit est un déplacement et non un changement d'écran.
   */
  plonger(retour: boolean): void {
    const ctx = this.ouvrir()
    if (!ctx || !this.maitre) return
    const t = ctx.currentTime
    const duree = retour ? 0.34 : 0.52

    const bruit = ctx.createBufferSource()
    bruit.buffer = this.souffle(ctx, duree + 0.1)
    const balai = ctx.createBiquadFilter()
    balai.type = 'bandpass'
    balai.Q.value = 0.9
    balai.frequency.setValueAtTime(retour ? 2400 : 320, t)
    balai.frequency.exponentialRampToValueAtTime(retour ? 260 : 2600, t + duree)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + duree * 0.35)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree)
    bruit.connect(balai).connect(g).connect(this.maitre)
    bruit.start(t)
    bruit.stop(t + duree + 0.05)

    // Et une basse qui accompagne le mouvement, pour lui donner un corps.
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(retour ? 220 : 70, t)
    o.frequency.exponentialRampToValueAtTime(retour ? 65 : 210, t + duree)
    const go = ctx.createGain()
    go.gain.setValueAtTime(0.0001, t)
    go.gain.exponentialRampToValueAtTime(0.13, t + duree * 0.3)
    go.gain.exponentialRampToValueAtTime(0.0001, t + duree)
    o.connect(go).connect(this.maitre)
    o.start(t)
    o.stop(t + duree + 0.05)
  }

  /**
   * Le ronronnement du meuble, tant qu'il est allumé.
   *
   * Deux graves désaccordés d'un hertz : le battement lent qu'ils font entre eux est ce qui
   * rend une machine vivante. Sans lui, l'écran s'allume mais le meuble reste un décor.
   */
  ronron(marche: boolean): void {
    if (!marche) {
      if (!this.ronronnement || !this.ctx) return
      const { gain, sources } = this.ronronnement
      const t = this.ctx.currentTime
      gain.gain.setTargetAtTime(0.0001, t, 0.15)
      for (const s of sources) s.stop(t + 0.8)
      this.ronronnement = null
      return
    }

    const ctx = this.ouvrir()
    if (!ctx || !this.maitre || this.ronronnement) return
    const t = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.setTargetAtTime(0.05, t, 0.4)
    gain.connect(this.maitre)

    const sources: AudioScheduledSourceNode[] = []
    for (const hz of [50, 51]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz
      o.connect(gain)
      o.start(t)
      sources.push(o)
    }
    // Le chuintement de l'alimentation, tout au fond.
    const bruit = ctx.createBufferSource()
    bruit.buffer = this.souffle(ctx, 2)
    bruit.loop = true
    const filtre = ctx.createBiquadFilter()
    filtre.type = 'bandpass'
    filtre.frequency.value = 7800
    filtre.Q.value = 0.7
    const gb = ctx.createGain()
    gb.gain.value = 0.05
    bruit.connect(filtre).connect(gb).connect(gain)
    bruit.start(t)
    sources.push(bruit)

    this.ronronnement = { gain, sources }
  }

  /** Du bruit blanc, la seule matière première dont on ait besoin. */
  private souffle(ctx: AudioContext, secondes: number): AudioBuffer {
    const n = Math.max(1, Math.floor(ctx.sampleRate * secondes))
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate)
    const canal = buffer.getChannelData(0)
    for (let i = 0; i < n; i++) canal[i] = Math.random() * 2 - 1
    return buffer
  }
}
