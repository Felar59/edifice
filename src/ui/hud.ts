import { presets } from '../player/player'
import type { RenderStats } from '../render/renderer'
import type { Vec3 } from '../math/vec3'
import type { RayHit } from '../world/ray'

export interface HudData {
  fps: number
  cell: string
  pos: Vec3
  crossings: number
  maxDepth: number
  projectiles: number
  stats: RenderStats
  /** Ce que le rayon d'interaction rencontre droit devant, s'il rencontre quelque chose. */
  aim: RayHit | null
  /** L'invite d'une machine à portée de main, s'il y en a une. */
  prompt: string | null
}

/**
 * Panneaux de mise au point.
 *
 * Il y en avait un troisième, à droite : la liste du test de torture, affichée en permanence
 * pour qu'on ne s'autorise pas à l'oublier tant que l'étape 1 n'était pas irréprochable. Elle
 * l'est, `npm run torture` la déroule seul à chaque modification, et un rappel qu'on ne lit
 * plus n'est plus un rappel — c'est un quart d'écran en moins.
 */
export class Hud {
  private readonly stats: HTMLElement
  private readonly keys: HTMLElement
  /**
   * L'invite d'une machine.
   *
   * Le seul texte du musée qui s'adresse au visiteur, et il n'apparaît qu'à portée de main.
   * Le plan interdit les notices et les menus ; il ne dit rien contre trois mots qui
   * n'existent que devant l'objet qu'ils désignent. Sans eux, une machine qui tourne toute
   * seule reste un décor, et personne n'essaie de la toucher.
   */
  private readonly prompt: HTMLElement

  constructor() {
    this.stats = panel('stats')
    this.keys = panel('keys')
    this.prompt = panel('prompt')

    const reticle = document.createElement('div')
    reticle.id = 'reticle'
    document.body.append(reticle)

    this.keys.textContent = [
      'ZQSD / WASD  se déplacer      Maj  courir      Espace  sauter',
      'F  lancer un cube             R  tout retirer',
      '[  ]  profondeur de récursion H  masquer les panneaux',
      'P  paramètres — ou lâcher une machine    T  couper les matières',
      `1 – ${presets().length}  points de vue du test`,
    ].join('\n')
  }

  /** Le panneau de mesures est-il à l'écran ? Ce qui ne se voit pas ne se calcule pas. */
  get diagnostics(): boolean {
    return !this.stats.hidden
  }

  toggle(): void {
    this.setVisible(this.stats.hidden)
  }

  setVisible(visible: boolean): void {
    this.stats.hidden = !visible
    this.keys.hidden = !visible
  }

  update(d: HudData): void {
    // L'invite reste visible quand les panneaux sont masqués : c'est du jeu, pas de la mise
    // au point.
    this.prompt.hidden = d.prompt === null
    this.prompt.textContent = d.prompt ?? ''

    if (this.stats.hidden) return
    this.stats.textContent = [
      `${d.fps.toFixed(0).padStart(3)} i/s`,
      `cellule      ${d.cell}`,
      `position     ${f(d.pos.x)} ${f(d.pos.y)} ${f(d.pos.z)}`,
      `traversées   ${d.crossings}`,
      '',
      `passes       ${d.stats.passes}`,
      `remplissage  ${d.stats.fill.toFixed(2)} écran(s)`,
      `profondeur   ${d.stats.deepest} / ${d.maxDepth}`,
      `copies       ${d.stats.copies}`,
      `écartées     ${d.stats.skipped}`,
      `cubes        ${d.projectiles}`,
      '',
      // **Le rayon d'interaction, lu en direct.** C'est son premier usage, et le plus
      // modeste : savoir ce qu'on regarde et à quelle distance. C'est aussi le seul moyen
      // de voir de ses yeux qu'il traverse — viser une porte doit annoncer la salle d'en
      // face, pas la porte.
      d.aim
        ? `visée        ${d.aim.cell} ${d.aim.distance.toFixed(2)} m` +
          (d.aim.crossings > 0 ? ` · ${d.aim.crossings} couture(s)` : '') +
          (d.aim.block ? ' · bloc' : '')
        : 'visée        —',
    ].join('\n')
  }
}

function panel(id: string): HTMLElement {
  const el = document.createElement('div')
  el.id = id
  el.className = 'panel'
  document.body.append(el)
  return el
}

const f = (n: number): string => n.toFixed(2).padStart(7)
