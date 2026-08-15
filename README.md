# Édifice — le musée impossible

Un musée dont l'architecture est physiquement impossible, et dont chaque salle est
une machine en état de marche : chacun de mes projets y tourne pour de vrai, et
c'est en le faisant fonctionner qu'on avance dans le bâtiment.

Le plan de travail complet — les six moments signature, les onze machines, les
lots et leurs portes de sortie — vit dans `PLAN.md`, à la racine du dossier du
portfolio. Ce dépôt-ci contient le moteur.

**État : le premier moment signature tourne.** Une rotonde à huit portes, des portails
qu'on n'arrive pas à prendre en défaut, un éclairage qui franchit les ouvertures, le
saut et la chute — le **tunnel-vrille**, dont la section pivote d'un quart de tour sur
dix-huit mètres, gravité comprise — et le **volume impossible** : un coffre de deux mètres
cinquante qui contient la salle de douze où il est posé. Cinq ailes attendent encore leur
mécanique.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5190
npm run torture    # les invariants + les captures dans shots/
npm run check      # typage
```

Il faut un navigateur avec WebGPU : Chrome ou Edge à jour.

Commandes : `ZQSD`/`WASD` pour se déplacer, `Maj` pour courir, `Espace` pour sauter,
`F` pour lancer un cube, `R` pour tout retirer, `[` et `]` pour la profondeur de
récursion, `H` pour masquer les panneaux, chiffres pour les points de vue du test.

## Ce qui est fait

### L'espace cousu

Le monde n'est pas un espace unique mais un **graphe de cellules** reliées par des
**coutures**. Une couture est une ouverture rectangulaire porteuse d'une transformation
rigide : franchir cette ouverture, c'est changer de repère.

Le plan du musée est une **rotonde** de 14 × 5 × 14, percée de huit portes, et sept
**ailes** — une par tricherie géométrique : le tunnel-vrille et le reliquaire, qui
tournent ; la gravité par face, l'escalier de Penrose, l'espace pavé, les murs mobiles et
la perspective forcée, qui attendent. Les cinq dernières sont vides, et c'est voulu : on
les remplira une par une, chacune avec son propre problème.

Les ailes sont éloignées de **centaines de mètres** les unes des autres et de la
rotonde. Aucune ne se touche. Ce n'est pas de l'économie de place mais une précaution
de mise au point : si deux cellules étaient voisines, une erreur de transformation
pourrait passer inaperçue, masquée par une coïncidence de position. Ici, la moindre
erreur envoie le visiteur dans le vide.

Les deux extrémités du tunnel donnent **toutes deux** sur la rotonde. On entre par la
porte nord, on parcourt les dix-huit mètres, on ressort par la porte sud — et on se
retrouve face à la porte nord. Le couloir n'a donc pas de fin, ce qui préserve le cas
de récursion le plus dur du rendu de portails ; il valait mieux le garder sous les yeux
en permanence.

Chaque aile a sa propre température de lumière. Du centre de la rotonde, on voit donc
une couronne de huit ouvertures de huit teintes différentes, chacune déposant sa couleur
au sol devant son seuil. Ce n'est pas seulement joli : c'est le contrôle visuel de
l'éclairage traversant, huit fois répété.

### Le rendu

Récursion en profondeur d'abord. Pour dessiner une cellule, on dessine d'abord
dans des textures séparées ce qu'on aperçoit à travers chacune de ses bouches,
puis la cellule elle-même, puis on peint chaque ouverture avec l'image
correspondante. Les passes étant encodées dans le même tampon de commandes,
l'ordre d'exécution garantit que l'image d'un enfant est prête quand son parent la
lit.

Trois décisions valent d'être expliquées.

**Textures plein écran plutôt que stencil.** Le rendu par stencil évite les
textures intermédiaires mais devient inextricable au-delà de deux niveaux. Avec
des cibles de la taille de la fenêtre, la caméra virtuelle conserve exactement la
même projection en x et y, donc le pixel cherché est au même endroit à l'écran :
un `textureLoad` à la position du fragment est **exact**, sans filtrage ni dérive
d'un demi-pixel.

**Plan proche oblique.** Sans lui, la paroi qui contient la bouche de sortie
apparaît en tranche dès qu'on approche le visage de l'ouverture — le défaut qui
trahit immédiatement un portail bricolé. La méthode d'Eric Lengyel s'applique, à
une correction près : la version qui circule partout suppose un z de clip dans
[-1, 1] à la façon d'OpenGL, alors que WebGPU utilise [0, 1]. Recopiée telle
quelle, elle décale le plan proche. Voir `src/math/mat4.ts`.

**Le haut de la caméra n'est pas la verticale de gravité.** Confondre les deux ne
se voit pas tant qu'on regarde à l'horizontale. Dès qu'on pique du nez, le repère
(côté, verticale de gravité, regard) cesse d'être orthogonal — et `invertRigid`,
qui suppose l'orthonormalité et se contente de transposer la rotation, renvoie
alors une matrice de vue fausse, sans le moindre message d'erreur. L'image
cisaille, et les coutures, dont la caméra virtuelle hérite du défaut, se
remplissent de zones vides. La verticale de gravité ne sert qu'à fixer le roulis.

**Les parois ont une épaisseur.** Ce n'est pas une coquetterie d'architecte. Avec
des cloisons sans épaisseur, l'œil passe à quelques millimètres d'un mur, donc plus
près que le plan proche : le mur est intégralement écrêté, et comme rien ne se
trouve derrière lui, toute la zone qu'il occupait devient la couleur d'effacement.
Une embrasure de vingt-cinq centimètres, avec la couture posée en son fond,
garantit qu'aucune surface n'entre dans le plan proche pendant la traversée. Le
relief des jambages remplace du même coup l'encadrement peint qui décorait les
ouvertures, ce qui supprime la seule géométrie coplanaire de la scène — et permet
donc de rapprocher le plan proche à quatre millimètres sans craindre le conflit de
profondeur.

**Deux pièges à l'instant du franchissement.** Ils se cumulent, et donnaient tous
deux une image entièrement vide au pire moment.

Le premier : à quelques millimètres de l'ouverture, le quad du portail est plus
proche que le plan proche, donc entièrement écrêté. La parade tient en une ligne de
nuanceur — **borner la profondeur de clip à zéro**. La position d'un sommet à
l'écran vient de `x`, `y` et `w` ; `z` ne détermine que la profondeur. La ramener à
zéro pose donc le sommet sur le plan proche sans le déplacer d'un pixel. On y perd
seulement que, sur ces quelques millimètres, l'ouverture gagne le test de
profondeur contre tout ce qui la précède — or rien ne peut s'y trouver.

Deux tentatives précédentes ont échoué, et pour des raisons instructives.

La première peignait tout l'écran quand l'œil approchait de l'ouverture, au motif
qu'à cette distance elle couvre tout le champ. C'était vrai, mais seulement si on
la regarde : le raccourci ignorait la **direction du regard**. Debout dans
l'embrasure et tourné vers l'arrière, il recouvrait toute l'image avec la vue d'une
caméra virtuelle qui regarde hors de la salle d'en face — la pièce où l'on se
trouve devenait un grand aplat gris.

La seconde éloignait chaque coin de l'œil le long de son rayon, ce qui préserve
aussi la projection. Mais un coin passé **derrière** l'œil ne peut pas être éloigné
vers l'avant, et l'arête qui le relie à un coin déplacé n'est plus la même droite :
elle traverse le plan proche ailleurs, et la silhouette obtenue est fausse. Cela
survient dès qu'on se tient dans l'embrasure en inclinant le regard, et cela
laissait une bande de quatre millimètres où l'image se vidait encore. D'où le
découpage du polygone contre le demi-espace situé devant l'œil, côté processeur,
avant de l'envoyer au nuanceur.

Le second : quand le plan de coupe passe **par** la caméra virtuelle, le plan
proche oblique dégénère. La troisième ligne de la matrice devient l'opposée de la
quatrième, tous les fragments atterrissent exactement sur le plan lointain, et la
comparaison de profondeur `less` échoue partout. La parade est de renoncer à
l'obliquité dans ce cas, ce qui est correct et pas seulement commode : s'il n'y a
rien entre la caméra et l'ouverture, il n'y a rien à écarter.

**Une bouche vue de dos ne se dessine pas.** C'est le point qui a coûté le plus
cher à trouver. Il ne suffit pas de distinguer « avec image » et « sans image » :
il faut un troisième état, « invisible ». Une bouche prise de dos n'est pas une
surface, c'est un trou — et comme la bouche de sortie occupe à l'écran exactement
la zone que le parent s'apprête à lire, y poser un aplat recouvre toute l'image
utile. Le symptôme était une porte uniformément grise alors que tous les
compteurs indiquaient une récursion correcte.

### L'éclairage

**D'où vient la lumière dans une pièce qui n'a pas d'extérieur ?** De lampes posées
dans la pièce, et de ce qui filtre par les ouvertures. C'est la réponse
thématiquement juste — un musée enterré n'a pas de fenêtres, il a des spots — et
c'est aussi la moins chère.

Chaque cellule porte son ambiance et jusqu'à six lampes ponctuelles, évaluées à
chaque image. **Pas de lightmaps** : le plan les prévoyait, mais elles supposent un
monde figé, et il faudrait tout recuire au moindre mur qui bouge — or des murs qui
bougent sont au programme. **Pas d'ombres** non plus : une lampe éclaire à travers
une cloison, on l'assume, c'est le lot suivant.

Ce qui traverse les coutures, c'est que **chaque ouverture est aussi une lampe
rectangulaire**, portant la radiance de la pièce d'en face. On la calcule une fois,
à la construction du monde : l'ambiance de la pièce voisine plus ce que ses lampes
déposent sur le plan de l'ouverture. Un seul rebond, jamais deux : sans cette
coupure, deux salles reliées se renverraient la lumière indéfiniment et il faudrait
itérer.

Deux détails ont demandé du soin.

Une source surfacique s'évalue d'ordinaire par son **point représentatif**, le plus
proche du fragment. Pris seul, il rase les surfaces : pour un fragment de sol devant
une porte, ce point tombe au niveau du sol, la direction devient horizontale et le
terme de Lambert s'annule — une ouverture de deux mètres de haut n'éclairerait pas le
sol devant elle. On garde donc ce point pour l'atténuation, qui porte la proximité,
mais on prend la direction diffuse **à mi-chemin du point le plus proche et du centre
de l'ouverture**.

Et une pièce sombre n'a rien à transmettre. La salle n'était éclairée que depuis son
plafond, si bien que la lumière franchissant l'ouverture se réduisait à son ambiance :
dix fois trop faible pour compter. On croyait voir la lumière traverser alors qu'on
voyait seulement la pièce froide *à travers* l'ouverture, ce qui est une autre chose.
Deux appliques posées au-dessus des portes, côté salle, donnent à la transmission de
quoi exister.

La cohérence à travers une couture est garantie par un point d'architecture :
l'éclairage est attaché aux **cellules** et calculé en coordonnées du monde. Une paroi
vue directement et la même paroi vue à travers une couture reçoivent exactement le
même calcul, puisque rien dans ce calcul ne dépend de l'endroit d'où l'on regarde.
Faire dépendre la lumière d'une ouverture de la position de l'œil aurait suffi à tout
casser.

### Le déplacement

Un pas ne peut pas s'appliquer d'un bloc : sur une seule image, un corps peut
franchir une couture, ressortir ailleurs, glisser contre un mur et franchir une
seconde couture. Le pas est donc découpé en sous-pas de quatre centimètres, et à
chaque sous-pas on teste la traversée **avant** la collision — dans l'autre sens,
le mur qui contient la porte arrêterait net celui qui cherche à la franchir.

Les vecteurs à transporter (direction du regard, verticale locale, vitesse) sont
passés à `advance` et transformés à chaque traversée. Après quoi on les **remet à
l'unité, et rien de plus** : une version antérieure projetait aussi le regard
perpendiculairement à la verticale « pour remettre le repère d'équerre », ce qui
écrasait le tangage — le regard se redressait brutalement à chaque porte franchie.
Le regard n'a aucune raison d'être perpendiculaire à la verticale ; c'est
précisément ce que veut dire regarder en haut ou en bas. Seul le repère de la
caméra doit être orthonormé, et il est reconstruit à chaque image. L'orientation du visiteur
n'est pas stockée en angles d'Euler mais comme un regard plus une verticale : une
couture peut faire pivoter le monde n'importe comment, et le tunnel-vrille comme
la gravité par face exigent que « le haut » cesse d'être une constante.

### Le tunnel-vrille

Un couloir dont la section pivote autour de l'axe de marche. On y entre normalement ;
au fil des mètres la section tourne, et la gravité avec elle. On ne saute pas, on ne
tombe pas, on ne sent aucune transition — et au bout, en se retournant, la porte
d'entrée est **couchée sur le côté**. Vingt-deux mètres, un quart de tour, une section
de quatre mètres quarante.

**Les six premiers mètres sont parfaitement droits.** Depuis le seuil, le couloir se
présente comme un couloir : droit, banal, rien à signaler. La vrille ne commence qu'une
fois qu'on s'y est engagé, et en fondu — trois t carré moins deux t cube, dont la pente
est nulle aux deux bouts. Elle arrive donc de nulle part, sans début perceptible. Une
vrille répartie sur toute la longueur se verrait dès l'entrée, et l'on saurait à quoi
s'attendre.

Cette pente nulle aux extrémités n'est pas qu'une affaire de mise en scène. Un profil
linéaire tourne encore à pleine vitesse au moment où l'on borne l'angle en sortant du
tube : la dérivée saute, ce qui laisse un pli dans la géométrie et un à-coup dans la
caméra. En fondu, le bornage ne se voit pas, parce qu'il n'y a plus rien à borner.

**Pourquoi une cellule spéciale, et pas trente cellules pivotées.** L'espace cousu sait
déjà faire tourner un repère : c'est exactement ce que fait une couture. Découper le
tunnel en trente segments reliés par des coutures de trois degrés aurait donc marché
sans une ligne de moteur en plus — sauf au rendu, où regarder le tunnel dans sa longueur
demanderait trente niveaux de récursion de portails, chacun une passe plein écran. Le
tunnel est donc une seule cellule, dont le repère est une fonction continue de la
distance parcourue.

**Ce qui tourne.** Pas la position : elle vit dans le repère du monde, et la géométrie
est construite vrillée. Ce qui tourne, ce sont les directions attachées au visiteur — son
regard, sa verticale, sa vitesse — d'un petit angle à chaque sous-pas. C'est pour cela
qu'on ne sent rien : il n'y a jamais de saut, seulement une rotation trop lente pour
être perçue autrement que par ses conséquences.

Transporter la verticale sans transporter le regard serait l'erreur naturelle — on pense
« la gravité tourne » et on oublie que la tête tourne avec. L'angle entre les deux
changerait alors au fil de la marche : on avancerait tout droit et l'image piquerait
lentement du nez.

**Le pas se calcule en coordonnées locales, pas mondiales.** Marcher en ligne droite
dans le monde à travers un tube qui tourne dérive latéralement dans le repère du tube :
vingt-trois centimètres par passage, et l'on finit plaqué contre une paroi, hors
d'atteinte de la porte. Marcher droit dans un couloir, c'est avancer le long de l'axe
sans changer sa place dans la section — ce qui décrit une hélice dans le monde, et c'est
bien ce qu'on fait quand on suit un couloir qui vrille.

**Les quatre faces sont de couleurs franchement distinctes.** Une section carrée qui
tourne d'un quart de tour se superpose à elle-même : sans cela, le tunnel aurait la même
silhouette à ses deux bouts et la vrille serait parfaitement invisible.

**La vrille s'arrête aux extrémités du tube.** Les bouches des coutures sont en retrait,
au fond de leur embrasure, mais portent le repère de la section qu'elles ferment — c'est
ce qui fait coïncider l'embrasure et la paroi qu'elle perce. Sans ce bornage, le visiteur
accumulerait dans l'embrasure un peu plus que la bouche ne le prévoit, et la couture
emporterait ce décalage dans la rotonde : on s'y retrouverait debout de travers, un peu
plus à chaque tour.

Enfin, la couture de sortie **absorbe** la vrille accumulée, puisqu'une transformation
rigide emporte le repère entier. On ressort donc parfaitement d'aplomb, sans à-coup.

### Le volume impossible

Au centre d'une aile, **un coffre de deux mètres cinquante**. Dans sa face, une porte
ordinaire, celle de partout ailleurs : un mètre quatre-vingts sur deux mètres vingt. Elle
occupe donc presque toute la face, et c'est là que le compte cesse d'y être — une porte à
hauteur d'homme dans une boîte à peine plus haute qu'elle.

Et derrière cette porte, il n'y a pas d'autre salle : **il y a celle-ci.** Le coffre
débouche par la porte du mur du fond, à huit mètres de là. On entre dans une boîte de deux
mètres cinquante et l'on ressort dans la pièce de douze mètres où elle est posée.

Le contenant contient donc son contenant — **cinquante-cinq fois son propre volume**. Ce
n'est pas le chiffre qui compte, c'est la circularité. Une salle séparée, si vaste
soit-elle, reste une pièce qu'on n'avait jamais vue, et le visiteur peut toujours se dire
qu'elle est ailleurs. Ici il n'y a pas d'ailleurs : il regarde par la petite porte et il
voit, de dos, le coffre où il regarde, et derrière lui la porte par laquelle il est entré
dans la salle.

**Aucune tricherie d'échelle.** Les deux bouches de la couture ont exactement la même
taille, la transformation reste rigide, et le visiteur garde sa stature. Ce n'est ni une
illusion d'optique ni un rétrécissement : on fait le tour du coffre, on le mesure du
regard, et rien ne change. C'est ce que le plan appelait le meilleur rapport effet/effort
du projet, et il avait raison — l'espace cousu le donne presque pour rien.

**Une couture dont les deux bouches sont dans la même cellule.** C'est le premier cas du
genre, et il n'a rien demandé : l'espace cousu relie des bouches, pas des pièces, et rien
dans le rendu ni dans le déplacement ne supposait qu'elles appartiennent à deux salles
distinctes. Une pièce peut donc se recoller à elle-même. L'espace pavé s'en servira.

Deux choses ont demandé du travail, et une troisième a demandé de l'humilité.

**Un corps savait rester dans une boîte ; il ne savait pas en contourner une.** Toute la
collision était écrite pour des pièces creuses — on reste dedans. Le coffre est le premier
volume plein du musée, et il a fallu l'inverse : on sort par la face la plus proche. C'est
la manière ordinaire de résoudre une boîte, et elle donne gratuitement le bon
comportement dans les trois cas — on glisse le long d'un côté, on se pose sur le dessus,
et l'on n'est jamais éjecté vers le bas, puisque sortir par en dessous demanderait de
descendre de toute la hauteur du corps plus celle du bloc. Ce code servira aux murs
mobiles, qui sont des blocs qui bougent.

**La porte d'un bloc n'est pas la porte d'une paroi.** Le piège était joliment posé. La
collision lève la butée d'un mur devant chaque ouverture de la cellule ; une bouche percée
dans un coffre au milieu de la salle a bien une normale horizontale, et se laisse donc
prendre pour une porte. On sortait alors de la pièce **par le mur d'en face**, en
s'alignant sur un coffre situé quatre mètres avant. Les bouches d'un bloc sont désormais
écartées de ce raisonnement, explicitement.

**Le coffre fait deux mètres cinquante, et non deux mètres soixante.** Les matrices sont en
flottants 32 bits, et l'invariant qui vérifie que les deux bouches d'une couture coïncident
est exact au bit près. À six cents mètres de l'origine, le pas du flottant vaut déjà un
dixième de millimètre : une demi-largeur de 1,30 m place la face du coffre sur une
coordonnée non représentable, et l'écart mesuré passe à 1,2 × 10⁻⁵ m. Le test l'a refusé,
et il avait raison. Tout le musée tient sur une **grille au quart de mètre**, où sommes et
différences restent exactes — une contrainte à connaître avant de poser une cote.

Enfin, le point de vue du test est pris **de trois quarts, et de loin**. De face et de
près, le coffre remplit le champ et redevient ce qu'il n'est pas : une porte dans un mur.
Il faut voir deux de ses faces, ses arêtes contre la salle, et par l'ouverture cette même
salle vue du fond. Un volume impossible qu'il faut expliquer est un volume raté.

### La verticalité

On saute et on tombe. Gravité à dix-huit mètres par seconde carrée — près du double du
réel, ce qui est délibéré : à 9,81 un saut d'un demi-mètre dure près d'une seconde et
donne une impression de flottement lunaire. Le saut culmine à cinquante-cinq centimètres
en une demi-seconde.

Le corps a cessé d'être un point le jour où il a pu monter. Il fait un mètre
quatre-vingts, l'œil à un mètre soixante-cinq, et ces quinze centimètres de crâne ne
sont pas un détail : ce sont eux qui heurtent le linteau. Sans cette hauteur, on
entrerait dans une porte en pleine détente, la tête dans le mur — et la traversée
réussirait, puisque le test de franchissement ne regarde que l'œil.

Deux points d'implémentation méritent d'être notés.

La gravité s'applique **à chaque image, y compris à l'arrêt**. C'est ce qui maintient
l'appui au sol : le petit déplacement vers le bas est rattrapé par la résolution de
collision, qui signale le contact. Tester l'appui séparément demanderait un second
sondage, et le drapeau clignoterait d'une image sur l'autre — de quoi rendre le saut
capricieux.

Et la hauteur du corps est résolue **avant** de décider s'il passe par une porte. Dans
l'autre ordre, la gravité fait descendre les pieds d'un cheveu sous le sol pendant le
pas, le test les croit sous le seuil, refuse le passage, et la paroi arrête net
quiconque marche vers une porte. On marche alors sur place, sans rien qui l'explique.

Les objets lancés passent par le même code. Un cube qui traverse l'ouverture,
atterrit de l'autre côté et reste visible **à travers** l'ouverture prouve d'un
coup que la géométrie, le déplacement et le rendu partagent bien la même
transformation — un portail purement visuel se trahit ici en une seconde.

## Le test de torture

`npm run torture` fait deux choses.

**Les invariants**, vérifiés par le calcul : rigidité et orientation de chaque
transformation, coïncidence des bouches, normale retournée, verticale conservée,
aller-retour strictement neutre, mille six cents mètres de marche dans le couloir
infini sans dérive de la direction du regard ni sortie de cellule. Tous les écarts
mesurés sont actuellement nuls au bit près, ce qui est attendu : les
transformations sont composées de zéros, de uns et de translations exactes.

S'y ajoute l'orthonormalité du repère de la caméra, vérifiée à toutes les
inclinaisons. C'est l'invariant qui manquait, et son absence a laissé passer le
défaut le plus visible du prototype.

S'y ajoutent les invariants du reliquaire, dont trois qui ne parlent pas de coutures mais
de matière : on ne traverse pas un bloc plein, on n'y reste pas **pris** — un point posé
en son centre doit ressortir, et ressortir dehors —, et la boucle boucle : une traversée,
**la même cellule** au bout, et une dizaine de mètres entre le seuil du coffre et la
sortie. S'y ajoute le rapport des volumes, qui est l'énoncé même de la tricherie : le
mesurer évite qu'on rapetisse un jour la salle sans s'en apercevoir, et que le musée se
mette à mentir un peu moins.

**Les points de vue**, capturés dans `shots/` : les dix situations qui trahissent
un portail mal fait — nez collé à l'ouverture, regard rasant, pile dans
l'embrasure, récursion, vue en biais, depuis l'autre pièce, tangage dans les deux
sens, à un cheveu et au micron de la couture, cube en vol.

Chaque capture est **mesurée**, et non seulement enregistrée : une image utile
n'est jamais un aplat, donc on exige un minimum de relief et de teintes
distinctes. C'est grossier, et c'est exactement ce qui manquait — les trois
premiers défauts trouvés au clavier laissaient tous les compteurs du moteur
intacts. La mesure porte sur le PNG enregistré plutôt que sur le canevas, ce qui
garantit qu'on mesure exactement l'image qu'on regarde ensuite ; un canevas WebGPU
ne se relit d'ailleurs pas avec `drawImage` hors de la boucle de rendu.
`scripts/png.mjs` est un décodeur minimal écrit pour l'occasion, sans dépendance.

S'y ajoutent deux contrôles nés d'un défaut que les mesures précédentes avaient
laissé passer : le tangage doit survivre au placement et à la traversée, et **deux
points de vue ne peuvent pas produire la même image**. Ce second contrôle est
trivial et il aurait suffi : les deux vues inclinées sortaient identiques au bit
près, et leurs statistiques identiques s'affichaient à l'écran sans que personne ne
les rapproche.

Chacun de ces contrôles a été **vu échouer** : les trois défauts ont été
réintroduits un par un pour vérifier que le test les attrape. Un contrôle de
régression qu'on n'a jamais vu échouer n'en est pas un — et il s'est trouvé qu'un
seul des trois se laissait prendre par la mesure d'image, d'où l'invariant sur la
caméra.

**L'éclairage traversant** demande une mesure prudente, et une première version s'est
fait piéger. Comparer la couleur du sol loin de la porte et près d'elle *semble*
mesurer la transmission — le sol se refroidit bien en approchant. Mais il se
refroidit surtout parce qu'on **voit** la salle froide à travers l'ouverture, et la
mesure restait identique avec la transmission débranchée. Le seul moyen honnête de
l'isoler est de comparer la même pose avec et sans, l'ouverture hors du champ : dos à
la porte, le regard au sol.

**L'arrêt sur le plan d'une couture** est l'état dégénéré du portail : l'œil pile
dans le plan d'une ouverture, sans avoir changé de cellule. L'ouverture y est vue par
la tranche, sa surface projetée est nulle, il ne reste qu'un aplat. On ne peut pas y
tomber par hasard dans un balayage au millimètre — c'est un événement de mesure
nulle, et il a fallu une coïncidence arithmétique pour le rencontrer une fois. On le
provoque donc : on demande au moteur la marge restante jusqu'au plan, et on marche
exactement cette distance moins un nanomètre. Le franchissement doit se déclencher
malgré tout, ce qu'assure un rapport entre deux constantes — on franchit dès qu'un
pas arrive à un dixième de millimètre du plan, alors que le découpage de la silhouette
n'écarte l'ouverture qu'en deçà d'un dix-millionième.

**Le balayage du franchissement.** Des poses fixes ne prouvent pas qu'une
transition est propre : ce qui gênait à l'œil, c'était le passage lui-même, une
bande grise de quelques millimètres trop brève pour être capturée par hasard et
assez longue pour être vue. On fait donc **marcher** le visiteur à travers la
porte, millimètre par millimètre, par le même code de déplacement que d'habitude,
et on mesure chaque position sous trois directions de regard. Le résultat n'est pas
un oui-non mais une largeur : sur quelle épaisseur, en millimètres, l'image se
dégrade-t-elle ? À la vitesse de marche une image couvre près de six centimètres,
donc tout ce qui reste sous le centimètre est invisible en pratique.

Téléporter l'œil de part et d'autre ne dirait rien, et c'est une erreur que ce test
a commise avant d'être corrigé : une position au-delà d'une couture mais rattachée
à la cellule de départ est un état que le moteur ne produit jamais, et le mesurer
fabrique de faux échecs.

`scripts/probe-sweep.mjs` est la version exhaustive, à lancer à la main quand
quelque chose résiste : elle fait tourner le regard sur trois cent soixante degrés
et trois inclinaisons à chaque millimètre, soit près de trois mille images, et
signale la pire. C'est elle qui a localisé la bande de quatre millimètres que les
trois directions du test permanent avaient laissée passer.

La comparaison au pixel avec des références viendra quand le rendu sera stabilisé,
sinon on passerait son temps à réviser des références.

## Ce qui n'est pas fait

Par ordre d'arrivée prévue :

- **Ombres** — une lampe éclaire à travers une cloison. C'est le manque le plus
  visible de l'éclairage actuel, et le prochain morceau sérieux.
- **Audio** — la spatialisation doit elle aussi traverser les coutures.
- **Le tunnel-vrille**, la gravité par face, les murs mobiles, l'espace pavé.
  Toute la géométrie tricheuse, qui est la raison d'être du projet.
- **Rust** — le moteur est en TypeScript. L'étape 1 était un problème de matrices
  et de passes GPU, et le pilotage de WebGPU vit de toute façon côté page :
  traverser la frontière WASM à chaque image n'aurait fait que ralentir la boucle
  d'itération, qui est exactement ce qui comptait ici. Le Rust reprendra la main
  sur la physique, les collisions et le précalcul des lightmaps, où il gagne sa
  place. Les modules sont isolés pour que ce soit sans douleur.

## L'atelier

Le dossier `tools/` est un atelier de mise au point, **non versionné** et
régénérable : des sondes qui servent à comprendre ce qui se passe quand quelque
chose résiste, pas au projet livré. Il contient son propre `README.md`.

En résumé de ce qui s'y trouve :

- `sheet.mjs` assemble tout un balayage en une seule planche de contact — une
  transition étalée sur quarante captures interdit la comparaison, et un accident
  d'une seule image y passe inaperçu ;
- `trace.mjs` relève position, regard, verticale locale, inclinaison et roulis pas à
  pas, pour les défauts qu'aucune image ne montre ;
- `ab.mjs` réintroduit un défaut connu, lance le test, et restaure — parce qu'un
  contrôle de non-régression qu'on n'a jamais vu échouer n'en est pas un. Le
  catalogue des défauts déjà rencontrés vit dans `tools/patches.mjs` ;
- `diff.mjs` dit *où* deux images diffèrent, là où le test de torture dit seulement
  *si*.

Les outils pilotent le crochet `window.__edifice` exposé par `src/main.ts`
(`state`, `seam`, `teleport`, `walk`, `face`, `setDepth`, `setChrome`, `selfTest`).
C'est la frontière prévue pour ça : quand une sonde a besoin de voir autre chose, on
ajoute une entrée plutôt que d'aller fouiller dans les modules.

Deux règles y sont apprises à mes dépens, et elles valent au-delà de l'atelier :
ne jamais écrire une coordonnée du monde en dur — le plan des coutures a déjà bougé
une fois et tous les repères figés se sont mis à mesurer autre chose sans rien
signaler ; et ne jamais téléporter à travers une couture, une position au-delà du
plan mais rattachée à la cellule de départ étant un état que le moteur ne produit
jamais.

## Organisation

```
src/math/      vecteurs, matrices, plan proche oblique
src/world/     cellules, coutures, géométrie, déplacement, éclairage, vrille
src/render/    initialisation WebGPU, rendu récursif des portails
src/player/    visiteur, objets lancés
src/dev/       auto-test des invariants
src/shaders/   scene.wgsl, portal.wgsl
scripts/       pilote CDP sans dépendance, décodeur PNG, test de torture
tools/         atelier de mise au point, non versionné (voir tools/README.md)
```
