import { presets } from '../player/player'
import type { RenderStats } from '../render/renderer'
import type { Vec3 } from '../math/vec3'

export interface HudData {
  fps: number
  cell: string
  pos: Vec3
  crossings: number
  maxDepth: number
  projectiles: number
  stats: RenderStats
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

  constructor() {
    this.stats = panel('stats')
    this.keys = panel('keys')

    const reticle = document.createElement('div')
    reticle.id = 'reticle'
    document.body.append(reticle)

    this.keys.textContent = [
      'ZQSD / WASD  se déplacer      Maj  courir      Espace  sauter',
      'F  lancer un cube             R  tout retirer',
      '[  ]  profondeur de récursion H  masquer les panneaux',
      'P  paramètres                 T  couper les matières (diagnostic)',
      `1 – ${presets().length}  points de vue du test`,
    ].join('\n')
  }

  toggle(): void {
    this.setVisible(this.stats.hidden)
  }

  setVisible(visible: boolean): void {
    this.stats.hidden = !visible
    this.keys.hidden = !visible
  }

  update(d: HudData): void {
    if (this.stats.hidden) return
    this.stats.textContent = [
      `${d.fps.toFixed(0).padStart(3)} i/s`,
      `cellule      ${d.cell}`,
      `position     ${f(d.pos.x)} ${f(d.pos.y)} ${f(d.pos.z)}`,
      `traversées   ${d.crossings}`,
      '',
      `passes       ${d.stats.passes}`,
      `profondeur   ${d.stats.deepest} / ${d.maxDepth}`,
      `copies       ${d.stats.copies}`,
      `écartées     ${d.stats.skipped}`,
      `cubes        ${d.projectiles}`,
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
