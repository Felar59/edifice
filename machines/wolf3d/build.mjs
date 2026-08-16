/**
 * Compile Wolf3D vers WebAssembly.
 *
 * Le compilateur est celui que distribue `ziglang` sur PyPI : un clang complet, qui sait
 * viser wasm32 et qui apporte sa bibliothèque C. Une seule commande l'installe
 * (`python -m pip install ziglang`), il ne touche rien d'autre sur la machine, et il se
 * désinstalle aussi vite. C'était la condition pour faire tourner du vrai C sans demander
 * une chaîne d'outils entière.
 *
 * ## Ce que ce script ne fait pas
 *
 * Il ne modifie aucun fichier de `source/`. Ceux-là sont la copie mot pour mot du dépôt
 * Wolf3D, et le jour où ils cesseront de compiler, c'est la coquille de `shim/` qu'il faudra
 * corriger — jamais eux. C'est la règle de tout le dossier `machines/`.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'src', 'machines', 'wolf3d.wasm')

/** Les fichiers du jeu, tels quels, et le pont qui les appelle. */
const SOURCES = [
  'source/procedural_gen_algorithm.c',
  'source/is_wall.c',
  'source/init_map.c',
  'source/cast_single_ray.c',
  'shim/stubs.c',
  'bridge.c',
]

/** Ce que la page appelle. Tout le reste est interne au module. */
const EXPORTS = [
  'wolf_generate',
  'wolf_width',
  'wolf_height',
  'wolf_start_x',
  'wolf_start_y',
  'wolf_tile',
  'wolf_frame',
  'wolf_view',
]

mkdirSync(dirname(OUT), { recursive: true })

execFileSync(
  'python',
  [
    '-m', 'ziglang', 'cc',
    '-target', 'wasm32-wasi',
    '-O2',
    '-Wl,--no-entry',
    // `remove_empty_spaces` élague les poches inaccessibles par une descente récursive qui
    // peut visiter plusieurs milliers de cases. La pile par défaut d'un module wasm y
    // suffirait de justesse ; on la met à quatre mégaoctets et la question ne se pose plus.
    '-Wl,-z,stack-size=4194304',
    ...EXPORTS.map((name) => `-Wl,--export=${name}`),
    '-I', join(HERE, 'shim'),
    '-I', join(HERE, 'source'),
    '-o', OUT,
    ...SOURCES.map((s) => join(HERE, s)),
  ],
  { stdio: 'inherit' },
)

console.log(`wolf3d.wasm écrit dans ${OUT}`)
