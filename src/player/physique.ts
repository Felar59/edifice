/**
 * Le pont vers le noyau de physique en Rust.
 *
 * Deux choses seulement : **traduire le monde** en un tableau de flottants que le module
 * sait lire, et **prêter le tableau des corps** à qui veut le lire ou l'écrire. Tout le
 * calcul est de l'autre côté.
 *
 * ## Pourquoi une interface purement numérique
 *
 * Pas de `wasm-bindgen`, pas d'objets, pas de chaînes : le monde et les corps sont des
 * `Float32Array` posés dans la mémoire du module. Ce n'est pas une coquetterie — la physique
 * est appelée à chaque image, et tout ce qui coûte à la frontière se paie soixante fois par
 * seconde. Le module se charge alors d'un `WebAssembly.instantiate` sans outil intermédiaire,
 * ce qui veut dire sans étape de compilation en plus de `cargo`.
 *
 * ## Le monde est envoyé une fois
 *
 * Les cellules ne bougent pas. On les sérialise au démarrage, le module en fait ses
 * structures, et l'on n'y revient que si le monde change — ce qui n'arrive qu'en réglant
 * l'intensité de la vrille. Le format est décrit ci-dessous et **doit rester en accord avec
 * le lecteur de `physique/src/lib.rs`** : c'est le seul endroit du projet où deux fichiers
 * doivent se croire sur parole.
 */

import type { Cell, Mouth, World } from '../world/types'

/** Nombre de flottants par corps. Découpage documenté dans le noyau. */
export const STRIDE = 16

/** Ce que le module exporte. Rien que des nombres. */
interface Exports {
  memory: WebAssembly.Memory
  world_buffer: (len: number) => number
  world_commit: () => void
  bodies: () => number
  capacity: () => number
  step: (dt: number, count: number) => void
}

export class Physics {
  private readonly api: Exports
  /** Indice de chaque cellule dans le tableau envoyé au noyau. */
  private order = new Map<string, number>()
  private names: string[] = []

  private constructor(api: Exports) {
    this.api = api
  }

  static async load(bytes: BufferSource): Promise<Physics> {
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return new Physics(instance.exports as unknown as Exports)
  }

  get capacity(): number {
    return this.api.capacity()
  }

  /** Le nom de la cellule d'indice donné, pour rendre au reste du moteur ses identifiants. */
  cellName(index: number): string {
    return this.names[index] ?? this.names[0]!
  }

  cellIndex(id: string): number {
    return this.order.get(id) ?? 0
  }

  /**
   * Le tableau des corps, vu depuis la page.
   *
   * Il est reconstruit à chaque appel : la mémoire d'un module WebAssembly **déménage**
   * quand elle grandit, et une vue conservée d'une image sur l'autre lirait alors dans le
   * vide. C'est le genre de bogue qui n'apparaît qu'au bout d'un moment de jeu.
   */
  bodies(): Float32Array {
    return new Float32Array(
      this.api.memory.buffer,
      this.api.bodies(),
      this.capacity * STRIDE,
    )
  }

  step(dt: number, count: number): void {
    this.api.step(dt, count)
  }

  /** Envoie le monde au noyau. À rappeler si les cellules changent. */
  setWorld(world: World): void {
    const cells = [...world.cells.values()]
    this.names = cells.map((c) => c.id)
    this.order = new Map(cells.map((c, i) => [c.id, i]))

    const out: number[] = [cells.length]
    for (const cell of cells) {
      push(out, cell.min)
      push(out, cell.max)
      pushFloor(out, cell)

      const blocks = cell.blocks ?? []
      out.push(blocks.length)
      for (const block of blocks) {
        push(out, block.min)
        push(out, block.max)
        out.push(block.door ? 1 : 0)
        if (block.door) pushMouth(out, block.door)
      }

      out.push(cell.passages.length)
      for (const passage of cell.passages) {
        pushMouth(out, passage.from)
        out.push(this.order.get(passage.to.cell) ?? 0)
        for (let i = 0; i < 16; i++) out.push(passage.transform[i]!)
      }
    }

    const ptr = this.api.world_buffer(out.length)
    new Float32Array(this.api.memory.buffer, ptr, out.length).set(out)
    this.api.world_commit()
  }
}

function push(out: number[], v: { x: number; y: number; z: number }): void {
  out.push(v.x, v.y, v.z)
}

function pushMouth(out: number[], m: Mouth): void {
  push(out, m.center)
  push(out, m.right)
  push(out, m.up)
  push(out, m.normal)
  out.push(m.halfWidth, m.halfHeight)
}

/**
 * La forme du sol, qui décide de la chute.
 *
 * Les quatre formes du musée sont ici, et c'est délibéré : en laisser une de côté aurait
 * obligé à faire cohabiter deux moteurs de physique et à décider, pour chaque cube et à
 * chaque image, lequel des deux a raison.
 */
function pushFloor(out: number[], cell: Cell): void {
  if (cell.spiral) {
    const s = cell.spiral
    out.push(2)
    push(out, s.centre)
    out.push(s.rise, s.steps, s.cut, s.headroom, s.from, s.turns, s.landings.length)
    for (const l of s.landings) out.push(l.at, l.count)
    return
  }
  if (cell.twist) {
    const t = cell.twist
    out.push(3)
    push(out, t.origin)
    push(out, t.axis)
    push(out, t.right0)
    push(out, t.up0)
    out.push(t.length, t.halfSize, t.turn, t.straight)
    return
  }
  out.push(cell.gravity ? 1 : 0)
}
