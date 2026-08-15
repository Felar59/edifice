import type { F32 } from '../f32'
import type { Mat4 } from '../math/mat4'
import type { Vec3 } from '../math/vec3'
import type { CellLighting, Colour } from './light'
import type { Twist } from './twist'

/**
 * Une **bouche** de couture : une ouverture rectangulaire posée sur une paroi.
 *
 * `right`, `up` et `normal` forment un repère orthonormé direct
 * (`normal = right × up`). `normal` pointe **vers l'intérieur** de la cellule,
 * c'est-à-dire vers celui qui regarde l'ouverture depuis la pièce.
 */
export interface Mouth {
  /** Nom court et unique, pour que les diagnostics désignent la bonne bouche. */
  id: string
  /** Cellule dans laquelle cette bouche s'ouvre. */
  cell: string
  center: Vec3
  right: Vec3
  up: Vec3
  normal: Vec3
  halfWidth: number
  halfHeight: number
}

/**
 * Une **couture** vue depuis une de ses deux faces : la traversée d'ici vers
 * là-bas, avec la transformation qui va avec.
 *
 * Les deux faces d'une même couture donnent deux `Passage`, inverses l'un de
 * l'autre. C'est cette structure que le rendu et le déplacement consultent.
 */
export interface Passage {
  from: Mouth
  to: Mouth
  /**
   * Cette couture n'a **pas de jumelle**, et c'est voulu.
   *
   * Presque toutes se franchissent dans les deux sens : c'est la propriété qui fait qu'un
   * pas en avant suivi d'un pas en arrière ramène au point de départ, et une jumelle
   * manquante est d'ordinaire un oubli. L'escalier de Penrose est l'exception qui donne
   * son sens à la règle : on le monte indéfiniment, on ne le descend pas indéfiniment. Le
   * recollement y est **orienté**, ce qui est précisément ce qu'un escalier impossible a
   * de plus impossible.
   *
   * Le drapeau existe pour que l'auto-test puisse continuer d'exiger une jumelle partout
   * ailleurs : un aller sans retour doit être déclaré, jamais découvert.
   */
  oneWay?: true
  /** Transformation rigide de l'espace de `from.cell` vers celui de `to.cell`. */
  transform: Mat4
  /**
   * Lumière que cette ouverture déverse dans `from.cell`, en provenance de
   * `to.cell` : c'est ainsi que l'éclairage traverse une couture.
   *
   * Ne compte que l'éclairage **direct** de la pièce d'en face — ses lampes et son
   * ambiance, pas ce que ses propres ouvertures lui apportent. Sans cette coupure,
   * deux salles reliées se renverraient la lumière indéfiniment.
   */
  radiance: Colour
}

/**
 * Un **bloc plein** posé dans une cellule : de la matière, là où il n'y en avait pas.
 *
 * Jusqu'ici un corps savait rester dans une boîte ; il ne savait pas en contourner une.
 * C'est ce qui manquait pour poser quoi que ce soit au milieu d'une salle — un coffre,
 * un pilier, et plus tard une cloison qui coulisse.
 *
 * `door` est la bouche percée dans une de ses faces, s'il y en a une. Elle est retenue
 * ici en plus de vivre dans les passages de la cellule, parce que la collision a deux
 * questions distinctes à lui poser : « cette ouverture perce-t-elle une paroi de la
 * pièce ? » — non — et « laisse-t-elle entrer dans ce bloc ? » — oui.
 */
export interface Block {
  min: Vec3
  max: Vec3
  door?: Mouth
}

/**
 * Une cellule dont **les six faces sont habitables**.
 *
 * Le bas cesse d'y être une constante : il est la face qu'on a choisie, et l'on en change
 * en marchant. La bascule se déclenche sur une **bande d'accroche** peinte le long de
 * chaque arête — et sa largeur n'est pas décorative.
 *
 * Elle vaut exactement la hauteur d'œil du visiteur. C'est ce qui rend la bascule
 * gratuite : au moment où l'on arrive à cette distance de la face voisine, on est déjà
 * précisément à la distance où l'on se tiendrait debout **sur** elle. Il n'y a donc rien à
 * déplacer, seulement un repère à tourner. Une bande plus étroite ou plus large ferait
 * sauter le corps d'autant au moment du basculement, et ce serait le genre d'à-coup qu'on
 * met des heures à relier à sa cause.
 */
export interface FaceGravity {
  grip: number
}

/**
 * **L'escalier de Penrose** : un ruban de marches qui tourne autour d'un pilier plein, et
 * dont la hauteur ne dépend que de l'angle.
 *
 * La montée se referme sur elle-même par une couture posée au **raccord**, qui translate
 * verticalement d'un tour exact. On la franchit sans rien sentir : de l'autre côté, les
 * marches reprennent à la hauteur où l'œil les attendait. On monte donc indéfiniment.
 *
 * La hauteur étant fonction du seul angle, les marches sont des **quartiers rayonnants**,
 * comme dans un escalier tournant réel : la volée est plus raide contre le pilier que
 * contre le mur.
 *
 * La collision, elle, suit une **rampe** et non les marches. Personne ne voit ses pieds,
 * et un sol en escalier ferait monter le corps par bonds de la hauteur d'une marche à
 * chaque franchissement de nez. La rampe passe au milieu des marches : on flotte d'une
 * demi-marche au plus, ce qui ne se voit pas, et l'on marche continûment.
 */
export interface Spiral {
  /** Le centre du pilier, et la hauteur du bas des marches. */
  centre: Vec3
  /** Demi-largeur du pilier, puis de l'anneau : la volée court entre les deux. */
  inner: number
  outer: number
  /** Hauteur gagnée en un tour complet. */
  rise: number
  /**
   * Nombre de marches par tour. Multiple de huit, obligatoirement : c'est ce qui fait
   * tomber une limite de marche sur chacun des quatre angles du pilier, faute de quoi une
   * marche chevaucherait un coin et son quartier cesserait d'être plan.
   */
  steps: number
  /** L'angle du raccord, où la couture referme la boucle. */
  cut: number
  /**
   * Les paliers : des suites de marches de plain-pied.
   *
   * Il en faut un devant chaque porte. Le sol d'un escalier tournant n'est de niveau que
   * le long d'un rayon, or une porte est percée dans une paroi, donc en travers : sans
   * palier, le sol monterait de près d'un mètre sur la largeur de l'ouverture et l'on
   * entrerait par le biais.
   *
   * Ils ne coûtent rien à la couture du raccord : ce qui doit valoir exactement `rise`,
   * c'est le gain sur un tour entier, et il le vaut toujours — la montée se répartit
   * simplement sur moins de marches.
   */
  landings: { at: number; count: number }[]
  /**
   * Hauteur libre sous le plafond, qui est lui-même un ruban suivant les marches.
   *
   * Un plafond plat trahit la boucle : on le sent se rapprocher en montant, puis s'écarter
   * d'un tour d'un seul coup au raccord. En le faisant suivre les marches, le couloir a
   * partout la même section et la couture le recolle exactement comme elle recolle le sol.
   */
  headroom: number
  /**
   * Le tronçon effectivement construit, en tours : de `from` à `from + turns`.
   *
   * La boucle occupe [0, 1] ; ce qui déborde en dessous n'est parcouru qu'une fois, en
   * descendant. C'est là qu'on met la porte que celui qui monte ne doit jamais voir.
   */
  from: number
  turns: number
}

export interface Cell {
  id: string
  /** Boîte englobante intérieure, utilisée pour la collision de l'étape 1. */
  min: Vec3
  max: Vec3
  /** Ce qui est plein à l'intérieur, et qu'il faut contourner. */
  blocks?: Block[]
  /** Si les six faces sont habitables, la façon d'en changer. */
  gravity?: FaceGravity
  /** Si le sol est un escalier tournant, sa description. */
  spiral?: Spiral
  /** Sommets entrelacés, voir `FLOATS_PER_VERTEX`. */
  verts: F32
  /** Les passages qui partent de cette cellule. */
  passages: Passage[]
  /** Lampes et ambiance propres à la cellule. */
  lighting: CellLighting
  /**
   * Si la cellule est un tube vrillé, sa description.
   *
   * Sa présence change deux choses : la collision se fait dans le repère redressé, et
   * les directions attachées au visiteur tournent au fil de sa progression le long de
   * l'axe.
   */
  /**
   * Densité du brouillard propre à la cellule, si elle en demande une.
   *
   * Une salle qui se répète a besoin d'un horizon plus proche que les autres : les copies
   * s'arrêtent forcément quelque part, et c'est le brouillard, et lui seul, qui fait que
   * cette limite ne se lit pas comme un mur.
   */
  fog?: number

  /**
   * **Le réseau : la cellule se répète, et on la dessine répétée.**
   *
   * Une salle dont les parois opposées sont cousues est un tore, et l'on y voit une infinité
   * de copies d'elle-même. Le rendu par portails saurait le montrer — chaque paroi est une
   * couture comme une autre — mais mal : chaque copie coûterait une passe plein écran, le
   * budget s'épuiserait au bout de trois longueurs, et l'on verrait un mur de brouillard au
   * fond du couloir.
   *
   * Il y a bien plus simple, et c'est ce que fait *Manifold Garden* : puisque la
   * transformation d'une copie à l'autre est une **pure translation**, on dessine tout
   * bêtement la même géométrie plusieurs fois, décalée du pas du réseau. Vingt quadrilatères
   * quatre-vingts fois, c'est moins qu'une seule passe de portail — et le couloir de copies
   * s'enfonce alors jusqu'à l'horizon, sans coupure d'aucune sorte.
   *
   * Les coutures restent, mais pour le **déplacement** seulement : elles ramènent le
   * visiteur dans la copie centrale dès qu'il en sort, ce qui garde ses coordonnées bornées
   * et les erreurs d'arrondi avec elles.
   */
  lattice?: {
    /** Pas du réseau selon x et z. */
    x: number
    z: number
    /** Nombre de copies de part et d'autre, dans chaque direction. */
    radius: number
  }

  twist?: Twist
}

export interface World {
  cells: Map<string, Cell>
}
