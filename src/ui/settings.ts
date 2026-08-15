/**
 * La page de paramètres.
 *
 * Elle n'en contient qu'un pour l'instant — le **champ de vision** —, et c'est délibéré :
 * mieux vaut une page qui existe et ne propose qu'une chose vraie qu'une page pleine de
 * réglages qu'on n'a pas encore décidé d'offrir. Ce qu'elle contiendra se choisira plus
 * tard ; ce qui est déjà en place, c'est l'endroit où le mettre, la persistance, et la
 * règle d'ouverture.
 *
 * **Ouvrir la page rend la souris.** Un musée qui capture le pointeur ne peut pas offrir
 * une page qu'on manipule au pointeur sans le relâcher d'abord. C'est aussi ce qui la rend
 * inoffensive : tant qu'elle est ouverte, on ne marche plus, donc on ne peut pas se
 * retrouver ailleurs en la refermant.
 *
 * Les valeurs sont conservées d'une visite à l'autre. Quelqu'un qui a resserré le champ
 * parce que le défilement périphérique l'indispose n'a pas à recommencer à chaque fois.
 */

export interface Settings {
  /** Champ de vision vertical, en degrés. */
  fov: number
}

export const DEFAULTS: Settings = { fov: 72 }

const RANGE = { min: 55, max: 100 }
const KEY = 'edifice.parametres'

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      fov: clamp(typeof saved.fov === 'number' ? saved.fov : DEFAULTS.fov, RANGE.min, RANGE.max),
    }
  } catch {
    // Un stockage refusé — navigation privée, réglages stricts — ne doit pas empêcher
    // d'entrer dans le musée. On repart des valeurs par défaut, sans rien dire.
    return { ...DEFAULTS }
  }
}

export class SettingsPage {
  readonly values: Settings = load()

  private readonly root: HTMLElement
  private readonly readout: HTMLElement
  private readonly slider: HTMLInputElement

  /** `onChange` est appelé à chaque modification, et une fois au démarrage. */
  constructor(private readonly onChange: (values: Settings) => void) {
    this.root = document.createElement('div')
    this.root.id = 'settings'
    this.root.hidden = true
    this.root.innerHTML = `
      <h2>Paramètres</h2>
      <label for="fov">Champ de vision</label>
      <div class="row">
        <input id="fov" type="range" min="${RANGE.min}" max="${RANGE.max}" step="1" />
        <span class="readout"></span>
      </div>
      <p class="note">
        Un champ étroit réduit le défilement périphérique, qui est ce qui donne le plus
        sûrement la nausée. Un champ large montre davantage de la salle.
      </p>
      <p class="close"><kbd>P</kbd> ou <kbd>Échap</kbd> pour refermer</p>
    `
    document.body.append(this.root)

    this.slider = this.root.querySelector<HTMLInputElement>('#fov')!
    this.readout = this.root.querySelector<HTMLElement>('.readout')!
    this.slider.value = String(this.values.fov)
    this.slider.addEventListener('input', () => {
      this.values.fov = clamp(Number(this.slider.value), RANGE.min, RANGE.max)
      this.apply()
    })

    this.refresh()
    this.onChange(this.values)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  toggle(): void {
    this.setOpen(this.root.hidden)
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open
    // Rendre la souris, sans quoi la page est là mais inutilisable.
    if (open && document.pointerLockElement) document.exitPointerLock()
  }

  private apply(): void {
    this.refresh()
    this.save()
    this.onChange(this.values)
  }

  private refresh(): void {
    this.readout.textContent = `${Math.round(this.values.fov)}°`
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values))
    } catch {
      /* voir `load` */
    }
  }
}
