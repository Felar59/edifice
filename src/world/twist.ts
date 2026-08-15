/**
 * Le tunnel-vrille : un couloir dont la section pivote autour de l'axe de marche.
 *
 * On y entre normalement. Au fil des mètres, la section tourne — et la gravité avec
 * elle. On ne saute pas, on ne tombe pas, on ne sent aucune transition : on marche
 * tranquillement, et au bout du tunnel le sol de l'entrée est devenu le mur de gauche.
 * En se retournant, on voit la porte d'entrée **couchée sur le côté**.
 *
 * ## Pourquoi une cellule spéciale, et pas trente cellules pivotées
 *
 * L'espace cousu sait déjà faire tourner un repère : c'est exactement ce que fait une
 * couture. Découper le tunnel en trente segments reliés par des coutures de trois
 * degrés aurait donc marché sans une ligne de moteur en plus.
 *
 * Sauf au rendu. Regarder le tunnel dans sa longueur demanderait trente niveaux de
 * récursion de portails, chacun une passe plein écran. C'est hors de question. Le
 * tunnel est donc **une seule cellule**, dont le repère est une fonction continue de
 * la distance parcourue.
 *
 * ## Ce qui tourne, et ce qui ne tourne pas
 *
 * La position ne tourne pas : elle vit dans le repère du monde, et la géométrie est
 * construite vrillée. Marcher tout droit le long de l'axe est donc un déplacement
 * rectiligne ordinaire.
 *
 * Ce qui tourne, ce sont les **directions attachées au visiteur** — son regard, sa
 * verticale locale, sa vitesse — et elles tournent d'un petit angle à chaque sous-pas,
 * proportionnel au chemin parcouru le long de l'axe. C'est ce qui fait qu'on ne sent
 * rien : il n'y a jamais de saut, seulement une rotation continue trop lente pour être
 * perçue autrement que par ses conséquences.
 *
 * Traiter le regard autrement serait une erreur qui se verrait tout de suite. Si seule
 * la verticale tournait, l'angle entre le regard et le haut changerait au fil de la
 * marche : on avancerait tout droit et l'image piquerait lentement du nez.
 *
 * ## La vrille n'existe que pendant qu'on la parcourt
 *
 * Un tube construit vrillé une fois pour toutes se trahit **depuis le seuil**. On voit
 * le sol partir en biais et devenir un mur, on comprend le tour avant d'avoir fait un
 * pas, et il ne reste plus qu'à le vérifier. Or l'effet ne tient pas à la vrille : il
 * tient au moment où on la découvre. Une amorce droite ne suffisait pas — elle repousse
 * la révélation de six mètres, elle ne l'empêche pas.
 *
 * La forme du tube dépend donc de l'endroit où se trouve le visiteur.
 *
 *   — **Derrière lui**, la vrille est celle du profil : c'est ce qu'il a réellement
 *     parcouru, et en se retournant il le voit.
 *   — **Autour de lui**, elle s'éteint en quelques mètres : les parois tournent sous ses
 *     pieds, à la vitesse où il avance, et c'est ce qu'il perçoit du tunnel.
 *   — **Au loin devant**, plus rien ne tourne du tout : toutes les sections partagent le
 *     même angle, donc le couloir file droit jusqu'à son autre bout.
 *   — **Personne dedans**, le tube est parfaitement droit d'un bout à l'autre.
 *
 * Le fondu doit se faire **vers l'avant** et non vers l'arrière, et c'est le genre de
 * détail qui décide de tout. Éteindre la vrille derrière soi donne un tunnel
 * rigoureusement inerte : on y marche sans jamais rien voir bouger, puisque tout ce qui
 * est dans le champ porte exactement son propre angle, et il faut se retourner pour
 * s'apercevoir qu'il s'est passé quelque chose. En l'éteignant devant, les deux ou trois
 * mètres qui entourent le marcheur tournent avec lui : il voit ses parois glisser sans
 * voir le couloir tourner.
 *
 * Ce n'est pas un décor qu'on redresse dans le dos du visiteur : c'est la même
 * fonction, évaluée à un autre endroit. `angleAt` répond à l'instant présent, et la
 * géométrie, les bouches, la collision et l'éclairage lui obéissent tous ensemble. Rien
 * dans le moteur ne voit deux tubes différents.
 *
 * ### Ce que le raccord impose
 *
 * Trois propriétés sont nécessaires, et elles se tiennent :
 *
 * **Sous les pieds du visiteur, l'angle est exact.** `revealedAt(s) = s` quand `s` est
 * l'abscisse du visiteur : la section qui l'entoure est celle que son transport lui a
 * donnée. Sans cette égalité, sa verticale et son sol ne seraient plus d'équerre et il
 * se cognerait à des murs invisibles.
 *
 * **Le fondu est progressif.** Couper net poserait un pli dans la paroi à l'endroit
 * précis où l'on se tient, c'est-à-dire au seul endroit qu'on ne quitte jamais des yeux.
 * La vrille s'éteint donc sur `blend` mètres devant le visiteur, sa vitesse de rotation
 * tombant continûment de la sienne à zéro.
 *
 * Ce que cela coûte est mesurable et voulu : le couloir lointain n'est pas dans l'axe du
 * visiteur mais roulé par rapport à lui d'une quinzaine de degrés au plus fort de la
 * vrille — l'intégrale de ce qui s'éteint. Il reste **droit**, c'est-à-dire sans
 * courbure ni fuite de côté, et c'est ce qui compte ; le roulis, lui, est précisément le
 * signe qu'on cherche à donner. Il naît de rien à l'entrée, où le palier droit le tient
 * à zéro, et il retombe à rien à la sortie.
 *
 * **Aux deux bouts, l'angle est exactement celui de la couture.** D'où le palier droit
 * à l'entrée (`straight`) et à la sortie (`runout`), tous deux plus longs que le fondu.
 * Le profil y étant rigoureusement constant, la bouche qu'on laisse derrière soi reste
 * clouée à son angle malgré le décalage d'une demi-longueur de fondu, et la bouche
 * d'arrivée a pris son orientation définitive trois mètres avant qu'on l'atteigne : à
 * l'instant du franchissement, la transformation de la couture est **exactement** celle
 * qui a été construite, et rien ne bouge sous les pieds au pire moment. Sans ces
 * paliers, la porte du fond finirait de pivoter pendant qu'on la franchit — peu de
 * chose, et pile sous les yeux.
 *
 * ### Par quel bout on est entré
 *
 * Le tunnel a deux bouches, et elles donnent toutes deux sur la rotonde. Le fondu doit
 * donc pouvoir se faire dans les deux sens : ce qui est « devant » se compte à partir
 * de la **bouche d'entrée**, et l'angle est ramené à zéro sur cette bouche-là. Entrer
 * par le fond du tunnel ne le montre donc pas davantage — le couloir y est droit aussi,
 * et il se tordra derrière ce visiteur-là comme derrière l'autre.
 *
 * Reste un cas, et il est assumé : ressortir par le bout opposé remet le tube au repos,
 * donc droit, d'un seul coup. Cela se produit à l'instant précis où l'on franchit la
 * couture, en tournant le dos au couloir. Il faudrait en sortir à reculons, sans quitter
 * la porte des yeux, pour l'apercevoir.
 */

import { cross, dot, normalize, rotateAxis, scale, sub, type Vec3 } from '../math/vec3'

/**
 * Où en est le visiteur dans le tube, et par quel bout il y est entré.
 *
 * C'est le seul état mutable du monde, et il est délibérément minuscule : deux nombres
 * et un drapeau, dont tout le reste — géométrie, bouches, coutures — se déduit.
 */
export interface Visit {
  /** Quelqu'un est-il dans le tube ? Sinon il est au repos, donc droit. */
  inside: boolean
  /** Abscisse du visiteur le long de l'axe. */
  s: number
  /** +1 s'il est entré par l'origine du tube, −1 par l'autre bout. */
  dir: 1 | -1
  /**
   * L'état a changé depuis la dernière fois qu'on en a tiré les conséquences.
   *
   * Le déplacement met cet état à jour à chaque sous-pas — tous les quatre centimètres —
   * alors que la géométrie et les coutures n'ont besoin d'être refaites qu'une fois par
   * image. Ce drapeau est la charnière entre les deux cadences.
   */
  moved: boolean
}

export interface Twist {
  /** Centre de la section d'entrée. */
  origin: Vec3
  /** Direction de l'axe, unitaire. */
  axis: Vec3
  /** Longueur du tube, le long de l'axe. */
  length: number
  /** Demi-côté de la section carrée. */
  halfSize: number
  /** Angle total de la vrille, en radians. */
  turn: number
  /**
   * Palier droit au départ : la vrille ne commence qu'après cette distance.
   *
   * On s'engage donc dans le couloir, et il ne se passe rien — un temps mort qui vaut
   * mieux qu'un effet immédiat. Ce palier a par ailleurs un rôle technique : il doit
   * excéder `blend`, sans quoi l'entrée du tube ne serait pas exactement à l'angle de
   * sa couture.
   */
  straight: number
  /** Le même palier à l'autre bout, et pour les mêmes deux raisons. */
  runout: number
  /**
   * Longueur du fondu qui éteint la vrille devant le visiteur.
   *
   * C'est le réglage de l'effet, et il se lit dans les deux sens. Court, il courbe la
   * paroi sèchement au ras des pieds et ne laisse presque rien voir — le tunnel devient
   * inerte tant qu'on regarde devant soi. Long, il adoucit le raccord et roule le couloir
   * lointain d'autant plus, jusqu'à le montrer franchement couché. Trois mètres donnent
   * une quinzaine de degrés au plus fort de la vrille : de quoi voir que quelque chose
   * tourne, pas de quoi comprendre quoi.
   */
  blend: number
  /** Repère de référence à l'entrée : le côté et le haut, perpendiculaires à l'axe. */
  right0: Vec3
  up0: Vec3
  /** L'état de la visite en cours. Voir l'en-tête du fichier. */
  visit: Visit
}

/** Coordonnées dans le repère qui suit la vrille. */
export interface Local {
  /** Distance parcourue le long de l'axe. */
  s: number
  /** Écart latéral, dans le repère tourné. */
  u: number
  /** Écart vertical, dans le repère tourné. */
  v: number
}

/**
 * Le profil de la vrille : l'angle que le tube atteint à une distance donnée quand on
 * l'a parcouru jusque-là.
 *
 * C'est la vrille « en vrai », celle que le visiteur accumule et qu'il voit derrière
 * lui — à distinguer de `angleAt`, qui est ce que la paroi montre à l'instant présent.
 *
 * Un palier droit à chaque bout, et entre les deux une montée **en fondu** — trois t
 * carré moins deux t cube — dont la pente est nulle aux deux extrémités. La vrille
 * s'installe donc sans début perceptible, et s'achève de même.
 *
 * Cette pente nulle n'est pas qu'une affaire de goût. Un profil linéaire tourne encore à
 * pleine vitesse au moment où l'angle bute sur sa valeur finale : la dérivée saute, ce
 * qui laisse un pli dans la géométrie et un à-coup dans la caméra.
 */
export function profileAngle(twist: Twist, s: number): number {
  if (s <= twist.straight) return 0

  const end = twist.length - twist.runout
  if (s >= end) return twist.turn

  const span = end - twist.straight
  if (span <= 0) return twist.turn

  const t = (s - twist.straight) / span
  return twist.turn * t * t * (3 - 2 * t)
}

/**
 * Le fondu, exprimé comme une primitive.
 *
 * `ramp` vaut zéro derrière le visiteur, puis rejoint doucement `x − ½` devant lui. Sa
 * dérivée — zéro, puis `x`, puis un — est continue, ce qui est tout ce qu'on lui
 * demande : c'est elle qui devient la courbure de la paroi, et une dérivée qui saute est
 * un pli qu'on voit.
 */
function ramp(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return x - 0.5
  return (x * x) / 2
}

/**
 * L'abscisse dont la section située en `s` emprunte l'angle.
 *
 * Derrière le visiteur, c'est `s` lui-même : le couloir y est ce qu'il a réellement
 * parcouru, et il ne bougera plus. Sous ses pieds, c'est encore `s` — l'égalité dont
 * dépendent son sol et sa verticale. Devant lui, l'abscisse ralentit puis s'arrête, une
 * demi-longueur de fondu plus loin : toutes les sections au-delà partagent alors le même
 * angle, ce qui rend le couloir droit dans la profondeur du champ.
 *
 * Ce n'est donc pas la vrille qui recule quand on avance, c'est l'endroit où elle
 * s'éteint qui suit le marcheur.
 */
export function revealedAt(twist: Twist, s: number): number {
  const { s: p, dir } = twist.visit
  const ahead = dir * (s - p)
  return p + dir * (ahead - twist.blend * ramp(ahead / twist.blend))
}

/**
 * L'angle **vu** en `s`, à l'instant présent.
 *
 * C'est la fonction dont dépendent la géométrie, les bouches, la collision et le
 * transport des directions. Elle est ramenée à zéro sur la bouche d'entrée : le
 * visiteur qui vient d'arriver ne doit voir bouger aucune paroi, et celui qui n'est pas
 * encore entré doit voir un couloir droit.
 */
export function angleAt(twist: Twist, s: number): number {
  const entry = twist.visit.dir > 0 ? 0 : twist.length
  return profileAngle(twist, revealedAt(twist, s)) - profileAngle(twist, entry)
}

/**
 * Déclare où se trouve le visiteur, ou qu'il n'est plus là (`null`).
 *
 * Le bout par lequel on entre est décidé une fois, à l'entrée, et par le seul critère qui
 * vaille : celui dont on est le plus près. Il ne change plus tant qu'on est dedans —
 * faire pivoter le fondu parce qu'on se retourne ferait tourner le couloir entier sur
 * place.
 *
 * C'est aussi ici que la sortie remet le tube au repos, donc droit. Cela se voit-il ? Le
 * moment est celui du franchissement, en tournant le dos au couloir ; et comme la vrille
 * est d'un quart de tour et la section carrée, le tube au repos et le tube vrillé ont
 * exactement la **même** forme — seules les couleurs des quatre faces permutent. Il
 * faudrait sortir à reculons, sans quitter la porte des yeux, pour s'en apercevoir.
 */
export function setVisitor(twist: Twist, s: number | null): void {
  const visit = twist.visit

  if (s === null) {
    if (!visit.inside) return
    visit.inside = false
    visit.s = 0
    visit.dir = 1
    visit.moved = true
    return
  }

  const dir = visit.inside ? visit.dir : s * 2 <= twist.length ? 1 : -1
  if (visit.inside && visit.s === s && visit.dir === dir) return
  visit.inside = true
  visit.s = s
  visit.dir = dir
  visit.moved = true
}

/**
 * L'état a-t-il bougé depuis la dernière fois qu'on a posé la question ? Le drapeau est
 * remis à zéro au passage : celui qui interroge s'engage à en tirer les conséquences.
 */
export function takeVisitChange(twist: Twist): boolean {
  const moved = twist.visit.moved
  twist.visit.moved = false
  return moved
}

/** Le repère local à une distance donnée. */
export function frameAt(twist: Twist, s: number): { right: Vec3; up: Vec3 } {
  const angle = angleAt(twist, s)
  return {
    right: rotateAxis(twist.right0, twist.axis, angle),
    up: rotateAxis(twist.up0, twist.axis, angle),
  }
}

/** L'abscisse d'un point le long de l'axe. Ne dépend d'aucune rotation. */
export function arcAt(twist: Twist, p: Vec3): number {
  return dot(sub(p, twist.origin), twist.axis)
}

/** Du monde vers le repère qui suit la vrille. */
export function toLocal(twist: Twist, p: Vec3): Local {
  const rel = sub(p, twist.origin)
  const s = dot(rel, twist.axis)
  const { right, up } = frameAt(twist, s)
  return { s, u: dot(rel, right), v: dot(rel, up) }
}

/** Et retour. */
export function toWorld(twist: Twist, local: Local): Vec3 {
  const { right, up } = frameAt(twist, local.s)
  const p = { ...twist.origin }
  p.x += twist.axis.x * local.s + right.x * local.u + up.x * local.v
  p.y += twist.axis.y * local.s + right.y * local.u + up.y * local.v
  p.z += twist.axis.z * local.s + right.z * local.u + up.z * local.v
  return p
}

/**
 * La rotation à appliquer aux directions du visiteur quand il passe de `from` à `to`
 * le long de l'axe.
 *
 * C'est le cœur de l'effet. Appliquée à chaque sous-pas — donc tous les quatre
 * centimètres — elle est de l'ordre du dixième de degré : imperceptible sur le coup,
 * décisive au bout du tunnel.
 *
 * Elle se lit sur le **profil**, et non sur ce que la paroi montre. Le visiteur se tient
 * toujours au front du fondu, là où les deux coïncident ; c'est ce qui fait qu'il tourne
 * exactement comme la section qui l'entoure, et qu'au bout du compte il a bien accumulé
 * le quart de tour annoncé.
 */
export function transportAngle(twist: Twist, from: number, to: number): number {
  return profileAngle(twist, to) - profileAngle(twist, from)
}

/** Fait tourner un vecteur de l'angle de vrille parcouru. */
export function transport(twist: Twist, angle: number, v: Vec3): Vec3 {
  return rotateAxis(v, twist.axis, angle)
}

/**
 * Construit une vrille à partir de son entrée et de sa direction.
 *
 * `up0` est redressé pour être perpendiculaire à l'axe : une base qui ne l'est pas
 * fausserait tout le reste en silence, et c'est le genre d'erreur qu'on met des heures
 * à retrouver.
 *
 * Les paliers droits doivent excéder la longueur du fondu, faute de quoi les bouches ne
 * seraient plus exactement à l'angle de leur couture. C'est refusé bruyamment plutôt que
 * toléré : le symptôme serait un pivotement d'un degré à l'entrée, assez petit pour
 * passer pour autre chose.
 */
export function makeTwist(spec: {
  origin: Vec3
  axis: Vec3
  length: number
  halfSize: number
  turn: number
  straight: number
  runout: number
  blend: number
  up0: Vec3
}): Twist {
  if (spec.blend > spec.straight || spec.blend > spec.runout) {
    throw new Error('vrille : le fondu déborde des paliers droits, les bouches ne raccorderaient plus')
  }

  const axis = normalize(spec.axis)
  const up0 = normalize(sub(spec.up0, scale(axis, dot(spec.up0, axis))))
  const right0 = cross(up0, axis)
  return {
    origin: spec.origin,
    axis,
    length: spec.length,
    halfSize: spec.halfSize,
    turn: spec.turn,
    straight: spec.straight,
    runout: spec.runout,
    blend: spec.blend,
    right0,
    up0,
    visit: { inside: false, s: 0, dir: 1, moved: false },
  }
}
