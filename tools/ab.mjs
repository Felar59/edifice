/**
 * Réintroduit un défaut connu, lance une commande, remet tout en place.
 *
 * La discipline est simple et non négociable : **un contrôle de non-régression
 * qu'on n'a jamais vu échouer n'en est pas un.** Cette séance l'a prouvé deux fois —
 * une mesure d'image qui semblait couvrir trois défauts n'en attrapait que deux, et
 * un balayage qui annonçait « tout va bien » mesurait en réalité un état que le
 * moteur ne produit jamais.
 *
 * Le faire à la main coûtait une sauvegarde, un remplacement, une restauration, et
 * le risque bien réel de laisser une sonde en place. Ici la restauration passe par
 * un `finally`, donc elle a lieu même si la commande échoue ou si on interrompt.
 *
 * Exemples
 *   node tools/ab.mjs                                    liste les défauts connus
 *   node tools/ab.mjs sans-decoupage                     lance le test de torture
 *   node tools/ab.mjs camera-oblique -- npm run check    lance autre chose
 *   node tools/ab.mjs tout                               les essaie tous, un par un
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { PATCHES } from './patches.mjs'

const argv = process.argv.slice(2)
const separator = argv.indexOf('--')
const names = (separator < 0 ? argv : argv.slice(0, separator)).filter(Boolean)
const command = separator < 0 ? ['npm', 'run', 'torture'] : argv.slice(separator + 1)

if (names.length === 0) {
  console.log('défauts connus :\n')
  for (const [name, patch] of Object.entries(PATCHES)) {
    console.log(`  ${name.padEnd(30)} ${patch.file}`)
  }
  console.log('\nusage : node tools/ab.mjs <nom | tout> [-- commande...]')
  process.exit(0)
}

const selected = names[0] === 'tout' ? Object.keys(PATCHES) : names
for (const name of selected) {
  if (!PATCHES[name]) {
    console.error(`défaut inconnu : ${name}`)
    process.exit(1)
  }
}

let failures = 0

for (const name of selected) {
  const patch = PATCHES[name]
  const original = readFileSync(patch.file, 'utf8')

  if (!original.includes(patch.from)) {
    console.error(
      `\n${name} : le point d'accroche a disparu de ${patch.file}.\n` +
        `  cherché : ${patch.from}\n` +
        `  Le code a bougé — il faut mettre à jour tools/patches.mjs.`,
    )
    failures++
    continue
  }

  console.log(`\n${'═'.repeat(70)}\n  défaut réintroduit : ${name}\n  ${patch.file}\n${'═'.repeat(70)}`)

  try {
    writeFileSync(patch.file, original.replace(patch.from, patch.to), 'utf8')
    const result = spawnSync(command[0], command.slice(1), {
      stdio: 'inherit',
      shell: true,
    })
    // On attend que la commande **échoue** : c'est la preuve que le test voit le défaut.
    if (result.status === 0) {
      console.log(`\n  ⚠ ${name} : la commande a réussi alors que le défaut était en place.`)
      console.log('    Le contrôle correspondant ne protège donc rien.')
      failures++
    } else {
      console.log(`\n  ✓ ${name} : bien attrapé.`)
    }
  } finally {
    // Restauration inconditionnelle : laisser une sonde dans l'arbre serait pire
    // que tout ce que cet outil peut apporter.
    writeFileSync(patch.file, original, 'utf8')
  }
}

console.log(
  failures === 0
    ? `\n${selected.length} défaut(s) essayé(s), tous attrapés. Arbre restauré.`
    : `\n${failures} défaut(s) sur ${selected.length} passent sous le radar. Arbre restauré.`,
)
process.exitCode = failures === 0 ? 0 : 1
