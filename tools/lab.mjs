/**
 * L'atelier : un seul point d'entrée pour toutes les sondes de mise au point.
 *
 *     node tools/lab.mjs <commande> [options]
 *
 * Voir `tools/README.md` pour le mode d'emploi complet et les recettes.
 *
 * ## Pourquoi ce fichier existe
 *
 * Les défauts de ce moteur se répartissent en deux familles, et elles ne se diagnostiquent
 * pas du tout de la même façon.
 *
 * Ceux **du calcul** — une couture mal appariée, une rampe qui saute, un corps qui dérive —
 * se voient sans navigateur : le monde, le déplacement et la collision sont du TypeScript
 * pur. On les attrape en faisant marcher un visiteur dans Node et en regardant les nombres,
 * ce qui prend deux secondes au lieu de trente.
 *
 * Ceux **de l'image** — une surface qui grésille, un portail vide, une teinte fausse —
 * demandent le vrai rendu, donc un navigateur, donc trente secondes.
 *
 * D'où la règle de l'atelier : **toujours essayer Node d'abord**. Les commandes `check`,
 * `walk`, `cells` et `coplanar` ne lancent rien ; `shot` seule ouvre un navigateur.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'tools', '.build')

// ---------------------------------------------------------------------------
// La compilation, mise en cache.
//
// `tsc` sur `selftest.ts` suffit à entraîner tout le moteur : monde, déplacement,
// collision, escalier, vrille, visiteur. Le rendu et les nuanceurs restent dehors, et
// c'est très bien — ils ne s'exécutent pas hors du navigateur de toute façon.
// ---------------------------------------------------------------------------

function newest(dir) {
  let latest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    latest = Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs)
  }
  return latest
}

function build({ quiet = false } = {}) {
  const marker = existsSync(BUILD) && existsSync(join(BUILD, 'package.json'))
  const fresh = marker && newest(join(ROOT, 'src')) < newest(join(BUILD, 'world'))
  if (fresh) return BUILD

  if (!quiet) process.stderr.write('… compilation\n')
  execFileSync(
    'npx',
    [
      'tsc',
      'src/dev/selftest.ts',
      'src/player/projectiles.ts',
      '--outDir', join('tools', '.build'),
      '--module', 'commonjs',
      '--target', 'es2022',
      '--moduleResolution', 'node',
      '--skipLibCheck',
      '--strict', 'false',
    ],
    { cwd: ROOT, stdio: quiet ? 'pipe' : 'inherit', shell: true },
  )
  // Le dépôt est en modules ES ; la compilation, elle, sort du CommonJS pour pouvoir être
  // chargée d'ici sans cérémonie. Ce fichier-ci le dit à Node, faute de quoi il lit les
  // `.js` produits comme des modules ES et se plaint de `exports`.
  writeFileSync(join(BUILD, 'package.json'), '{ "type": "commonjs" }\n')
  return BUILD
}

const load = (path) => require(join(build(), path))

// `require` depuis un module ES.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Les options, façon `--clef valeur`.
// ---------------------------------------------------------------------------

function options(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
    out[key] = value
  }
  return out
}

const vec = (s, fallback) => {
  if (!s) return fallback
  const [x, y, z] = s.split(',').map(Number)
  return { x, y, z }
}
const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`

// ---------------------------------------------------------------------------
// Les commandes.
// ---------------------------------------------------------------------------

const commands = {}

/** Les invariants, sans navigateur. Le premier réflexe après toute modification. */
commands.check = (opts) => {
  const { buildWorld } = load('world/world.js')
  const { runSelfTest } = load('dev/selftest.js')
  const checks = runSelfTest(buildWorld())
  const shown = opts.all ? checks : checks.filter((c) => !c.ok)
  const filter = opts.only ? new RegExp(opts.only, 'i') : null

  for (const c of shown) {
    if (filter && !filter.test(c.name)) continue
    console.log(`${c.ok ? 'ok    ' : 'ÉCHEC '} ${c.name} — ${c.detail}`)
  }
  const bad = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length} contrôles, ${bad} échec(s)`)
  process.exitCode = bad ? 1 : 0
}

/** Le plan du monde : cellules, boîtes, bouches, particularités. */
commands.cells = (opts) => {
  const { buildWorld } = load('world/world.js')
  for (const cell of buildWorld().cells.values()) {
    if (opts.only && !new RegExp(opts.only, 'i').test(cell.id)) continue
    const traits = [
      cell.twist && 'vrille',
      cell.spiral && 'escalier',
      cell.gravity && 'six sols',
      cell.blocks && `${cell.blocks.length} bloc(s)`,
    ].filter(Boolean)
    console.log(
      `${cell.id.padEnd(14)} ${fmt(cell.min)} → ${fmt(cell.max)}` +
        ` · ${cell.passages.length} bouche(s)${traits.length ? ' · ' + traits.join(', ') : ''}`,
    )
    if (opts.mouths) {
      for (const p of cell.passages) {
        console.log(
          `   ${p.from.id.padEnd(22)} ${fmt(p.from.center)} n=${fmt(p.from.normal)}` +
            ` ${(p.from.halfWidth * 2).toFixed(2)}×${(p.from.halfHeight * 2).toFixed(2)}` +
            ` → ${p.to.id}${p.oneWay ? ' (sans retour)' : ''}`,
        )
      }
    }
  }
}

/**
 * Deux surfaces dans le même plan qui partagent des pixels : la cause des grésillements.
 *
 * L'auto-test le vérifie déjà, mais en tout ou rien ; ici on obtient les coordonnées.
 */
commands.coplanar = () => {
  const { buildWorld } = load('world/world.js')
  const { FLOATS_PER_VERTEX: F } = load('world/geometry.js')

  for (const cell of buildWorld().cells.values()) {
    const quads = []
    const v = cell.verts
    for (let q = 0; q + 6 * F <= v.length; q += 6 * F) {
      const n = [v[q + 3], v[q + 4], v[q + 5]]
      let axis = 0
      for (let k = 1; k < 3; k++) if (Math.abs(n[k]) > Math.abs(n[axis])) axis = k
      if (Math.abs(n[axis]) < 0.999) continue
      const flat = [0, 1, 2].filter((k) => k !== axis)
      const poly = [0, 1, 2, 5].map((i) => flat.map((k) => v[q + i * F + k]))
      quads.push({ axis, sign: Math.sign(n[axis]), plane: v[q + axis], poly, at: q / F })
    }

    for (let i = 0; i < quads.length; i++) {
      for (let j = i + 1; j < quads.length; j++) {
        const a = quads[i]
        const b = quads[j]
        if (a.axis !== b.axis || a.sign !== b.sign) continue
        if (Math.abs(a.plane - b.plane) > 1e-4) continue
        if (!overlaps(a.poly, b.poly)) continue
        console.log(
          `${cell.id} · plan ${'xyz'[a.axis]}=${a.plane.toFixed(3)} (normale ${a.sign > 0 ? '+' : '−'})` +
            ` · sommets ${a.at} et ${b.at}`,
        )
      }
    }
  }
}

function overlaps(p, q) {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const nx = -(b[1] - a[1])
      const ny = b[0] - a[0]
      const span = (r) => {
        let lo = Infinity
        let hi = -Infinity
        for (const s of r) {
          const d = s[0] * nx + s[1] * ny
          lo = Math.min(lo, d)
          hi = Math.max(hi, d)
        }
        return [lo, hi]
      }
      const [alo, ahi] = span(p)
      const [blo, bhi] = span(q)
      const margin = 1e-3 * Math.hypot(nx, ny)
      if (ahi < blo + margin || bhi < alo + margin) return false
    }
  }
  return true
}

/**
 * Faire marcher un visiteur et regarder ce qui se passe, image par image.
 *
 * C'est la commande qui sert le plus. Le pilotage du regard est le point délicat : marcher
 * droit devant soi ne mène nulle part dans un escalier tournant, d'où `--follow`.
 */
commands.walk = (opts) => {
  const { buildWorld } = load('world/world.js')
  const { Player } = load('player/player.js')
  const spiralMath = load('world/spiral.js')
  const world = buildWorld()

  const cell = world.cells.get(opts.cell ?? 'rotonde')
  if (!cell) throw new Error(`cellule inconnue : ${opts.cell}`)

  const player = new Player()
  const at = opts.at
    ? vec(opts.at)
    : (() => {
        // À défaut de position, deux mètres devant la première bouche de la cellule, et
        // **au niveau de son seuil** — pas au ras du sol de la boîte. Une porte d'escalier
        // s'ouvre à mi-hauteur : partir du plancher de la cellule faisait tomber la sonde
        // dans une volée qui n'était pas la sienne, et l'on croyait à un défaut du monde.
        const m = cell.passages[0].from
        return {
          x: m.center.x + m.normal.x * 2,
          y: m.center.y - m.halfHeight + 1.65,
          z: m.center.z + m.normal.z * 2,
        }
      })()
  player.goTo({ name: 'sonde', cell: cell.id, pos: at, forward: vec(opts.face, { x: 0, y: 0, z: 1 }) }, world)

  const keys = new Set((opts.keys ?? 'KeyW').split(',').filter((k) => k !== 'none'))
  const steps = Number(opts.steps ?? 300)
  const every = Number(opts.every ?? 30)
  const follow = opts.follow ? Number(opts.follow) : null

  let crossings = 0
  const line = (i) => {
    const here = world.cells.get(player.cell)
    const flight = here?.spiral ? spiralMath.flightUnder(here.spiral, player.pos).toFixed(3) : '—'
    console.log(
      `${String(i).padStart(4)} ${player.cell.padEnd(12)} ${fmt(player.pos)}` +
        ` · haut ${fmt(player.up)} · sol ${player.grounded ? 'oui' : 'non'}` +
        ` · tour ${flight} · ${player.crossings} traversée(s)`,
    )
  }

  line(0)
  for (let i = 1; i <= steps; i++) {
    if (follow !== null) {
      // Suivre la volée : le regard le long de la tangente au pilier.
      const here = world.cells.get(player.cell)
      const s = here?.spiral
      if (s) {
        const rx = player.pos.x - s.centre.x
        const rz = player.pos.z - s.centre.z
        player.face({ x: -rz * follow, y: 0, z: rx * follow })
      }
    }
    if (opts.toward) {
      const t = vec(opts.toward)
      player.face({ x: t.x - player.pos.x, y: 0, z: t.z - player.pos.z })
    }
    player.update(1 / 60, world, keys)
    if (player.crossings !== crossings) {
      crossings = player.crossings
      console.log(`     ↳ traversée au pas ${i}`)
      line(i)
    } else if (i % every === 0) {
      line(i)
    }
  }
}

/**
 * Une capture depuis une pose donnée. La seule commande qui ouvre un navigateur.
 *
 * Utile pour ce que le calcul ne dit pas : une surface manquante, une teinte fausse, un
 * portail vide. Pour tout le reste, `walk` est trente fois plus rapide.
 */
commands.shot = async (opts) => {
  const { spawn } = await import('node:child_process')
  // Sous Windows, un chemin absolu n'est pas une URL valide pour `import` : il faut le
  // convertir, sinon Node refuse le schéma.
  const { pathToFileURL } = await import('node:url')
  const { launch } = await import(pathToFileURL(join(ROOT, 'scripts', 'browser.mjs')).href)

  const url = 'http://localhost:5190/'
  const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: true,
  })
  let browser
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(url)).ok) break
      } catch {
        /* le serveur démarre */
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    browser = await launch(url, { width: Number(opts.width ?? 1100), height: Number(opts.height ?? 620) })
    await browser.waitFor('() => !!window.__edifice')
    await browser.eval('window.__edifice.setChrome(false)')
    await browser.eval('window.__edifice.setPaused(true)')

    const out = opts.out ?? 'shots/probe-lab.png'
    const keys = JSON.stringify((opts.keys ?? '').split(',').filter(Boolean))

    /**
     * Plusieurs poses en une seule ouverture de navigateur : c'est là qu'est le gain.
     * Chacune coûte une demi-seconde, alors que démarrer Vite et Chrome en coûte trente.
     */
    const poses = opts.poses
      ? opts.poses.split(';').map((spec, i) => {
          const [cell, at, face] = spec.split(':')
          return { i, cell, at: vec(at), face: vec(face, { x: 0, y: 0, z: 1 }) }
        })
      : [{ i: 0, cell: opts.cell, at: vec(opts.at), face: vec(opts.face, { x: 0, y: 0, z: 1 }) }]

    for (const pose of poses) {
      if (opts.preset && !opts.poses) {
        await browser.eval(`window.__edifice.goTo(${Number(opts.preset)})`)
      } else {
        await browser.eval(
          `window.__edifice.teleport('${pose.cell}', ${pose.at.x}, ${pose.at.y}, ${pose.at.z},` +
            ` ${pose.face.x}, ${pose.face.y}, ${pose.face.z})`,
        )
      }
      // De quoi laisser un basculement ou une réorientation s'achever.
      for (let i = 0; i < Number(opts.settle ?? 0); i++) {
        await browser.eval(`window.__edifice.tick(1/60, ${keys})`)
      }
      const path = poses.length > 1 ? out.replace(/\.png$/, `-${pose.i}.png`) : out
      writeFileSync(join(ROOT, path), await browser.screenshotStable())
      const state = await browser.eval('window.__edifice.state()')
      console.log(`${path} · cellule ${state.cell} · ${fmt(state.pos)} · ${state.stats.passes} passes`)
    }
  } finally {
    await browser?.close()
    vite.kill()
    process.exit(0)
  }
}

/** Recompile, sans rien exécuter. */
commands.build = () => {
  build()
  console.log(BUILD)
}

// ---------------------------------------------------------------------------

const [, , name, ...rest] = process.argv
if (!name || !commands[name]) {
  console.log(
    'Commandes : ' + Object.keys(commands).join(', ') + '\n' +
      'Voir tools/README.md pour le mode d’emploi.',
  )
  process.exit(name ? 1 : 0)
}
mkdirSync(join(ROOT, 'shots'), { recursive: true })
await commands[name](options(rest))
