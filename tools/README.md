# L'atelier

Les sondes de mise au point du moteur. Elles se partagent en deux familles, et **savoir
laquelle prendre est la moitié du gain de temps**.

## La règle : Node d'abord, navigateur en dernier

Les défauts de ce moteur ne se diagnostiquent pas de la même façon selon leur nature.

Ceux **du calcul** — une couture mal appariée, une rampe qui saute, un corps qui dérive,
deux surfaces qui se recouvrent — se voient sans navigateur : le monde, le déplacement et
la collision sont du TypeScript pur. On fait marcher un visiteur dans Node, on lit les
nombres, et cela prend **deux dixièmes de seconde**.

Ceux **de l'image** — un grésillement, un portail vide, une teinte fausse, une transition
qui saute — demandent le vrai rendu, donc Vite, Chrome et une capture à regarder : trente
secondes.

`lab.mjs` couvre la première famille, tout le reste la seconde. Commencer par la première
même quand le symptôme est visuel : neuf fois sur dix, la cause est dans les nombres.

| la question | l'outil |
| --- | --- |
| est-ce que les invariants tiennent ? | `lab.mjs check` |
| où est cette bouche, ce bloc, cette boîte ? | `lab.mjs cells --mouths` |
| est-ce qu'on peut marcher jusque-là ? qu'est-ce qui bloque ? | `lab.mjs walk` |
| pourquoi ça grésille ? | `lab.mjs coplanar` |
| à quoi ça ressemble, d'ici ? | `lab.mjs shot`, ou `pose.mjs` |
| est-ce que la transition est propre ? | `sheet.mjs crossing` |
| qu'est-ce qui a changé dans l'image, et où ? | `diff.mjs` |
| la verticale tourne-t-elle continûment ? | `trace.mjs` |
| la lumière franchit-elle la couture ? | `light.mjs` |
| ce contrôle attrape-t-il vraiment son défaut ? | `ab.mjs` |

---

## `lab.mjs` — le calcul, sans navigateur

```bash
node tools/lab.mjs <commande> [options]
```

Rien à installer : la première commande compile le moteur dans `tools/.build/`, les
suivantes réutilisent la compilation tant que `src/` n'a pas bougé.

### `check` — les invariants

```bash
node tools/lab.mjs check                    # seulement les échecs
node tools/lab.mjs check --all              # tout
node tools/lab.mjs check --only penrose     # filtre sur le nom
```

Le même auto-test que `npm run torture`, sans le navigateur ni les captures. **Le premier
réflexe après toute modification** du monde, du déplacement ou de la collision.

### `walk` — faire marcher un visiteur

La commande qui sert le plus. Elle exécute le **vrai** code de déplacement, sous-pas et
franchissements compris, et affiche l'état image par image.

```bash
# Droit devant soi
node tools/lab.mjs walk --cell gravite --at 205,1.65,205 --face 1,0,0 --steps 600 --every 60

# En visant un point à chaque image — pour aborder une porte
node tools/lab.mjs walk --cell penrose --at 305.5,4.8,312 --toward 307.25,4.22,312 --steps 60 --every 5

# En suivant une volée d'escalier tournant
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

Chaque **traversée de couture** est signalée avec son numéro d'image. Cela suffit à
répondre à la plupart des questions : est-ce qu'on boucle, combien de fois, à quelle
hauteur, et dans quelle cellule on finit.

C'est cette commande qui a trouvé, en un appel, que les pieds passaient trois centimètres
sous le seuil de la porte du bas de l'escalier — un défaut que trois sondes jetables
successives avaient manqué.

### `cells` — le plan du monde

```bash
node tools/lab.mjs cells
node tools/lab.mjs cells --only penrose --mouths
```

Boîtes, particularités (vrille, escalier, six sols, blocs), et avec `--mouths` la position,
la normale et la taille de chaque bouche. **À lire avant d'écrire une position dans une
sonde**, jamais l'inverse.

### `coplanar` — les surfaces qui se disputent des pixels

```bash
node tools/lab.mjs coplanar
```

Deux quads dans le même plan, de même orientation, qui partagent de la surface : c'est la
cause des grésillements, et rien d'autre ne la révèle. L'auto-test le vérifie en tout ou
rien ; ici on obtient le plan et les numéros de sommets.

### `shot` — une ou plusieurs captures

La seule commande de `lab.mjs` qui ouvre un navigateur — mais elle en amortit le coût en
prenant **plusieurs poses dans la même session** :

```bash
node tools/lab.mjs shot --out shots/probe-x.png --cell penrose --at 306,5,312 --face 1,0,0
node tools/lab.mjs shot --out shots/probe-x.png --preset 15 --width 1400 --height 800
node tools/lab.mjs shot --out shots/probe-x.png \
  --poses "penrose:302,18.3,309.3:-0.4,0,-0.9;penrose:301.5,18.4,308.2:-0.2,0,-1"
node tools/lab.mjs shot --out shots/probe-x.png --preset 14 --settle 120 --keys KeyW
```

`--settle N` fait avancer le temps de N images, touches `--keys` tenues, avant la capture :
c'est ce qu'il faut pour photographier un état qu'on n'atteint qu'en marchant — un
basculement de gravité, une réorientation en cours, un cube qui vient de se poser.

---

## Les outils d'image

Tous partagent `lib/harness.mjs`, qui démarre Vite s'il ne tourne pas déjà, lance le
navigateur et attend le crochet de la page. Chacun prend son propre port de débogage : on
peut en lancer deux en parallèle.

- **`pose.mjs`** — une pose, tous ses chiffres et son image. Les distances se comptent le
  long de la normale d'une couture, jamais en coordonnées du monde.
- **`sheet.mjs`** — planche de contact : `crossing` (on traverse au millimètre), `orbit`
  (on tourne sur place), `depth` (la récursion), `jump` (un saut image par image). Une
  transition étalée sur quarante captures interdit la comparaison ; sur une planche, un
  accident d'une seule image saute aux yeux.
- **`diff.mjs`** — *où* deux images diffèrent, et de combien. Le test de torture dit *si*.
- **`trace.mjs`** — relevé numérique d'un parcours dans le navigateur : position, regard,
  verticale, roulis, compteurs de rendu, et signalement des discontinuités.
- **`light.mjs`** — profil lumineux : la flaque de lumière devant une porte, et la
  continuité de la luminance à l'instant du franchissement.
- **`ab.mjs`** — réintroduit un défaut connu (catalogue dans `patches.mjs`), lance une
  commande, restaure. **Un contrôle de non-régression qu'on n'a jamais vu échouer n'en est
  pas un** : c'est l'outil qui le prouve.

---

## Ce qu'il faut savoir avant de sonder

**Ne jamais écrire une coordonnée du monde en dur** dans une sonde qu'on veut garder. Le
plan des coutures a déjà bougé plusieurs fois, et les repères figés se mettent alors à
mesurer autre chose sans rien signaler. `cells --mouths` donne les positions du moment.

**Ne jamais téléporter à travers une couture.** Une position au-delà du plan d'une bouche
mais rattachée à la cellule de départ est un état que le moteur ne produit jamais ; la
mesurer fabrique de faux échecs. Pour franchir, on marche — c'est ce que fait `walk`.

**Un défaut compris devient un invariant.** L'atelier sert à comprendre, pas à valider :
dès qu'on a compris, la vérification part dans `src/dev/selftest.ts`, où elle tournera à
chaque `npm run torture`. Et selon la règle de la maison, on **voit d'abord le nouvel
invariant échouer** — `ab.mjs` est là pour ça — avant de le voir passer.

## Le crochet de la page

Les outils d'image pilotent `window.__edifice`, exposé par `src/main.ts` : `state`, `seam`,
`teleport`, `walk`, `tick`, `face`, `setDepth`, `setChrome`, `setPaused`,
`setTransmission`, `throwCube`, `clearance`, `selfTest`. C'est la frontière prévue pour ça —
quand une sonde a besoin de voir autre chose, on y ajoute une entrée plutôt que d'aller
fouiller dans les modules.
