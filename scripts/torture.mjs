/**
 * Le test de torture des coutures, automatisé.
 *
 * Deux volets :
 *
 *  1. **Les invariants**, vérifiés par le calcul dans la page (rigidité des
 *     transformations, coïncidence des bouches, aller-retour neutre, cent
 *     traversées sans dérive). C'est ce qui attrape les erreurs qu'on ne voit pas
 *     encore.
 *
 *  2. **Les points de vue**, capturés un par un dans `shots/`. Ce sont les six
 *     situations qui trahissent un portail mal fait — nez collé à l'ouverture,
 *     regard rasant, pile dans l'embrasure, récursion, etc. Les images sont à
 *     regarder ; la comparaison automatique avec des références viendra quand le
 *     rendu sera stabilisé, sinon on passerait son temps à réviser des références.
 *
 * Usage : npm run torture
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { launch } from './browser.mjs'
import { createHash } from 'node:crypto'
import { decode, stats } from './png.mjs'

const PORT = 5190
const URL = `http://localhost:${PORT}/`
const SHOTS = 'shots'

const VIEWS = [
  { file: '1-nez-colle', label: 'Nez collé à la couture', preset: 0 },
  { file: '2-rasant', label: 'Regard rasant', preset: 1 },
  { file: '3-embrasure', label: 'Pile dans l’embrasure', preset: 2 },
  { file: '4-recursion', label: 'Récursion — le couloir infini', preset: 3 },
  { file: '5-biais', label: 'Vue en biais depuis le coin', preset: 4 },
  { file: '6-grande-salle', label: 'Depuis la grande salle', preset: 5 },
  { file: '7-tangage-bas', label: 'Tangage vers le bas', preset: 7 },
  { file: '8-tangage-haut', label: 'Tangage vers le haut', preset: 8 },
  { file: '9-au-cheveu', label: 'À un cheveu de la couture', preset: 9 },
  { file: '10-au-micron', label: 'Au micron de la couture', preset: 10 },
  { file: '11-embrasure-cote', label: 'Dans l’embrasure, regard de côté', preset: 11 },
  { file: '12-embrasure-dos', label: 'Dans l’embrasure, dos tourné', preset: 12 },
]

/**
 * Une image utile n'est jamais un aplat.
 *
 * C'est un critère grossier, et c'est exactement ce qui manquait : les trois
 * premiers défauts trouvés au clavier — image cisaillée, ouvertures noires, écran
 * entièrement vide au franchissement — laissaient tous les compteurs intacts. Une
 * mesure du rendu lui-même les aurait signalés tout de suite.
 */
const MIN_SPREAD = 6      // écart-type de luminance
const MIN_COLOURS = 12    // teintes distinctes, quantifiées à 16 niveaux par canal

async function waitForServer(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* le serveur démarre encore */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Le serveur de développement n'a pas répondu sur ${url}`)
}

const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
  stdio: 'ignore',
  shell: true,
})

let browser
let failures = 0

try {
  await waitForServer(URL)
  mkdirSync(SHOTS, { recursive: true })

  browser = await launch(URL, { width: 1440, height: 810 })
  await browser.waitFor('() => !!window.__edifice')
  // Sans ça, l'écran d'entrée et les panneaux occupent la moitié de chaque capture.
  await browser.eval('window.__edifice.setChrome(false)')

  // --- Volet 1 : les invariants --------------------------------------------
  const checks = await browser.eval('window.__edifice.selfTest()')
  console.log('\n  Invariants de couture\n  ' + '─'.repeat(58))
  for (const c of checks) {
    const mark = c.ok ? '  ok  ' : '  ÉCHEC'
    if (!c.ok) failures++
    console.log(`${mark}  ${c.name.padEnd(42)} ${c.detail}`)
  }

  // --- Volet 2 : les points de vue -----------------------------------------
  console.log('\n  Points de vue\n  ' + '─'.repeat(58))
  // Deux points de vue différents ne peuvent pas produire la même image. Ce
  // contrôle trivial aurait suffi à révéler que le tangage était écrasé : les deux
  // vues inclinées sortaient identiques au bit près, et leurs statistiques
  // identiques s'affichaient sans que personne ne les rapproche.
  const seen = new Map()
  for (const view of VIEWS) {
    await browser.eval(`window.__edifice.goTo(${view.preset})`)
    const png = await browser.screenshotStable()
    const path = `${SHOTS}/${view.file}.png`
    writeFileSync(path, png)
    const state = await browser.eval('window.__edifice.state()')
    const px = stats(decode(png))

    const flat = px.spread < MIN_SPREAD || px.colours < MIN_COLOURS
    if (flat) failures++

    const digest = createHash('sha1').update(png).digest('hex')
    const twin = seen.get(digest)
    if (twin) {
      console.log(`  ÉCHEC  ${view.label} donne exactement la même image que « ${twin} »`)
      failures++
    }
    seen.set(digest, view.label)
    console.log(
      `  ${flat ? 'ÉCHEC ' : '  ok  '} ${view.label.padEnd(32)}` +
        ` ${String(state.stats.passes).padStart(2)} passes · prof. ${state.stats.deepest}` +
        ` · relief ${px.spread.toFixed(1).padStart(5)} · ${String(px.colours).padStart(3)} teintes`,
    )
    if (flat) console.log(`         l'image est un aplat — voir ${path}`)
  }

  // --- Un cube lancé à travers, et on regarde s'il arrive de l'autre côté ---
  //
  // Depuis deux mètres de l'ouverture : assez loin pour voir le cube voler, assez
  // près pour qu'il franchisse la couture avant que la gravité ne l'emporte. On ne
  // bouge pas ensuite — le cube doit être visible **à travers** l'ouverture, posé
  // sur le sol de l'autre pièce. C'est l'image qui prouve que la géométrie, le
  // déplacement et le rendu partagent bien la même transformation.
  await browser.eval('window.__edifice.goTo(6)')
  await browser.eval('window.__edifice.throwCube()')
  await new Promise((r) => setTimeout(r, 200))
  writeFileSync(`${SHOTS}/13-cube-en-vol.png`, await browser.screenshotStable())
  await new Promise((r) => setTimeout(r, 1600))
  writeFileSync(`${SHOTS}/14-cube-de-lautre-cote.png`, await browser.screenshotStable())
  const after = await browser.eval('window.__edifice.state()')
  console.log(`  ${'Cube lancé à travers'.padEnd(34)} ${SHOTS}/13-cube-en-vol.png, ${SHOTS}/14-cube-de-lautre-cote.png`)
  const afterPx = stats(decode(readFileSync(`${SHOTS}/14-cube-de-lautre-cote.png`)))
  if (after.stats.passes < 2 || afterPx.spread < MIN_SPREAD) {
    console.log('  ÉCHEC  le rendu s’est dégradé après le lancer')
    failures++
  }

  // --- Volet 3 : le balayage du franchissement -----------------------------
  //
  // Des poses fixes ne prouvent pas qu'une transition est propre. Ce qui gênait à
  // l'œil, c'était le passage lui-même : une bande grise apparaissait pendant une ou
  // deux images, trop brève pour être capturée par hasard et assez longue pour être
  // vue.
  //
  // On fait donc **marcher** le visiteur à travers la porte, millimètre par
  // millimètre, par le même code de déplacement que d'habitude, et on mesure chaque
  // position. Téléporter l'œil de part et d'autre ne dirait rien : une position
  // au-delà d'une couture mais rattachée à la cellule de départ est un état que le
  // jeu ne produit jamais.
  //
  // Le résultat n'est pas un oui-non mais une largeur : sur quelle épaisseur, en
  // millimètres, l'image se dégrade-t-elle ? À la vitesse de marche une image
  // couvre près de six centimètres, donc tout ce qui reste sous le centimètre est
  // invisible en pratique — et c'est ce qu'on exige.
  console.log('\n  Balayage du franchissement — on marche, on ne se téléporte pas')
  console.log('  ' + '─'.repeat(58))

  const sweeper = await launch(URL, { width: 360, height: 220, port: 9334 })
  try {
    await sweeper.waitFor('() => !!window.__edifice')
    await sweeper.eval('window.__edifice.setChrome(false)')

    // Trois directions de regard, la marche restant la même. La troisième n'est pas
    // décorative : c'est en piquant du nez que deux coins de l'ouverture passent
    // derrière l'œil, et c'est le seul cas où la silhouette du portail se calculait
    // faux. Regarder droit devant ou sur le côté ne le révélait pas.
    const runs = [
      { name: 'de face', look: (f) => [f.x, f.y, f.z] },
      { name: 'de côté', look: (f) => [-f.z, 0, f.x] },
      { name: 'nez baissé', look: (f) => [f.x, -0.5, f.z] },
    ]

    for (const run of runs) {
      // On démarre quinze millimètres avant la couture — dont on demande la position
      // au moteur plutôt que de l'écrire en dur — et on traverse sur quarante
      // millimètres, en visant l'ouverture.
      const seam = await sweeper.eval('window.__edifice.seam()')
      const startX = seam.cx + seam.nx * 0.015
      const startZ = seam.cz + seam.nz * 0.015
      await sweeper.eval(
        `window.__edifice.teleport('hall', ${startX}, 1.65, ${startZ}, ${-seam.nx}, 0, ${-seam.nz})`,
      )

      let degraded = 0
      let worst = { relief: Infinity, at: 0 }
      const cells = new Set()

      for (let mm = 0; mm <= 40; mm++) {
        const state = await sweeper.eval('window.__edifice.state()')
        cells.add(state.cell)

        // Orienter le regard sans bouger, puis le remettre dans l'axe de la marche :
        // c'est la direction de marche qui doit rester maîtresse du parcours.
        const f = state.forward
        const [lx, ly, lz] = run.look(f)
        await sweeper.eval(`window.__edifice.face(${lx}, ${ly}, ${lz})`)

        const px = stats(decode(await sweeper.screenshotStable(2)))
        if (px.spread < worst.relief) worst = { relief: px.spread, at: mm }
        if (px.spread < MIN_SPREAD) degraded++

        await sweeper.eval(`window.__edifice.face(${f.x}, ${f.y}, ${f.z})`)
        await sweeper.eval('window.__edifice.walk(0.001)')
      }

      const ok = degraded <= 1 && cells.size === 2
      if (!ok) failures++
      console.log(
        `  ${ok ? '  ok  ' : 'ÉCHEC '} ${run.name.padEnd(9)}` +
          ` bande dégradée : ${String(degraded).padStart(2)} mm` +
          ` · relief minimal ${worst.relief.toFixed(1)} au mm ${worst.at}` +
          ` · cellules traversées : ${[...cells].join(', ')}`,
      )
    }
  } finally {
    await sweeper.close()
  }

  // --- Les erreurs de la console comptent comme des échecs ------------------
  const errors = browser.logs.filter((l) => l.level === 'error')
  if (errors.length) {
    console.log('\n  Erreurs de la console\n  ' + '─'.repeat(58))
    for (const e of errors) console.log(`  ${e.text}`)
    failures += errors.length
  }

  console.log(
    failures === 0
      ? '\n  Tout tient. Les captures sont dans shots/ — elles restent à regarder.\n'
      : `\n  ${failures} problème(s). L'étape 1 n'est pas terminée.\n`,
  )
} finally {
  await browser?.close()
  vite.kill()
}

process.exit(failures === 0 ? 0 : 1)
