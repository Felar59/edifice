/**
 * Le repère de la caméra.
 *
 * Isolé dans son propre fichier pour une raison précise : c'est ici que s'est
 * niché le défaut le plus coûteux du prototype, et il fallait pouvoir le vérifier
 * de l'extérieur (voir `src/dev/selftest.ts`).
 */

import { create, fromBasis, type Mat4 } from '../math/mat4'
import { cross, neg, normalize, type Vec3 } from '../math/vec3'

export interface Camera {
  cell: string
  pos: Vec3
  /** Direction du regard, unitaire. */
  forward: Vec3
  /** Verticale locale — celle de la gravité, pas celle de la caméra. */
  up: Vec3
}

/**
 * Matrice monde de la caméra. Son troisième axe est l'**opposé** du regard : en
 * espace de vue, la caméra regarde vers -Z.
 *
 * Le « haut » de la caméra n'est pas la verticale de gravité, et confondre les
 * deux coûte cher parce que ça ne se voit pas tant qu'on regarde à l'horizontale.
 * Dès qu'on pique du nez, un repère fait de (côté, verticale de gravité, regard)
 * cesse d'être orthogonal ; or `invertRigid` suppose l'orthonormalité et se
 * contente de transposer la rotation. La matrice de vue devient alors fausse :
 * l'image cisaille, et les coutures — dont la caméra virtuelle hérite du défaut —
 * se remplissent de zones vides.
 *
 * La verticale de gravité ne sert qu'à fixer le **roulis** : elle donne le côté,
 * dont on déduit le vrai haut de la caméra.
 */
export function cameraToWorld(cam: Camera): Mat4 {
  const right = normalize(cross(cam.forward, cam.up))
  const up = cross(right, cam.forward)
  return fromBasis(create(), right, up, neg(cam.forward), cam.pos)
}
