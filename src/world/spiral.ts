/**
 * L'escalier de Penrose : un ruban de marches qui tourne autour d'un pilier plein, et
 * qu'on peut monter indéfiniment.
 *
 * ## Le principe, en une phrase
 *
 * La hauteur ne dépend que de **l'angle autour du pilier**. Un tour complet fait donc
 * gagner exactement `rise`, et une couture posée au raccord translate de cette hauteur :
 * on la franchit sans rien sentir, et l'on se retrouve un tour plus bas en continuant de
 * monter.
 *
 * Ce n'est pas l'escalier du dessin de Penrose, qui est un carré vu en perspective
 * impossible. C'est sa version habitable : **des marches sans fin**, et au milieu un
 * pilier qui empêche de voir d'un bout à l'autre.
 *
 * ## Le plafond suit les marches
 *
 * C'est ce qui a coûté le plus à comprendre, et cela ne se voit qu'en jouant. Avec un
 * plafond plat, on le sent se rapprocher à mesure qu'on monte — puis, au raccord, s'écarter
 * d'un tour d'un seul coup. Le raccord ne se voit pas dans la géométrie, mais il **s'entend
 * dans le volume**, et c'est aussi net qu'un décrochement.
 *
 * Le plafond est donc lui aussi un ruban, à `headroom` au-dessus des marches et à leur
 * image : le couloir a partout la même section, et la couture le recolle exactement comme
 * elle recolle le sol. Une fois cela fait, la bouche du raccord couvre **toute** la section
 * du couloir — plus rien d'autre n'est visible en montant, et il n'y a plus rien à cacher.
 *
 * ## Les paliers de coin
 *
 * Quatre paliers, un par angle du pilier. Ils servent d'abord au bon sens architectural —
 * on tourne sur du plat, pas en pleine volée — mais surtout : le sol d'un escalier tournant
 * n'est de niveau que le long d'un rayon, or une porte est percée dans une paroi, donc en
 * travers. Sans palier, le sol monterait de près d'un mètre sur la largeur de l'ouverture
 * et l'on entrerait par le biais. Toutes les portes de l'escalier sont donc à un coin.
 *
 * ## La section basse
 *
 * La géométrie déborde d'un tiers de tour **sous** la boucle. Ce tronçon-là n'est parcouru
 * qu'une fois, en descendant, et c'est là qu'est la porte de la salle basse : celui qui
 * monte ne la voit jamais, puisque la boucle le repose toujours au-dessus.
 *
 * D'où la seule complication du calcul : deux volées peuvent occuper le même secteur
 * angulaire à des hauteurs différentes, et il faut savoir sur laquelle on se tient. Elles
 * sont séparées de `rise`, soit seize mètres pour un corps qui en fait deux — le choix
 * n'est jamais douteux.
 *
 * ## La rampe
 *
 * La collision ne suit pas les marches mais une **rampe** qui passe en leur milieu. Un
 * sol en escalier ferait monter le corps par bonds d'une marche à chaque nez franchi ;
 * la rampe le fait monter continûment, au prix d'un flottement d'une demi-marche que
 * personne ne peut voir, faute de voir ses pieds.
 */

import type { Vec3 } from '../math/vec3'
import type { Spiral } from './types'

/**
 * La fraction de tour depuis le raccord, dans [0, 1).
 *
 * Elle ne dit pas sur quelle volée on se trouve — seulement dans quel secteur angulaire.
 * Voir `flightUnder`.
 */
export function turnAt(spiral: Spiral, p: Vec3): number {
  const angle = Math.atan2(p.z - spiral.centre.z, p.x - spiral.centre.x)
  const turn = (angle - spiral.cut) / (2 * Math.PI)
  return turn - Math.floor(turn)
}

/**
 * La hauteur atteinte après `k` marches depuis le pied du tour, paliers compris.
 *
 * `k` déborde volontiers de [0, steps] : le profil se répète d'un tour à l'autre, décalé
 * de `rise`, ce qui est exactement la symétrie que la couture exploite.
 */
export function stepHeight(spiral: Spiral, k: number): number {
  const laps = Math.floor(k / spiral.steps)
  const rest = k - laps * spiral.steps

  const flat = spiral.landings.reduce((n, l) => n + l.count, 0)
  const climbing = spiral.steps - flat
  const gain = climbing > 0 ? spiral.rise / climbing : 0

  let risen = 0
  for (let i = 0; i < rest; i++) if (!onTheLanding(spiral, i)) risen += gain
  return spiral.centre.y + risen + laps * spiral.rise
}

/**
 * Cette marche fait-elle partie d'un palier ?
 *
 * Le compte se fait **modulo le tour**, et un palier a le droit d'enjamber le raccord :
 * c'est même le cas du plus important d'entre eux, celui qui le porte.
 */
export function onTheLanding(spiral: Spiral, step: number): boolean {
  const wrapped = ((step % spiral.steps) + spiral.steps) % spiral.steps
  return spiral.landings.some(
    (l) => (wrapped - l.at + spiral.steps) % spiral.steps < l.count,
  )
}

/**
 * La hauteur de la rampe à une abscisse de tour quelconque, entière comprise.
 *
 * Centrée sur la marche qu'on foule — une demi-marche en dessous à son début, une
 * demi-marche au-dessus à sa fin — de sorte qu'un palier reste rigoureusement plat.
 */
export function heightAtTurn(spiral: Spiral, turn: number): number {
  const x = turn * spiral.steps
  const i = Math.floor(x)
  const here = stepHeight(spiral, i + 1)
  const next = stepHeight(spiral, i + 2)
  return here + (next - here) * (x - i - 0.5)
}

/**
 * Le numéro de volée sur laquelle un point repose : le plus grand tour dont la rampe
 * passe sous lui.
 *
 * Les volées étant séparées de `rise`, soit huit fois la taille d'un corps, la réponse
 * n'est jamais ambiguë. On la borne à ce qui est effectivement construit, faute de quoi un
 * corps tombé trop bas chercherait un sol qui n'existe pas.
 */
export function flightUnder(spiral: Spiral, p: Vec3): number {
  const sector = turnAt(spiral, p)
  const raw = Math.floor((p.y - 0.5 - heightAtTurn(spiral, sector)) / spiral.rise)
  // Une marge d'un cinquantième de tour sous le premier quartier : c'est la profondeur
  // d'une embrasure. La porte du bas s'ouvre au ras de la dernière marche, et sans cette
  // marge le corps qui s'y engage ne trouve plus de sol — il est alors remonté d'un tour
  // entier, au sommet, ce qui est exactement le contraire de ce qu'on lui promettait.
  const lowest = Math.ceil(spiral.from - sector - 0.02)
  const highest = Math.floor(spiral.from + spiral.turns - sector)
  return sector + Math.min(Math.max(raw, lowest), highest)
}

/** La hauteur de la rampe sous un point. */
export function rampHeight(spiral: Spiral, p: Vec3): number {
  return heightAtTurn(spiral, flightUnder(spiral, p))
}

/** Et celle du plafond, qui suit les marches à distance constante. */
export function ceilingHeight(spiral: Spiral, p: Vec3): number {
  return rampHeight(spiral, p) + spiral.headroom
}

/** Le point où le rayon d'angle `angle` rencontre un carré de demi-côté `half`. */
export function onSquare(centre: Vec3, half: number, angle: number, y: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const r = half / Math.max(Math.abs(c), Math.abs(s))
  return { x: centre.x + r * c, y, z: centre.z + r * s }
}

/** L'angle de la limite basse de la marche numéro `step`. */
export function stepAngle(spiral: Spiral, step: number): number {
  return spiral.cut + (2 * Math.PI * step) / spiral.steps
}
