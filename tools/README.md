# L'atelier

Les sondes de mise au point du moteur. Un seul point d'entrée :

```bash
node tools/lab.mjs <commande> [options]
```

Rien à installer : la première commande compile le moteur dans `tools/.build/`, les
suivantes réutilisent la compilation tant que `src/` n'a pas bougé. Un contrôle complet
passe ainsi de **dix secondes à deux dixièmes**.

## La règle : Node d'abord, navigateur en dernier

Les défauts de ce moteur se répartissent en deux familles, et elles ne se diagnostiquent
pas de la même façon.

Ceux **du calcul** — une couture mal appariée, une rampe qui saute, un corps qui dérive,
une surface qui en recouvre une autre — se voient sans navigateur : le monde, le
déplacement et la collision sont du TypeScript pur. On fait marcher un visiteur dans Node
et on lit les nombres.

Ceux **de l'image** — un grésillement, un portail vide, une teinte fausse — demandent le
vrai rendu, donc un navigateur, donc trente secondes et une capture à regarder.

`check`, `walk`, `cells` et `coplanar` ne lancent rien. `shot` seule ouvre un navigateur.
**Essayer les premières avant la dernière** fait gagner l'essentiel du temps.

## Les commandes

### `check` — les invariants

```bash
node tools/lab.mjs check                    # seulement les échecs
node tools/lab.mjs check --all              # tout
node tools/lab.mjs check --only penrose     # filtre sur le nom
```

Le même auto-test que `npm run torture`, sans le navigateur ni les captures. C'est le
premier réflexe après toute modification du monde ou du déplacement.

### `walk` — faire marcher un visiteur

La commande qui sert le plus. Elle exécute le **vrai** code de déplacement, sous-pas et
franchissements compris, et affiche l'état image par image.

```bash
# Marcher droit devant soi
node tools/lab.mjs walk --cell gravite --at 205,1.65,205 --face 1,0,0 --steps 600 --every 60

# Viser un point à chaque image (utile pour aborder une porte)
node tools/lab.mjs walk --cell penrose --at 305.5,4.8,312 --toward 307.25,4.22,312 --steps 60 --every 5

# Suivre une volée d'escalier : le regard le long de la tangente au pilier
node tools/lab.mjs walk --cell penrose --follow 1 --steps 3600 --every 600    # en montant
node tools/lab.mjs walk --cell penrose --follow -1 --steps 1800 --every 300   # en descendant
```

| option | effet |
| --- | --- |
| `--cell` | la cellule de départ |
| `--at x,y,z` | la position ; à défaut, deux mètres devant sa première bouche |
| `--face x,y,z` | la direction du regard au départ |
| `--toward x,y,z` | réoriente le regard vers ce point à chaque image |
| `--follow ±1` | suit la volée d'un escalier tournant, en montant (+1) ou en descendant (−1) |
| `--keys KeyW,ShiftLeft` | touches tenues ; `none` pour rester immobile et tomber |
| `--steps`, `--every` | nombre d'images, et une ligne toutes les tant |

Chaque **traversée de couture** est signalée avec son numéro d'image, ce qui suffit à
répondre à la plupart des questions : est-ce qu'on boucle, combien de fois, à quelle
hauteur, et dans quelle cellule on finit.

### `cells` — le plan du monde

```bash
node tools/lab.mjs cells
node tools/lab.mjs cells --only penrose --mouths
```

Boîtes, particularités (vrille, escalier, six sols, blocs), et avec `--mouths` la position,
la normale et la taille de chaque bouche. À lire **avant** d'écrire une position en dur
dans une sonde.

### `coplanar` — les surfaces qui se disputent des pixels

```bash
node tools/lab.mjs coplanar
```

Deux quads dans le même plan, de même orientation, qui partagent de la surface : c'est la
cause des grésillements, et c'est indétectable à l'œil autrement qu'en le voyant. L'auto-test
le vérifie en tout ou rien ; ici on obtient le plan et les numéros de sommets.

### `shot` — une capture

```bash
node tools/lab.mjs shot --out shots/probe-x.png --cell penrose --at 306,5,312 --face 1,0,0
node tools/lab.mjs shot --out shots/probe-y.png --preset 15 --width 1400 --height 800
node tools/lab.mjs shot --out shots/probe-z.png --preset 15 --settle 120 --keys KeyW
```

`--settle N` fait avancer le temps de N images avant la capture, touches `--keys` tenues :
c'est ce qu'il faut pour photographier un état qu'on n'atteint qu'en marchant — un
basculement de gravité, une réorientation en cours, un cube qui vient de se poser.

Les sorties vont dans `shots/probe-*.png`, que le dépôt ignore.

## Ce qu'il faut savoir avant de sonder

**Ne jamais écrire une coordonnée du monde en dur** dans une sonde qu'on veut garder. Le
plan des coutures a déjà bougé plusieurs fois, et les repères figés se mettent alors à
mesurer autre chose sans rien signaler. `cells --mouths` donne les positions du moment.

**Ne jamais téléporter à travers une couture.** Une position au-delà du plan d'une bouche
mais rattachée à la cellule de départ est un état que le moteur ne produit jamais ; la
mesurer fabrique de faux échecs. Pour franchir, on marche — c'est ce que fait `walk`.

**Un défaut trouvé devient un invariant.** L'atelier sert à comprendre, pas à valider :
dès qu'on a compris, la vérification part dans `src/dev/selftest.ts`, où elle tournera à
chaque `npm run torture`. Et selon la règle de la maison, on **voit d'abord le nouvel
invariant échouer** — en réintroduisant le défaut — avant de le voir passer.

## Le crochet de la page

Les commandes qui ouvrent un navigateur pilotent `window.__edifice`, exposé par
`src/main.ts` : `state`, `seam`, `teleport`, `walk`, `tick`, `face`, `setDepth`,
`setChrome`, `setPaused`, `setTransmission`, `throwCube`, `clearance`, `selfTest`. C'est la
frontière prévue pour ça — quand une sonde a besoin de voir autre chose, on y ajoute une
entrée plutôt que d'aller fouiller dans les modules.
