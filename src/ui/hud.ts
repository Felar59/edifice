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
 * Le panneau de droite n'est pas décoratif : c'est la liste du test de torture,
 * affichée en permanence pour qu'on ne s'autorise pas à l'oublier. Tant que les
 * six points ne sont pas irréprochables, l'étape 1 n'est pas terminée.
 */
export class Hud {
  private readonly stats: HTMLElement
  private readonly keys: HTMLElement
  private readonly torture: HTMLElement

  constructor() {
    this.stats = panel('stats')
    this.keys = panel('keys')
    this.torture = panel('torture')

    const reticle = document.createElement('div')
    reticle.id = 'reticle'
    document.body.append(reticle)

    this.keys.textContent = [
      'ZQSD / WASD  se déplacer      Maj  courir      Espace  sauter',
      'F  lancer un cube             R  tout retirer',
      '[  ]  profondeur de récursion H  masquer les panneaux',
      'P  paramètres',
      `1 – ${presets().length}  points de vue du test`,
    ].join('\n')

    this.torture.innerHTML =
      '<b>Test de torture — l’étape 1 n’est finie que si tout tient</b>\n' +
      presets().map((p, i) => `${i + 1}. ${p.name}`).join('\n') +
      '\n· Cube lancé à travers, en cloche, en biais' +
      '\n· Cube immobilisé à moitié dans l’ouverture' +
      '\n· Traversée en marche arrière, à pleine vitesse'
  }

  toggle(): void {
    this.setVisible(this.stats.hidden)
  }

  setVisible(visible: boolean): void {
    this.stats.hidden = !visible
    this.keys.hidden = !visible
    this.torture.hidden = !visible
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
