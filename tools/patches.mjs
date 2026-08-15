/**
 * Le catalogue des défauts qu'on sait réintroduire.
 *
 * Chaque entrée est un mécanisme de correction qu'on peut retirer d'un geste, pour
 * vérifier que le test de torture l'attrape. C'est la seule façon de savoir qu'un
 * contrôle de non-régression en est un : **un contrôle qu'on n'a jamais vu échouer
 * ne vaut rien.**
 *
 * Chaque défaut a été trouvé une fois par tâtonnement, et le réintroduire coûtait
 * alors une sauvegarde de fichier, un remplacement de texte et une restauration, à
 * la main, avec le risque de laisser la sonde en place. Ici c'est nommé, versionné
 * par le fichier lui-même, et restauré automatiquement.
 *
 * À enrichir à chaque nouveau défaut : le nom dit le symptôme, le commentaire dit
 * pourquoi ça cassait.
 */

export const PATCHES = {
  /**
   * La vrille repart du seuil, sans amorce droite. Elle se voit alors dès l'entrée : on
   * sait à quoi s'attendre avant d'y mettre les pieds, et tout l'effet de surprise
   * disparaît. Le défaut n'est pas technique mais de mise en scène — raison de plus pour
   * le verrouiller, puisque rien dans le rendu ne s'en plaindrait.
   * Attrapé par : l'invariant « une amorce droite existe ».
   */
  'vrille-sans-amorce': {
    file: 'src/world/world.ts',
    from: '  straight: 6,',
    to: '  straight: 0,',
  },

  /**
   * Seule la verticale est transportée dans le tube vrillé, pas le regard. C'est
   * l'erreur naturelle : on pense « la gravité tourne » et on oublie que la tête tourne
   * avec. L'angle entre le regard et le haut change alors au fil de la marche : on
   * avance tout droit et l'image pique lentement du nez.
   *
   * Note : ce défaut est plus fin que `vrille-sans-transport`, qui supprime les deux
   * rotations d'un coup et laisse donc l'angle relatif juste. Chaque invariant mérite
   * un défaut qui le cible.
   * Attrapé par : l'invariant « le regard ne dérive pas », et par lui seul.
   */
  'vrille-regard-oublie': {
    file: 'src/world/motion.ts',
    from: '        for (let k = 0; k < carried.length; k++) {',
    to: '        for (let k = 1; k < carried.length; k++) {',
  },

  /**
   * Les directions attachées au visiteur ne sont plus transportées dans le tube
   * vrillé : seule la verticale suit la section, pas le regard. L'angle entre les deux
   * change alors au fil de la marche — on avance tout droit et l'image pique lentement
   * du nez, sans qu'on comprenne pourquoi.
   * Attrapé par : l'invariant « le regard ne dérive pas ».
   */
  'vrille-sans-transport': {
    file: 'src/world/motion.ts',
    from: '        for (let k = 0; k < carried.length; k++) {',
    to: '        for (let k = 0; k < 0; k++) {',
  },

  /**
   * Le pas est exprimé en coordonnées du monde au lieu du repère local. Marcher en
   * ligne droite à travers un tube qui tourne dérive alors latéralement de vingt-cinq
   * centimètres par passage : on finit plaqué contre une paroi, hors d'atteinte de la
   * porte, et le couloir infini se referme au bout de deux allers-retours.
   * Attrapé par : l'invariant de dérive latérale, et par « le couloir ne se referme
   * jamais », qui tombe de quatre-vingt-treize traversées à cinq.
   */
  'vrille-pas-en-monde': {
    file: 'src/world/motion.ts',
    from: '    const candidate = cell.twist',
    to: '    const candidate = false',
  },

  /**
   * La hauteur du corps est résolue **après** le test « ce corps passe-t-il par cette
   * porte ? ». Pendant un pas, la gravité fait descendre les pieds d'un cheveu sous le
   * sol ; le test les croit alors sous le seuil, refuse le passage, et la paroi arrête
   * net quiconque marche vers une porte. On marche sur place, sans rien qui l'explique.
   * Attrapé par : le balayage, qui ne quitte plus la rotonde, et l'aller-retour de
   * l'auto-test.
   */
  'verticale-apres-porte': {
    file: 'src/world/motion.ts',
    from: '  const feet = y - body.eyeHeight',
    to: '  const feet = p.y - body.eyeHeight',
  },

  /**
   * Le corps redevient un point : on ne vérifie plus que le crâne passe sous le
   * linteau. On entre alors dans une porte en pleine détente, la tête dans le mur, et
   * la traversée réussit puisque le test de franchissement ne regarde que l'œil.
   * Attrapé par : l'invariant « le linteau arrête celui qui saute trop haut ».
   */
  'corps-sans-hauteur': {
    file: 'src/world/motion.ts',
    from: '    return feet >= bottom - 1e-4 && head <= top + 1e-4',
    to: '    return true',
  },

  /**
   * La contrainte d'embrasure est appliquée pour chaque bouche à la suite, au lieu de
   * retenir la plus proche par paroi. Tant qu'un mur ne porte qu'une porte, cela va ;
   * dès que la rotonde en a deux sur le même mur, le corps engagé dans la première se
   * fait happer devant la seconde. On part vers une aile, on arrive dans une autre.
   * Attrapé par : le balayage, qui vérifie les cellules traversées et la continuité de
   * luminance — le déplacement latéral se voyait comme un saut de luminance de 52.
   */
  'embrasure-happee': {
    file: 'src/world/motion.ts',
    from: '  z = engage(x < cell.min.x, (m) => m.normal.x > 0.5, (m) => m.center.z, z)',
    to: `  for (const passage of cell.passages) {
    const m = passage.from
    if (Math.abs(m.normal.z) > 0.5 && (m.normal.z > 0 ? z < cell.min.z : z > cell.max.z)) {
      const limit = m.halfWidth - radius
      x = Math.min(Math.max(x, m.center.x - limit), m.center.x + limit)
    }
  }
  z = engage(x < cell.min.x, (m) => m.normal.x > 0.5, (m) => m.center.z, z)`,
  },

  /**
   * La traversée n'est déclenchée qu'après avoir dépassé le plan, au lieu de l'être
   * dès qu'on l'atteint. Un pas qui s'arrête à un cheveu du plan laisse alors le
   * corps dans sa cellule de départ, sans portail dessiné : le découpage de la
   * silhouette écarte l'ouverture en deçà de `EYE_EPS`, et il ne reste qu'un aplat.
   *
   * Attrapé par : le contrôle « arrêt sur le plan d'une couture », qui provoque
   * délibérément le cas en marchant de la marge restante moins un nanomètre.
   * Le balayage au millimètre ne l'attrape **pas** : y tomber est un événement de
   * mesure nulle, et il a fallu une coïncidence arithmétique pour le rencontrer une
   * première fois — reproductible avec
   * `node tools/light.mjs --from 2.0 --to -0.3 --step 100`.
   */
  'plan-inatteignable': {
    file: 'src/world/motion.ts',
    from: '    if (d0 <= PLANE_EPS || d1 > PLANE_EPS) continue',
    to: '    if (d0 <= 0 || d1 > 0) continue',
  },

  /**
   * Les ouvertures cessent de transmettre la lumière de la pièce d'en face. Rien ne
   * casse visiblement : les images restent contrastées et colorées, simplement
   * fausses.
   *
   * Attrapé par : le contrôle d'éclairage traversant, et par lui seul. Encore
   * a-t-il fallu le corriger : sa première version comparait la couleur du sol loin
   * de la porte et près d'elle, ce qui *semble* mesurer la transmission mais mesure
   * surtout le fait qu'on **voit** la pièce froide à travers l'ouverture. Il compare
   * désormais la même pose avec et sans, l'ouverture hors du champ.
   */
  'lumiere-non-transmise': {
    file: 'src/shaders/scene.wgsl',
    from: '  return m.colour.rgb * lambert * area / (area + 2.0 * PI * d2);',
    to: '  return vec3<f32>(0.0);',
  },

  /**
   * Le repère de la caméra prend la verticale de gravité comme axe « haut ».
   * Invisible à l'horizontale ; dès qu'on incline, le repère cesse d'être
   * orthogonal, `invertRigid` renvoie une matrice de vue fausse, l'image cisaille.
   * Attrapé par : l'invariant d'orthonormalité de la caméra. Aucune mesure d'image
   * ne le voit — une vue cisaillée a autant de relief qu'une vue correcte.
   */
  'camera-oblique': {
    file: 'src/render/camera.ts',
    from: '  const up = cross(right, cam.forward)',
    to: '  const up = cam.up',
  },

  /**
   * Le regard est reprojeté perpendiculairement à la verticale à chaque traversée,
   * ce qui écrase le tangage : le regard se redresse en franchissant une porte.
   * Attrapé par : les invariants de tangage, et le contrôle « deux points de vue ne
   * peuvent pas produire la même image ».
   */
  'tangage-ecrase': {
    file: 'src/player/player.ts',
    from: '    this.forward = normalize(this.forward)',
    to: '    this.forward = normalize(sub(this.forward, scale(this.up, dot(this.forward, this.up))))',
  },

  /**
   * Le plan proche oblique est appliqué même quand il passe par la caméra. Sa
   * troisième ligne devient l'opposée de la quatrième, tout atterrit sur le plan
   * lointain, la comparaison de profondeur échoue partout.
   * Attrapé par : le point de vue « au micron de la couture ».
   */
  'oblique-degenere': {
    file: 'src/render/renderer.ts',
    from: '    if (Math.abs(w) < NEAR) return copy(create(), proj)',
    to: '    // sonde : garde-fou retiré',
  },

  /**
   * La profondeur de clip n'est plus bornée : l'ouverture se fait écrêter dès qu'on
   * l'approche à moins de la distance du plan proche.
   * Attrapé par : les points de vue proches de la couture, et le balayage.
   */
  'sans-borne-de-z': {
    file: 'src/shaders/portal.wgsl',
    from: '  clip.z = max(clip.z, 0.0);',
    to: '  // sonde : borne retirée',
  },

  /**
   * La silhouette de l'ouverture n'est plus découpée devant l'œil. Les coins passés
   * derrière l'œil faussent les arêtes, et l'image se vide sur quelques millimètres
   * dans une plage d'inclinaisons étroite.
   * Attrapé par : le balayage, direction « nez baissé » — et par elle seule.
   */
  'sans-decoupage': {
    file: 'src/render/renderer.ts',
    from: '      const inA = da >= EYE_EPS',
    to: '      const inA = true',
  },

  /**
   * Les parois perdent leur épaisseur. L'œil passe alors à quelques millimètres
   * d'un mur, plus près que le plan proche : le mur est écrêté et laisse la couleur
   * d'effacement.
   * Attention : déplace le plan des coutures, donc les points de vue codés en dur
   * du test mesurent autre chose. À lire avec le balayage, qui se situe tout seul.
   */
  'sans-embrasure': {
    file: 'src/world/world.ts',
    from: 'const REVEAL = 0.25',
    to: 'const REVEAL = 0.0',
  },

  /**
   * L'orientation des objets lancés n'est plus transportée à travers les coutures :
   * seule leur vitesse l'est, et leur rotation reste dans l'ancien repère.
   * Attrapé par : l'invariant « l'angle entre les axes de l'objet et sa vitesse
   * reste continu ».
   */
  'orientation-non-transportee': {
    file: 'src/player/projectiles.ts',
    from: '      const carried = [p.vel, p.ex, p.ey, p.ez, p.axis]',
    to: '      const carried = [p.vel]',
  },

  /**
   * Une bouche vue de dos est peinte au lieu d'être ignorée. Comme la bouche de
   * sortie occupe à l'écran exactement la zone que le parent va lire, l'aplat
   * recouvre toute l'image utile.
   * Attrapé par : les points de vue de récursion, qui deviennent des aplats.
   */
  'bouche-de-dos-peinte': {
    file: 'src/render/renderer.ts',
    from: '      if (!visible) continue',
    to: '      if (false) continue',
  },
}
