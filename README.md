# Édifice — le musée impossible

Un musée dont l'architecture est physiquement impossible, et dont chaque salle est
une machine en état de marche : chacun de mes projets y tourne pour de vrai, et
c'est en le faisant fonctionner qu'on avance dans le bâtiment.

Le plan de travail complet — les six moments signature, les onze machines, les
lots et leurs portes de sortie — vit dans `PLAN.md`, à la racine du dossier du
portfolio. Ce dépôt-ci contient le moteur.

**État : le premier moment signature tourne.** Une rotonde à huit portes, des portails
qu'on n'arrive pas à prendre en défaut, un éclairage qui franchit les ouvertures, le
saut et la chute. Puis quatre tricheries géométriques : le **tunnel-vrille**, dont la
section pivote d'un quart de tour, gravité comprise ; le **volume impossible**, un coffre
de deux mètres cinquante qui contient la salle de douze où il est posé ; la **gravité par
face**, un cube dont les six parois sont des sols ; l'**escalier de Penrose**, deux étages
qu'on monte indéfiniment sans jamais passer de l'un à l'autre — il faut descendre pour cela ;
et l'**espace pavé**, une salle sans bord où l'on voit s'étendre le damier de ses propres
copies. Deux ailes attendent encore leur mécanique. Sous l'escalier, une crypte de pierre
ouvre sur **quatre cabinets** qui ne démontrent rien : ils sont là pour la matière et la
lumière.

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
**ailes** — une par tricherie géométrique : le tunnel-vrille, le reliquaire, la gravité par
face, l'escalier de Penrose et l'espace pavé, qui tournent ; les murs mobiles et la
perspective forcée, qui attendent. Les deux dernières sont vides, et c'est voulu : on les
remplira une par une, chacune avec son propre problème. S'y ajoute la **salle basse**, où
l'escalier descend, et qui n'a pas de porte sur la rotonde.

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

**Le brouillard a la couleur de la salle.** Il ne sert pas qu'à l'ambiance : c'est lui qui
rend invisible la coupure de récursion, et il ne peut le faire que si le fond d'une salle et
son lointain sont de la même matière. Un gris unique pour tout le musée faisait de chaque
horizon un mur d'une autre couleur que la pièce qu'il terminait — ce qui se remarque surtout
au bout d'une enfilade, là où il n'y a plus rien d'autre à regarder. Chaque cellule porte donc
sa propre teinte de lointain, dérivée de sa température de lumière, et le fond d'écran de sa
passe est effacé avec.

Sa chute est en **exponentielle carrée** et non simple. L'exponentielle simple part de zéro
avec une pente immédiate : tout s'estompe un peu dès le premier mètre, et l'image entière
prend un voile. Son carré démarre à plat, donc ce qui est proche reste franc, puis se referme
d'un coup — c'est ce qui fait un horizon plutôt qu'un voile. S'y ajoute une **brume basse**,
une demi-densité de plus au ras du sol et une demi-densité de moins au plafond : une salle a
un sol, l'air y est plus épais, et la profondeur se lit dans l'image sans qu'on ait rien
ajouté à la géométrie.

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

**La collision et la couture jugent sur le même critère**, et il a fallu le leur imposer.
La collision demandait que le corps entier tienne dans l'ouverture — sa largeur moins un
rayon, ses pieds sur le seuil, sa tête sous le linteau —, la traversée ne regardait que le
point de référence. Là où les deux se contredisent, c'est-à-dire dans l'embrasure, la
traversée gagnait : la paroi arrêtait le corps et la couture l'emportait quand même de
l'autre côté. Sauter vers une porte trop basse, ou frôler un jambage, téléportait au lieu de
cogner. La traversée applique donc désormais la même mesure — dans le repère de la bouche, et
non celui du monde, puisqu'au bout du tunnel-vrille le haut du corps n'est plus la verticale.

Un cube lancé, lui, n'a pas de corps : il passe par où son centre passe, ce qui lui va, étant
plus petit que toutes les ouvertures.

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

**Et une surface de trop, qui grésillait.** Une embrasure porte quatre jambages : deux
montants, un linteau, un seuil. Celle d'une paroi est creusée dans son épaisseur, donc
hors de l'emprise du sol, et sa dalle de seuil est la seule surface à cet endroit. Celle
d'un coffre est en plein milieu de la salle — et le sol passe dessous. Les deux dalles se
retrouvaient rigoureusement coplanaires, de deux teintes différentes, et se départageaient
au dernier bit de la profondeur interpolée : une bande qui grésille au ras de la porte dès
que la caméra bouge.

Le coffre ne dessine donc pas de seuil. Le sol de la salle est déjà là, au même endroit, et
il traverse l'embrasure sans rupture.

Ce défaut avait été trouvé à l'œil, et c'est trop tard : il est de ceux qu'on ne relie pas
à leur cause — on croit à un problème de rendu et on cherche du mauvais côté pendant des
heures. Le test de torture inspecte donc désormais **toute** la géométrie du monde à la
recherche de deux surfaces qui partagent un plan et des pixels. Il n'y en a plus aucune.

**Une couture qui relie une salle à elle-même ne l'éclaire pas.** Celle-ci en a deux, et
elles rayonnaient chez elles : la radiance d'une bouche sert à faire entrer l'éclairage de la
pièce d'en face, mais quand cette pièce est la même, il est déjà compté par ses propres
lampes. On voyait donc une bande plus claire en travers de chacun des deux seuils, que rien
dans le dessin n'expliquait — le genre de défaut qu'on prend pour un problème de texture. La
règle valait déjà pour les raccords de l'escalier de Penrose, où elle était écrite à la main ;
elle vaut maintenant pour toute couture, et un invariant la garde.

Enfin, le point de vue du test est pris **de trois quarts, et de loin**. De face et de
près, le coffre remplit le champ et redevient ce qu'il n'est pas : une porte dans un mur.
Il faut voir deux de ses faces, ses arêtes contre la salle, et par l'ouverture cette même
salle vue du fond. Un volume impossible qu'il faut expliquer est un volume raté.

### La gravité par face

Un cube de dix mètres dont **chaque paroi est un sol**. On y entre debout, on marche vers
un mur, et à une hauteur d'homme de lui la gravité bascule : le mur devient le sol, la
salle pivote d'un quart de tour autour de soi, et l'on continue à marcher. De proche en
proche, les six faces sont habitables, plafond compris — en tenant la touche d'avance, on
fait le tour du cube et l'on revient à son point de départ.

**La bande d'accroche fait exactement une hauteur d'œil**, et c'est le réglage qui décide
de tout. Au moment où l'on arrive à cette distance de la face voisine, on est déjà
précisément à la distance où l'on se tiendra debout **sur** elle. Le basculement n'a donc
rien à déplacer : il ne fait que tourner un repère. Déclencher plus tôt ou plus tard
obligerait à déplacer le corps d'autant, et cet à-coup passerait pour un défaut de rendu.
La bordure claire peinte le long de chaque arête marque cette bande : la règle et son
signe sont la même chose, ce qui évite d'avoir à l'expliquer.

**On bascule en l'air aussi.** La règle a d'abord voulu qu'on ait les pieds au sol :
sauter contre une paroi ne faisait donc rien, et la bascule survenait à la retombée, une
seconde plus tard, sans qu'on puisse la relier au geste. C'était le plus déroutant des deux
comportements possibles. Rien ne s'y opposait d'ailleurs : le déclenchement se fait à une
hauteur d'œil de la face, c'est-à-dire là où le corps se tiendra debout dessus, donc sans
déplacement, en l'air comme au sol. Reste la seule condition qui compte — marcher franchement
vers la face. On s'accroche à un mur, on ne s'y accroche pas en passant.

**Le visiteur porte deux verticales.** Celle qu'il *subit* — la face sur laquelle il se
tient, crantée sur un axe — commande la gravité et la collision, et change d'un coup.
Celle qu'il *voit* la rejoint en tournant, à cinq radians par seconde. Les confondre
donnerait, au choix, une caméra qui saute d'un quart de tour ou une gravité qui tire en
biais pendant la rotation et fait glisser le corps dans l'angle. Le regard tourne du même
angle que le haut, exactement comme dans le tunnel-vrille et pour la même raison :
transporter l'un sans l'autre ferait piquer l'image du nez à chaque changement de face.

**La porte ne s'ouvre que pour qui se tient d'aplomb.** Une couture est une transformation
rigide : elle emporte le repère tel quel, si bien que sortir en marchant sur un mur ferait
arriver dans la rotonde couché sur le côté, avec une gravité horizontale et rien sous les
pieds. Refuser est la seule réponse honnête — et la salle s'en charge elle-même, sans rien
interdire : sa porte est au ras d'une arête, donc dans la bande d'accroche. Qui s'en
approche en marchant sur un mur bascule sur le sol du bas et se retrouve debout devant
elle.

**Un défaut trouvé en chemin, et il était fatal.** La bande d'accroche faisait grimper le
mur juste avant qu'on atteigne la porte : la salle n'avait plus de sortie du tout, on
tournait indéfiniment autour du cube. D'où la clause qui manquait — **on ne bascule pas
devant une ouverture, on entre** — et l'invariant qui va avec : la salle doit avoir une
sortie, vérifiée en marchant.

Deux détails de mise en scène. Les **six faces sont de six teintes** : un cube uni tourné
d'un quart de tour se superpose à lui-même, et sans elles on ne saurait plus sur laquelle
on se tient ni d'où l'on vient — le même problème que la section du tunnel-vrille. Et la
**lampe est au centre géométrique**, seule position qui ne désigne aucune face comme le
bas ; une lampe au plafond dirait où est le haut avant qu'on ait fait un pas, et le dirait
encore, à tort, quand on se tiendrait dessus.

Les objets suivent la même règle sans code de plus : **un cube lancé tombe vers la paroi
dont il est le plus près**. N'ayant pas de tête, il n'a pas de face choisie — et les objets
s'accumulent donc sur les six faces.

### L'escalier de Penrose

Un ruban de marches qui tourne autour d'un pilier plein, et qu'on **monte indéfiniment**.
On entre de plain-pied sur un palier d'angle, on monte, on passe derrière le pilier — et
l'on retrouve sa propre porte d'entrée, à la hauteur exacte où on l'a quittée. On peut
recommencer autant qu'on veut.

**Et si l'on descend, on tombe sur une autre porte**, qui donne sur une salle qu'on ne
soupçonnait pas. On y entre, on ressort — et là, si l'on monte, l'escalier boucle de nouveau,
mais sur *cette* porte-là : la première a disparu. Pour la retrouver, il faut redescendre.

Il y a donc deux escaliers, tous deux sans fin, et l'on ne passe de l'un à l'autre qu'en
descendant. **Monter est une boucle, descendre est le seul chemin.**

Le tour de passe-passe tient en une phrase : **la hauteur ne dépend que de l'angle autour
du pilier**. Un tour complet fait donc gagner exactement douze mètres, et une couture posée
au raccord translate de cette hauteur.

La volée dessinée fait deux tours et quart, et porte **deux étages identiques** : l'étage
haut, avec la porte de la rotonde en son milieu ; l'étage bas, avec celle de la salle basse.
Trois coutures les relient, et **aucune des trois n'a de jumelle** — on les franchit dans un
sens et pas dans l'autre. Deux referment une boucle en montant, une par étage : c'est ce qui
fait qu'en montant on ne rencontre jamais que la porte de son propre étage. La troisième se
franchit en descendant, tout en bas, et repose trois quarts de tour au-dessus : c'est elle
qui fait que descendre change d'étage au lieu de s'arrêter.

**Les deux étages sont décalés d'un quart de tour**, et ce n'était pas prévu. Posés bout à
bout, l'un finissant exactement où l'autre commence, la boucle haute reposait le grimpeur sur
le plan même de la boucle basse, et dans le sens où celle-ci se franchit : arrivé là, on la
traversait dans la foulée et l'on se retrouvait un étage plus bas au bout d'un seul tour.
**Deux coutures ne peuvent pas partager un plan si l'une y dépose dans la direction que
l'autre attend.** Le quart de tour règle du même coup ce qui se voit : entre le pied de
l'étage haut et la porte de la salle basse il y a désormais deux angles de pilier, et le
regard n'en franchit qu'un.

Ce décalage a lui-même une contrainte : la couture du bas retombe **trois quarts de tour**
au-dessus, et non au sommet. Deux tours pleins séparent ainsi ses deux bouches, donc le même
angle du pilier des deux côtés, donc une **pure translation**. Au sommet, il aurait fallu
tourner de quatre-vingt-dix degrés — l'escalier est bien invariant par quart de tour et
l'illusion aurait tenu, mais une rotation à trois cents mètres de l'origine ne se calcule
plus exactement en flottant 32 bits. On retombe donc juste au-dessus de la porte de la
rotonde, ce qui est d'ailleurs le bon endroit : en descendant, c'est elle qu'on cherche.

**Cette couture est posée sur un palier**, et c'est ce qui la rend imperceptible. Tant
qu'elle tombait en pleine volée, il fallait faire coïncider deux nez de marche au
centimètre : la géométrie, la rampe de collision et l'éclairage devaient s'accorder au même
endroit, et le moindre écart de l'un des trois s'y voyait. Sur un palier, il n'y a ni marche
ni contremarche à raccorder — les deux côtés montrent le même sol horizontal, à la même
hauteur d'œil, sous le même plafond. Il ne reste rien à faire coïncider.

Le pilier n'est pas un ornement : c'est lui qui empêche d'embrasser la volée du regard. Le
dessin de Penrose, lui, est un carré vide, et il ne tient que d'un seul point de vue.

**Le plafond suit les marches**, et c'est le point qui a coûté le plus à comprendre. Avec
un plafond plat, on le sent se rapprocher à mesure qu'on monte, puis s'écarter d'un tour
d'un seul coup au raccord : la couture ne se voit pas dans la géométrie, mais elle
**s'entend dans le volume**, et c'est aussi net qu'un décrochement. En faisant du plafond
un second ruban à trois mètres au-dessus du premier, le couloir a partout la même
section — et la bouche du raccord la couvre alors **entièrement**. Il n'y a plus rien à
cacher.

**Un palier à chaque angle du pilier, et nulle part ailleurs.** On tourne sur du plat, comme
dans un escalier réel, mais surtout : le sol d'un escalier tournant n'est de niveau que le
long d'un rayon, or une porte est percée dans une paroi, donc en travers. Sans palier, le sol
monterait de près d'un mètre sur la largeur de l'ouverture et l'on entrerait par le biais.
Toutes les ouvertures de l'escalier — les deux portes et le raccord — sont donc à un coin.

Quatre paliers, un par angle, et pas un de plus. Il y en a eu un cinquième, glissé en pleine
volée pour y loger une porte : on voyait aussitôt des marches d'un côté et un plat de
l'autre, et la volée cessait d'être régulière. Un escalier a le droit de souffler, mais pas
une fois sur deux et d'un seul côté.

Attention enfin : **un palier n'est pas plat sur toute sa longueur**. La rampe de collision
est centrée sur les marches, elle monte donc déjà sur la dernière du palier. Une porte dont
le seuil tombe là est **infranchissable**, et pour une raison qu'aucune image ne montre : les
pieds passent quelques centimètres sous le seuil, la collision juge que le corps ne tient pas
dans l'ouverture, et le mur le repousse — on se cogne à une porte grande ouverte. Le défaut
est né deux fois, à deux endroits différents, avant de devenir un invariant qui mesure le
dénivelé du sol sur la largeur de chaque ouverture et le veut rigoureusement nul.

**Monter et descendre ne mènent pas au même endroit**, et c'est là que l'escalier devient
impossible. Aucune des trois coutures n'a de jumelle : le recollement est *orienté*, ce
qu'aucun espace ordinaire ne permet. En montant, la boucle de l'étage vous repose toujours
sous vous-même ; en descendant, elle n'existe pas, et l'on traverse jusqu'à l'étage suivant.

**Celui qui monte ne voit jamais la porte de l'autre étage.** Ce n'est pas une affaire de
cadrage mais de structure : la boucle ne quitte pas son étage, donc la porte d'en face n'est
tout simplement pas dans l'espace parcouru. Tant que les deux étages ont été bout à bout, il
restait quelques images, au bas de la montée, où l'on apercevait en contrebas la salle basse
s'ouvrir — et cela suffisait à tout dire. C'est ce qu'a réglé le quart de tour de décalage.

**La porte de la salle basse s'ouvre dans une paroi**, comme celle de l'entrée. Elle a
d'abord été percée dans le mur qui fermait le bas de la volée, en travers du couloir : on
tombait dessus sans transition, avec du vide autour d'elle et rien pour l'annoncer. Dans une
paroi latérale, elle a ses deux jambages, son linteau et son embrasure.

Ce mur du bas a disparu avec elle, et c'est un bon débarras : la volée n'a plus de bout à
fermer, ses deux extrémités étant des coutures. Il était posé en **diagonale**, radialement,
alors que sa boîte de collision était alignée sur les axes — elle le débordait donc largement,
et posait un mur invisible en travers du palier voisin. Une géométrie oblique et une collision
alignée ne font pas bon ménage ; le plus sûr est de n'avoir pas de mur du tout.

Six détails de fabrication méritent d'être notés.

**Une porte et son trou sont décrits séparément**, et rien ne les tenait ensemble. La bouche
vient de la couture, le trou du découpage de la paroi. Le jour où la porte de l'escalier a
déménagé sur un palier d'angle, la bouche a suivi et pas le trou : l'aile déclarait toujours
le milieu de sa paroi nord. Le résultat n'a rien qui ressemble à une erreur — on entre
normalement, puisque la collision connaît la bouche et laisse passer, mais **une fois dedans
il n'y a plus de porte**, rien qu'un mur plein là où l'on vient d'entrer. Un invariant vérifie
désormais qu'au centre de chaque porte, dans le plan de sa paroi, il n'y a aucune surface.

**Les lampes sont périodiques d'un tour exactement**, une par quart de tour. À travers une
couture on voit la volée d'en face éclairée par les lampes d'en face, alors qu'on est éclairé
par les siennes : si les deux séries ne se correspondent pas, la couture se signale par un
changement de lumière, et aucune correction de géométrie ne le rattrape. Une couture invisible
ne l'est qu'à condition que tout soit périodique — la forme, le volume **et** l'éclairage.

Deux tours et quart en demandent onze, là où le nuanceur en acceptait six. Le plafond est
passé à douze, et le dépassement était **silencieux** : les lampes en trop étaient coupées
sans rien dire, ce qui donne une salle mal éclairée sans cause visible. Il a lui aussi son
invariant. Ce plafond-là coûte de la place dans le bloc uniforme et non du calcul par pixel,
la boucle du nuanceur s'arrêtant au nombre de lampes réellement déclarées.

La collision ne suit pas les marches mais une **rampe** qui passe en leur milieu. Un sol en
escalier ferait monter le corps par bonds à chaque nez franchi ; la rampe le fait monter
continûment, au prix d'un flottement d'une demi-marche que personne ne peut voir, faute de
voir ses pieds. Sur un palier, rampe et marche coïncident — raison de plus d'y poser les
ouvertures : c'est le seul endroit où les deux descriptions du sol se rejoignent.

Une couture qui ne fait que **translater** est écrite comme telle, et non composée à partir
des deux repères. Les matrices sont en flottants 32 bits ; à trois cents mètres de l'origine,
une bouche posée en diagonale traîne des facteurs en racine de deux dans chaque terme, et la
composition rendait une translation fausse de vingt microns. C'est invisible, et indéfendable
tout de même : l'escalier se franchit des centaines de fois et l'erreur s'accumule à chaque
tour. Écrite directement, la translation est exacte quel que soit l'angle de la bouche.

Les contremarches du plafond sont dessinées **des deux côtés**. Celle du sol n'est jamais vue
que d'en dessous, le nez de la marche la masquant par-dessus ; celle du plafond est exposée
dans les deux sens — de face en montant, de dos en se retournant. Sans son revers, on
regardait entre les marches du plafond et l'on apercevait le mur au travers : le plafond
semblait fait de dalles flottantes.

Enfin, deux volées occupent le même secteur angulaire à des hauteurs différentes, un étage
par volée. La collision doit donc savoir **sur laquelle on se tient** : elles sont séparées
de douze mètres pour un corps qui en fait deux, et l'on croyait le choix jamais douteux.

Il l'était pour ce qui n'a pas la taille d'un visiteur. La volée se lisait sur le repère du
corps en le supposant haut — un œil est à un mètre soixante-cinq de son sol. Le centre d'un
cube posé n'est qu'à dix-sept centimètres du sien : il était rangé sur la volée d'en dessous
et **tombait de douze mètres à travers un sol** sur lequel un visiteur, au même endroit,
tenait debout. La tolérance se compte donc désormais vers le bas, où elle absorbe
l'enfoncement d'un pas, et non vers le haut, où elle exigeait une taille. L'invariant éprouve
les deux corps au même endroit — c'est la question qu'il fallait poser : le sol ne doit pas
dépendre de la taille de qui s'y pose.

### L'espace pavé

Une salle de dix mètres dont les parois opposées sont cousues deux à deux : le nord donne
sur le sud, l'est sur l'ouest. On y marche tout droit et l'on revient à son point de départ
sans avoir tourné et sans avoir rien franchi de visible. **La salle est un tore, et un tore
n'a pas de bord.**

Ce n'est pas le tunnel qui reboucle : ici, on *voit* la répétition. Un damier d'édicules
identiques s'étend dans les quatre directions jusqu'à ce que le brouillard s'en mêle, et
chacun est celui devant lequel on se tient.

**Ses parois ne sont pas percées : elles sont l'ouverture.** Une couture y occupe le mur
entier, du sol au plafond et d'un angle à l'autre. Il n'y a donc aucune paroi à dessiner, et
pas d'embrasure non plus — une embrasure suppose une épaisseur, et il n'y a rien à traverser.
La porte de sortie est alors au milieu de la salle, dans un édicule : il n'y a plus de mur où
la percer. C'est la mécanique du coffre du reliquaire, réemployée telle quelle.

**On ne dessine pas les copies avec des portails.** C'était le premier réflexe — une paroi
est une couture, une couture se rend par une passe — et c'était le mauvais. Chaque copie
coûtait une cible plein écran, le budget de passes s'épuisait au bout de trois longueurs, et
le couloir se terminait sur un aplat gris qui ruinait tout.

Il y a bien plus simple, et c'est ce que fait *Manifold Garden* : la transformation d'une
copie à l'autre étant une **pure translation**, on dessine tout bêtement la même géométrie
plusieurs fois, décalée du pas du réseau. Vingt quadrilatères quatre-vingt-une fois coûtent
moins qu'une seule passe de portail. Le couloir de copies s'enfonce alors jusqu'à l'horizon,
sans coupure d'aucune sorte — mesuré : **une passe de rendu au lieu de vingt-quatre**.

Les coutures restent, mais pour le déplacement seulement. Elles ramènent le visiteur dans la
copie centrale dès qu'il en sort, ce qui garde ses coordonnées bornées et les erreurs
d'arrondi avec elles. La salle est donc décrite **deux fois** — par ses coutures, qui disent
où le corps se retrouve, et par son réseau, qui dit où l'on dessine. Rien n'oblige les deux à
s'accorder, et s'ils divergent le musée devient un mensonge : on voit une salle à dix mètres,
on y marche, et l'on arrive ailleurs. D'où l'invariant qui exige de chaque couture qu'elle
soit exactement une translation d'un pas du réseau.

**Chaque copie a sa porte, et chaque porte donne sur la rotonde.** Ne rendre que celle de la
copie centrale laissait toutes les autres en trou noir : on s'approchait, la rotonde
apparaissait dans l'encadrement, et l'illusion tombait — la copie où l'on se tient cessait
d'être une copie comme les autres. Les ouvertures des copies sont donc des portails de plein
droit, et leur caméra virtuelle se déduit de la même transformation reculée d'un pas du
réseau : ce qu'on voit par la porte d'une copie décalée de *s*, c'est ce qu'on verrait par la
porte centrale depuis un point reculé de *s*.

Cela a demandé de reprendre la façon dont le budget de passes se dépense. **Il se partage, il
ne se dispute pas.** Chaque ouverture s'enfonçait jusqu'à épuisement du budget, si bien que la
première traitée le vidait pour ses sœurs : deux portes montrant la rotonde et dix-huit trous
noirs. Chaque enfant reçoit maintenant une part de ce qui reste — grosse là où il y a peu
d'ouvertures, donc la récursion s'enfonce ; petite là où il y en a vingt, donc chacune a droit
à son image, et c'est tout ce qu'on lui demande.

Et une ouverture qu'on renonce à dessiner ne prend plus la couleur du brouillard mais celle de
ce qu'il y a derrière, noyée dans le brouillard selon sa distance. Le gris creusait un trou là
où il devait y avoir une lueur.

Trois détails que la répétition impose.

**L'éclairage se calcule dans la copie de référence.** Les lampes sont posées en coordonnées
du monde ; une copie décalée de dix mètres serait donc éclairée par les lampes de la copie
centrale, c'est-à-dire de travers, et s'assombrirait en s'éloignant. Le nuanceur ramène donc
la position du fragment dans la copie de référence avant d'éclairer — une soustraction, et la
répétition redevient exacte.

**Les objets se répètent avec la salle.** Un cube lancé apparaît dans les copies voisines,
jusqu'à dix-huit mètres — au-delà, il ne pèse plus rien à l'écran. Ne pas le faire se voyait
aussitôt : une salle qui se répète dont les objets ne se répètent pas désigne du doigt laquelle
des copies est la vraie.

**Les quatre angles étaient des pièges.** Le corps s'arrête à un rayon d'une paroi ; pour
franchir l'une des deux ouvertures qui se rencontrent dans un angle, il devait tenir dans
l'autre, ce qu'il ne fait pas d'un demi-rayon. On restait **coincé dans le coin d'une salle
qui n'a pas de coin** — et rien, à l'écran, ne se trouve à cet endroit pour l'expliquer. La
règle qui manquait : une bouche qui couvre toute sa paroi n'a pas de paroi autour d'elle,
donc rien à rater, donc aucun test d'encombrement à passer.

### La physique, en Rust

Les objets lancés sont simulés par un module **Rust compilé vers WebAssembly**, dans
`physique/`. C'est le premier morceau du moteur à quitter TypeScript, et le choix de
celui-là n'est pas un hasard : la physique est le seul endroit dont le coût dépend du
**nombre d'objets** plutôt que du nombre de pixels. Tout le reste — le pilotage de WebGPU,
la construction du monde, le déplacement du visiteur — vit très bien côté page, et franchir
la frontière à chaque image ne ferait que ralentir la boucle d'itération, qui est exactement
ce qui compte pendant qu'on cherche.

**L'interface est purement numérique.** Pas de `wasm-bindgen`, pas d'objets, pas de chaînes :
le monde et les corps sont des `Float32Array` posés dans la mémoire du module. Ce n'est pas
une coquetterie — ce qui coûte à la frontière se paie soixante fois par seconde — et cela
rend le module chargeable d'un `WebAssembly.instantiate`, donc sans outil intermédiaire :
`cargo build` suffit, et le `.wasm` est versionné pour que `npm run dev` marche sans avoir
Rust installé. La contrepartie est que le format d'échange est décrit à deux endroits, un de
chaque côté, et que les deux doivent se croire sur parole. C'est le seul endroit du projet
où c'est le cas, et il est documenté des deux côtés.

Ce que le noyau a apporté n'est pas de la vitesse mais du **comportement**. L'ancienne
version faisait tourner les cubes à vitesse constante autour d'un axe tiré au hasard et les
arrêtait net en touchant le sol. Un cube est maintenant un solide : il a une inertie, ses
huit coins sont testés séparément, il rebondit sur une arête, il bascule, il frotte, il se
pose à plat, et il se cogne aux autres. Le tenseur d'inertie d'un cube étant **isotrope**,
son inverse se réduit à un scalaire — c'est ce qui rend un solveur à impulsions aussi court
ici qu'un long chapitre ailleurs.

Le noyau connaît les quatre formes de sol du musée : plat, six faces, rampe d'escalier
tournant, tube vrillé. Les quatre, et pas trois : en laisser une de côté aurait obligé à
faire cohabiter deux moteurs de physique et à décider, pour chaque cube et à chaque image,
lequel des deux a raison.

**Un cube ne s'endort que s'il est porté.** Un solide au repos garde toujours un peu de
vitesse — les impulsions ne s'annulent jamais exactement — et ce reste se voit comme un
frisson ; on l'endort donc au bout d'un tiers de seconde de calme. Mais « au repos » ne veut
pas dire « qui touche quelque chose » : un cube ralenti qui frôle une paroi verticale n'est
pas posé, et le confondre avec un cube posé le fige **en l'air**, contre le mur. Le contact
ne compte que si sa normale s'oppose à la chute. Le défaut s'est vu du premier coup, dans le
tunnel-vrille, où trois cubes flottaient à mi-hauteur.

### Les matières

Jusqu'ici le musée était fait d'aplats et d'un quadrillage d'un mètre — un outil de mise au
point, pas un décor. Il a maintenant des **matières** : marbre, parquet, moquette, lambris de
galerie, pierre de taille, plafond à caissons, béton banché, tôle rivetée, plâtre.

Les recettes sont **reprises de l'ancien moteur du portfolio**, qui les calculait pixel par
pixel sur le processeur et les rangeait dans des tuiles. Ici elles se calculent par fragment
sur la carte : mêmes proportions, mêmes formules, mais sans image en mémoire, sans
pixellisation de près, et **sans répétition visible** — les coordonnées étant continues, un
mur de vingt mètres ne répète pas une tuile, il déroule un motif.

Trois principes hérités, et ce sont eux qui font la différence entre une matière et un aplat
teinté. **Un grain fin partout** : sans lui, une surface plane a l'air d'une image de synthèse
de 1995 ; il s'efface avec la distance, faute de quoi il grésillerait, n'ayant pas de mip-map
pour le porter. **Une variation par élément** : chaque bloc de pierre, chaque lame de parquet
a son ton propre, tiré d'un haché de sa position, et c'est ce qui casse la régularité. **Des
joints creux, et une arête éclairée juste dessous** : un joint seul fait un dessin, un joint
plus son arête fait un relief.

Deux écarts assumés avec l'original. Le veinage du marbre vient toujours d'une sinusoïde
déformée par de la turbulence — là où elle passe par zéro, on trace une veine, et deux
familles se superposent — mais la veine est une **couleur**, pas un éclaircissement : une
première version les faisait briller, et le sol ressemblait à des éclairs peints. Et les
hauteurs du mur de galerie sont en **mètres réels** au lieu de fractions de la paroi : une
cimaise est à deux mètres vingt du sol dans une salle de quatre mètres comme dans une salle de
sept, alors que la faire monter avec le plafond donnait un lambris de deux mètres de haut.

Les coordonnées sont **en mètres**, ce qui permet de raisonner en tailles réelles : une dalle
de marbre fait un mètre, une lame de parquet douze centimètres, une planche de coffrage
vingt-cinq. Une cimaise tombe donc toujours à quatre-vingt-dix centimètres du sol, quelle que
soit la salle où on la pose, sans réglage.

Le numéro de matière voyage **avec la couleur**, en quatrième composante. Ce n'est pas la
solution la plus pure — mais la couleur traverse une trentaine de fonctions de construction,
et lui faire de la place partout aurait coûté un fichier de modifications sans rien apporter.
Une matière *est* un aspect de surface ; qu'elle voyage avec la teinte de cette surface se
défend.

**Les dérivées d'écran se prennent en tête de nuanceur, jamais dans une matière.** Une
rainure s'adoucit à la largeur d'un pixel, ce qui demande `fwidth` — et WGSL interdit les
dérivées sous une condition qui n'est pas uniforme, ce que sont toutes les conditions de ce
fichier. Le nuanceur refusait de compiler et l'écran restait **entièrement noir**, sans autre
message que dans la console. On les calcule donc une fois, là où le flot est uniforme, et on
les fait descendre en paramètre.

**Chaque salle porte l'allure de ce qu'elle est.** Une allure n'est pas un thème plaqué mais
un accord de trois matières — sol, plafond, parois — choisi pour tenir ensemble : la rotonde
est un hall de pierre et de marbre, l'escalier est taillé dans la masse, le tunnel-vrille a de
la moquette, le cube aux six sols est en béton, la crypte est une crypte. Deux règles sont
sorties de l'exercice :

- **une salle qui tourne ne supporte pas de motif directionnel.** Dans le tunnel-vrille, les
  coordonnées de surface suivent le tube : une pierre appareillée y dessinerait des assises en
  spirale. Il lui faut de la moquette et du plâtre, qui n'ont pas de sens de lecture. Même
  chose pour le cube aux six sols, dont un motif orienté se lirait de travers dès qu'on
  bascule ;
- **une salle qui démontre quelque chose doit rester sobre.** L'escalier de Penrose, le cube
  et la salle pavée sont là pour une tricherie de géométrie ; leur donner une matière riche
  reviendrait à disputer l'attention à ce qu'ils ont à montrer.

### La planche d'essais

Toutes les matières et tout le mobilier sont réunis dans la salle basse, en douze petites
scènes **en L**, alignées en trois rangées de quatre et numérotées.

Un L, c'est deux parois qui se rencontrent : le minimum pour qu'un sol, un mur et un objet se
regardent ensemble. Moins, on juge un échantillon ; plus, on juge une salle et l'on ne sait
plus ce qu'on juge. Toutes s'ouvrent du même côté et sont posées au cordeau, parce que ce
qu'on compare doit différer par **une** chose à la fois — une planche d'essais mal rangée
mesure surtout la fantaisie de qui l'a rangée. Et la crypte s'éclaire à plat, d'une lampe par
rangée : une source unique en aurait éclairé trois et laissé neuf dans l'ombre, et l'on aurait
jugé l'éclairage au lieu de la matière.

Le numéro est là pour qu'on puisse en parler. « Le troisième en partant de la gauche » se
trompe une fois sur deux ; « le sept » ne se trompe jamais. Il a fallu pour cela une police :
le musée n'en avait aucune, ni fichier, ni atlas, ni rendu de glyphes. Trois colonnes sur cinq
lignes suffisent à dix chiffres, chaque case allumée devenant un quadrilatère — la plus petite
police lisible, et elle a l'avantage d'avoir l'air de ce qu'elle est, une inscription
d'atelier plutôt qu'une enseigne.

Le mobilier disponible : un cordon de séparation, un banc, une plante en pot, une colonne, une
applique, une suspension, un cadre avec sa toile. Et la palette est celle de l'ancien
portfolio, reprise telle quelle — crème, pierre claire, vert de galerie, bleu de nuit, rouge
sourd, taupe, marbre clair et sombre, chêne, tapis rouge et vert. Ses salles n'étaient pas
toutes crème, et c'est ce qui faisait qu'on savait toujours où l'on était sans avoir à lire un
panneau : une pièce se reconnaissait à sa couleur avant sa forme.

**Un lambris reste du bois sur un mur vert.** Le nuanceur ne reçoit qu'une couleur par
surface, et la première version en tirait le ton du lambris — ce qui donnait un lambris vert
dans une salle verte. Il garde donc une teinte de chêne fixe, seulement mise au diapason de la
clarté de la pièce : un salon sombre a un lambris sombre, mais il reste brun.

**Un motif plus fin qu'un pixel ne s'y moyenne pas : il y saute.** Une image fixe le cache ;
dès que la caméra bouge, la surface fourmille. C'est le grésillement qu'on attribue au rendu
et qui vient de ce qu'on demande à une texture procédurale ce qu'un mip-map ferait pour une
image — rendre gris ce qui est trop petit pour être vu. On le fait donc à la main : chaque
détail fin déclare sa **taille en mètres**, et s'efface quand le pixel l'atteint. Le reste —
joints, blocs, grandes veines — n'en a pas besoin, étant plus grand qu'un pixel jusqu'aux
distances où le brouillard s'en charge.

Le corollaire est qu'il faut une matière **unie**, sans motif ni quadrillage. Ce n'est pas un
aveu de paresse : c'est ce qu'il faut aux petits objets — un chiffre de sept centimètres, une
plaque, une toile de tableau — dont le moindre détail est plus petit qu'un pixel dès qu'on
recule d'un pas.

**Un cylindre n'a qu'une peau.** Vu de dessus, un pot dont la bouche n'est pas bouchée laisse
voir à travers lui : le tri des faces arrière supprime sa paroi opposée, et il ne reste qu'un
trou. Ce qui doit être fermé l'est donc par un disque — et un disque en éventail a son propre
piège, celui qui a coûté le plus de temps : **le quatrième coin d'un quadrilatère ne peut pas
être son centre.** La normale se calcule sur deux arêtes ; si la première et la dernière sont
le même point, elle vaut zéro. La surface existe, sa lumière est absurde, et le tri des faces
ne sait plus de quel côté elle regarde. Le couvercle du pot était bien là, et invisible.

**Les lampes éclairent.** Une applique dessinée n'est qu'un objet peint sur un mur : chaque
luminaire des scènes déclare donc son foyer, et la salle le porte parmi ses sources. Leur verre
échappe en outre à l'éclairage — une lampe **émet**, et la multiplier par la lumière de la
pièce ferait une ampoule sombre dans une pièce sombre.

**Le musée, lui, reste nu.** Les matières ne sont pas encore distribuées : on essaie d'abord,
on range ensuite, et une salle habillée trop tôt fige un choix qu'on n'a pas fait.

**Une marche basse se monte.** Sans cette règle, tout ce qui traîne au sol est un mur : une
estrade de six centimètres arrête net, un socle de banc aussi, et le corps qui longe un tel
bord se fait repousser d'un côté puis de l'autre à chaque image. La caméra tremble, et l'on
croit que le sol bouge — un défaut de collision qu'on attribue au rendu, parce qu'il se *voit*
dans l'image. Quarante centimètres s'enjambent donc sans y penser ; au-delà, un bloc reste un
obstacle et se contourne.

**Et une touche coupe les matières.** `T` met tout à plat : ni motif, ni image, rien que les
couleurs. C'est un outil de diagnostic, et le seul moyen honnête de trancher une question qui
ne se tranche pas à l'œil — un scintillement qui survit à l'aplat vient de la géométrie ou de
la profondeur, jamais de la texture.

### Les tableaux

Le musée n'avait jamais chargé la moindre texture : ses matières sont calculées, et c'est un
parti pris qui tient. Mais **un tableau n'est pas une matière** — un cadre qui ne montre qu'un
aplat est un cadre, pas un tableau, et ce musée est fait pour montrer des projets, qui sont des
images. Les captures de l'ancien portfolio y sont donc accrochées, ce qui est un test de rendu
d'image en même temps qu'une plaisanterie : l'ancien musée pend au mur du nouveau.

Elles vivent dans un **tableau de textures**, une couche par image, et la matière d'une surface
désigne sa couche — au-delà de cent, c'est une image. Un tableau plutôt que des textures
séparées, pour une raison de fond : le nuanceur ne peut pas choisir une texture d'après une
donnée par sommet, une texture étant une ressource et non une valeur, alors qu'une couche est
un indice ordinaire.

**Les mip-maps sont construites à la main**, WebGPU n'en fabriquant pas : une passe de rendu
par niveau, chacune lisant le précédent. Sans elles, une image vue de loin ou de biais
scintille — exactement le défaut qu'on venait de corriger dans les matières calculées, et il
aurait été absurde de le réintroduire par la porte des images.

Et pour la troisième fois, la règle d'uniformité de WGSL : `dpdx` et `dpdy` sont interdites
sous une condition qui n'est pas uniforme, tout comme `fwidth`. L'écran est resté noir jusqu'à
ce qu'elles remontent en tête de fragment ; l'image se lit ensuite avec `textureSampleGrad`,
seule variante qui ne réclame pas de dérivée implicite et se laisse appeler n'importe où.

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

S'y ajoute un contrôle qui ne parle pas de coutures du tout : **aucune surface n'en
recouvre une autre**. Toute la géométrie du monde est inspectée, quad par quad, à la
recherche de deux faces qui partagent un plan *et* des pixels. C'est la cause d'un
grésillement qu'on attribue toujours au rendu, jamais à la construction — et le seul cas
que le musée ait connu était le seuil d'une embrasure posée en plein milieu d'une salle,
là où le sol passait déjà.

Ceux de la salle pavée tiennent en deux phrases, et la seconde est la plus utile : **le
réseau s'accorde aux coutures** — chaque couture doit être exactement une translation d'un pas
du réseau, sans rotation et sans un centimètre de trop — et **marcher tout droit ramène au
départ**, avec une dérive latérale nulle au milliardième de mètre près. La salle étant décrite
deux fois, par ses coutures et par son réseau, c'est la seule façon de garantir que ce qu'on
voit est bien ce où l'on va.

S'y ajoute **toute porte perce sa paroi** : au centre d'une porte, dans le plan de sa paroi,
il ne doit y avoir aucune surface. Une bouche et son trou sont décrits séparément, et rien ne
les tenait ensemble ; quand la bouche déménage sans le trou, on entre normalement mais il n'y
a plus de porte derrière soi. Et **aucune cellule ne dépasse le budget de lampes du
nuanceur**, dont le dépassement était silencieux.

Ceux de l'escalier de Penrose portent sur ce qui rend la boucle invisible : **un tour rend
exactement la montée** — égalité éprouvée en trente-deux points du profil, parce qu'un palier
mal placé la casserait au milieu sans toucher aux bouts —, le plafond suit les marches, et
monter est sans fin.

Puis quatre qui décrivent la machine à deux états : **monter depuis la rotonde ne descend
jamais à la salle basse**, **monter depuis la salle basse n'atteint jamais la rotonde**, et
les deux descentes qui mènent chacune à l'autre porte. Les deux premiers se mesurent en
hauteurs, contre la porte d'en face : ce qu'on veut interdire n'est pas de frôler l'autre
étage mais d'arriver à hauteur de son ouverture — donc de la voir. C'est le seul contrôle
numérique qu'on ait trouvé pour un défaut purement visuel.

S'y ajoute **chaque porte est sur un palier** : le sol ne doit pas varier d'un milliardième
de mètre sur la largeur d'une ouverture. C'est le contrôle qui aurait fait gagner le plus de
temps s'il avait existé plus tôt — le défaut qu'il attrape se présente comme un mur invisible
devant une porte ouverte, et rien dans l'image ne dit qu'il s'agit d'une question de sol.

Ceux de la salle aux six sols mesurent une chose et une seule à la fois, et le plus utile
est le plus bête : **la salle a une sortie**. Il est né d'un défaut — la bande d'accroche
faisait grimper le mur juste avant la porte, et l'on tournait indéfiniment autour du cube.
S'y ajoutent la largeur de la bande, qui doit valoir une hauteur d'œil au flottant près, le
fait que **le basculement ne déplace pas le corps** — on mesure la longueur du pas à
l'image où la face change —, les six faces effectivement foulées en deux traversées, et la
sortie d'aplomb.

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

Le dossier `tools/` est l'atelier de mise au point, et il est **versionné** : un seul point
d'entrée, `node tools/lab.mjs <commande>`, et son mode d'emploi dans `tools/README.md`.

La règle qui l'organise vaut d'être dite ici, parce qu'elle décide du temps qu'on passe :
**Node d'abord, navigateur en dernier**. Le monde, le déplacement et la collision sont du
TypeScript pur, donc un défaut de calcul — une couture mal appariée, une rampe qui saute, un
corps qui dérive — se diagnostique en faisant marcher un visiteur dans Node et en lisant les
nombres. Deux dixièmes de seconde. Seuls les défauts de l'**image** demandent le vrai rendu,
donc un navigateur, donc trente secondes.

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
