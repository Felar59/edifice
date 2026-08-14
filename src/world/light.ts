/**
 * L'éclairage, et la question qu'il fallait bien finir par traiter : **d'où vient
 * la lumière dans une pièce qui n'a pas d'extérieur ?**
 *
 * Réponse retenue : de lampes posées dans la pièce, et de ce qui filtre par les
 * ouvertures. C'est la réponse thématiquement juste — un musée brutaliste enterré
 * n'a pas de fenêtres, il a des spots — et c'est aussi la moins chère.
 *
 * Trois choix pour rester léger, puisque tout ceci tourne dans un navigateur.
 *
 * **Pas de lightmaps.** Le plan les prévoyait, l'ancien musée en raycasting en
 * utilisait. Mais elles supposent un monde figé : il faudrait tout recuire au
 * moindre mur qui bouge, et des murs qui bougent sont précisément au programme.
 * L'éclairage est donc calculé à chaque image, en direct.
 *
 * **Pas d'ombres.** Une lampe éclaire à travers une cloison. On l'assume : c'est le
 * lot suivant, et une salle sans ombres portées reste lisible tant que les lampes
 * sont placées avec un peu de soin.
 *
 * **Un seul rebond.** Une ouverture porte la lumière de la pièce d'en face, mais
 * cette lumière-là ne compte que l'éclairage **direct** de cette pièce : ses lampes
 * et son ambiance, pas ce que ses propres ouvertures lui apportent. Sans cette
 * coupure, deux salles reliées se renverraient la lumière indéfiniment et il
 * faudrait itérer. Un rebond suffit largement à ce qu'on veut obtenir : voir la
 * couleur de la pièce voisine se déposer au sol devant la porte.
 *
 * Ce qui garantit la cohérence à travers une couture, c'est que l'éclairage est
 * attaché aux **cellules** et calculé dans le repère du monde. Une paroi vue
 * directement et la même paroi vue à travers une couture reçoivent exactement le
 * même calcul, parce que rien dans ce calcul ne dépend de l'endroit d'où l'on
 * regarde. Faire dépendre la lumière d'une ouverture de la position de l'œil aurait
 * suffi à tout casser.
 */

import { dot, len, scale, sub, type Vec3 } from '../math/vec3'
import type { Mouth } from './types'

export type Colour = readonly [number, number, number]

/** Le nombre de lampes et d'ouvertures que le nuanceur sait traiter par cellule. */
export const MAX_LIGHTS = 6
/**
 * Huit, parce que la rotonde en compte sept. Chaque ouverture est évaluée par
 * fragment, donc ce plafond est un vrai budget : le monter davantage se paierait sur
 * chaque pixel de chaque passe.
 */
export const MAX_MOUTH_LIGHTS = 8

export interface Light {
  position: Vec3
  colour: Colour
  /** Facteur multiplicatif : la portée est réglée par `radius`, pas par ici. */
  intensity: number
  /** Distance au-delà de laquelle la lampe ne compte plus du tout. */
  radius: number
}

export interface CellLighting {
  /** Plancher de luminosité, pour qu'aucun recoin ne soit parfaitement noir. */
  ambient: Colour
  lights: Light[]
}

/**
 * Atténuation d'une lampe ponctuelle : décroissance en carré inverse, fermée par
 * une fenêtre pour que la contribution tombe exactement à zéro au rayon.
 *
 * Sans cette fenêtre, il faudrait évaluer toutes les lampes du monde pour chaque
 * fragment. Avec elle, on peut se contenter des lampes de la cellule.
 */
export function attenuation(distanceSquared: number, radius: number): number {
  const window = Math.max(0, 1 - distanceSquared / (radius * radius))
  return (window * window) / (1 + distanceSquared)
}

/**
 * La lumière qui sort d'une ouverture, vue depuis la cellule qu'elle éclaire.
 *
 * On somme l'ambiance de la pièce d'en face et ce que ses lampes déposent sur le
 * plan de l'ouverture, en ne retenant que ce qui arrive **du bon côté** : une lampe
 * située derrière le plan n'éclaire pas l'ouverture.
 *
 * `destination` est la bouche jumelle, celle qui s'ouvre dans la pièce d'en face ;
 * sa normale pointe vers l'intérieur de cette pièce.
 */
export function mouthRadiance(destination: Mouth, lighting: CellLighting): Colour {
  let r = lighting.ambient[0]
  let g = lighting.ambient[1]
  let b = lighting.ambient[2]

  for (const light of lighting.lights) {
    const toLight = sub(light.position, destination.center)
    const distance = len(toLight)
    if (distance < 1e-6) continue

    const facing = dot(scale(toLight, 1 / distance), destination.normal)
    if (facing <= 0) continue

    const weight = facing * attenuation(distance * distance, light.radius) * light.intensity
    r += light.colour[0] * weight
    g += light.colour[1] * weight
    b += light.colour[2] * weight
  }

  return [r, g, b]
}
