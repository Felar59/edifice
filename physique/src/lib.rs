//! **La physique des objets, en Rust compilé vers WebAssembly.**
//!
//! C'est le premier morceau du moteur à quitter TypeScript, et le choix de celui-là n'est
//! pas un hasard : la physique est le seul endroit où le coût dépend du **nombre d'objets**
//! plutôt que du nombre de pixels. Tout le reste — le pilotage de WebGPU, la construction du
//! monde, le déplacement du visiteur — vit très bien côté page, et franchir la frontière à
//! chaque image ne ferait que ralentir la boucle d'itération.
//!
//! ## L'interface est purement numérique
//!
//! Pas de `wasm-bindgen`, pas de chaînes, pas d'objets : le monde et les corps sont des
//! tableaux de flottants dans la mémoire linéaire, que la page lit et écrit directement. Ce
//! n'est pas de la coquetterie — c'est ce qui rend l'appel par image gratuit, et ce qui
//! permet au module de se charger d'un `WebAssembly.instantiate` sans outil intermédiaire.
//! Une surface d'échange plus riche viendra peut-être ailleurs ; pour un chemin chaud, elle
//! serait payée à chaque image et n'apporterait rien.
//!
//! ## Ce que fait ce module, et que l'ancien ne faisait pas
//!
//! L'ancienne version tournait les cubes à vitesse constante autour d'un axe tiré au sort et
//! les arrêtait net en touchant le sol. Ici, un cube est un **solide** : il a une inertie, il
//! rebondit sur ses arêtes, il bascule, il frotte, il se pose à plat, et il se cogne aux
//! autres. Le tenseur d'inertie d'un cube étant isotrope, l'inverse se réduit à un scalaire
//! — c'est ce qui rend un solveur à impulsions aussi court ici.
//!
//! ## Le monde qu'il connaît
//!
//! Les cellules du musée, avec leurs blocs pleins, leurs coutures, et la forme de leur sol :
//! plat, six faces, rampe d'escalier tournant ou tube vrillé. Les quatre existent dans le
//! musée et les quatre sont ici, sans quoi il aurait fallu faire cohabiter deux moteurs et
//! décider, à chaque image et pour chaque cube, lequel a raison.

use core::f32::consts::PI;

// ---------------------------------------------------------------------------
// Un peu d'algèbre. Rien de plus que ce dont on se sert.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Default, PartialEq)]
struct V3 {
    x: f32,
    y: f32,
    z: f32,
}

fn v3(x: f32, y: f32, z: f32) -> V3 {
    V3 { x, y, z }
}

impl V3 {
    fn add(self, o: V3) -> V3 {
        v3(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    fn sub(self, o: V3) -> V3 {
        v3(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    fn scale(self, k: f32) -> V3 {
        v3(self.x * k, self.y * k, self.z * k)
    }
    fn dot(self, o: V3) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    fn cross(self, o: V3) -> V3 {
        v3(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    fn len(self) -> f32 {
        self.dot(self).sqrt()
    }
    fn component(self, k: usize) -> f32 {
        match k {
            0 => self.x,
            1 => self.y,
            _ => self.z,
        }
    }
}

/// Une orientation. On la garde en quaternion : c'est la seule forme qui se renormalise
/// sans dériver, et une base de trois vecteurs finit toujours par se voiler.
#[derive(Clone, Copy)]
struct Quat {
    x: f32,
    y: f32,
    z: f32,
    w: f32,
}

impl Quat {
    fn identity() -> Quat {
        Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
    }
    fn mul(self, o: Quat) -> Quat {
        Quat {
            w: self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
            x: self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            y: self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            z: self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
        }
    }
    fn normalise(self) -> Quat {
        let l = (self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w).sqrt();
        if l < 1e-9 {
            Quat::identity()
        } else {
            Quat { x: self.x / l, y: self.y / l, z: self.z / l, w: self.w / l }
        }
    }
    /// Fait tourner un vecteur. Formule de Rodrigues sous forme quaternionique.
    fn rotate(self, v: V3) -> V3 {
        let u = v3(self.x, self.y, self.z);
        let s = self.w;
        u.scale(2.0 * u.dot(v))
            .add(v.scale(s * s - u.dot(u)))
            .add(u.cross(v).scale(2.0 * s))
    }
}

/// Une matrice 4×4 en colonnes, comme celles du côté page.
type M4 = [f32; 16];

fn transform_point(m: &M4, p: V3) -> V3 {
    v3(
        m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
        m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
        m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
    )
}

fn transform_dir(m: &M4, d: V3) -> V3 {
    v3(
        m[0] * d.x + m[4] * d.y + m[8] * d.z,
        m[1] * d.x + m[5] * d.y + m[9] * d.z,
        m[2] * d.x + m[6] * d.y + m[10] * d.z,
    )
}

/// La rotation d'une matrice rigide, en quaternion. Méthode de Shepperd : on part de la
/// plus grande des quatre composantes, faute de quoi une racine carrée de presque zéro
/// amplifie tout le bruit.
fn quat_of(m: &M4) -> Quat {
    let (m00, m11, m22) = (m[0], m[5], m[10]);
    let trace = m00 + m11 + m22;
    if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        Quat {
            w: 0.25 * s,
            x: (m[6] - m[9]) / s,
            y: (m[8] - m[2]) / s,
            z: (m[1] - m[4]) / s,
        }
    } else if m00 > m11 && m00 > m22 {
        let s = (1.0 + m00 - m11 - m22).sqrt() * 2.0;
        Quat { w: (m[6] - m[9]) / s, x: 0.25 * s, y: (m[4] + m[1]) / s, z: (m[8] + m[2]) / s }
    } else if m11 > m22 {
        let s = (1.0 + m11 - m00 - m22).sqrt() * 2.0;
        Quat { w: (m[8] - m[2]) / s, x: (m[4] + m[1]) / s, y: 0.25 * s, z: (m[9] + m[6]) / s }
    } else {
        let s = (1.0 + m22 - m00 - m11).sqrt() * 2.0;
        Quat { w: (m[1] - m[4]) / s, x: (m[8] + m[2]) / s, y: (m[9] + m[6]) / s, z: 0.25 * s }
    }
}

fn rotate_axis(v: V3, axis: V3, angle: f32) -> V3 {
    let (s, c) = (angle.sin(), angle.cos());
    v.scale(c)
        .add(axis.cross(v).scale(s))
        .add(axis.scale(axis.dot(v) * (1.0 - c)))
}

// ---------------------------------------------------------------------------
// Le monde.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Mouth {
    c: V3,
    right: V3,
    up: V3,
    n: V3,
    hw: f32,
    hh: f32,
}

struct Passage {
    from: Mouth,
    dest: usize,
    m: M4,
}

struct Block {
    min: V3,
    max: V3,
    door: Option<Mouth>,
}

struct Spiral {
    centre: V3,
    rise: f32,
    steps: i32,
    cut: f32,
    headroom: f32,
    from: f32,
    turns: f32,
    landings: Vec<(i32, i32)>,
}

struct Tube {
    origin: V3,
    axis: V3,
    right0: V3,
    up0: V3,
    length: f32,
    half: f32,
    turn: f32,
    straight: f32,
}

enum Floor {
    Flat,
    /// La salle aux six sols : on tombe vers la paroi dont on est le plus près.
    Faces,
    Spiral(Spiral),
    Tube(Tube),
}

struct Cell {
    min: V3,
    max: V3,
    floor: Floor,
    blocks: Vec<Block>,
    passages: Vec<Passage>,
}

struct World {
    cells: Vec<Cell>,
}

// ---------------------------------------------------------------------------
// L'escalier tournant, porté tel quel depuis `spiral.ts`.
//
// Les deux versions doivent donner exactement la même hauteur : le visiteur marche avec
// l'une, les cubes tombent avec l'autre, et un cube qui traverserait le sol sur lequel le
// visiteur se tient serait le genre de défaut qu'on met des heures à relier à sa cause.
// ---------------------------------------------------------------------------

impl Spiral {
    fn turn_at(&self, p: V3) -> f32 {
        let angle = (p.z - self.centre.z).atan2(p.x - self.centre.x);
        let turn = (angle - self.cut) / (2.0 * PI);
        turn - turn.floor()
    }

    fn on_the_landing(&self, step: i32) -> bool {
        let wrapped = ((step % self.steps) + self.steps) % self.steps;
        self.landings
            .iter()
            .any(|(at, count)| (wrapped - at + self.steps) % self.steps < *count)
    }

    fn step_height(&self, k: i32) -> f32 {
        let laps = (k as f32 / self.steps as f32).floor();
        let rest = k - (laps as i32) * self.steps;

        let flat: i32 = self.landings.iter().map(|(_, c)| *c).sum();
        let climbing = self.steps - flat;
        let gain = if climbing > 0 { self.rise / climbing as f32 } else { 0.0 };

        let mut risen = 0.0;
        for i in 0..rest {
            if !self.on_the_landing(i) {
                risen += gain;
            }
        }
        self.centre.y + risen + laps * self.rise
    }

    fn height_at_turn(&self, turn: f32) -> f32 {
        let x = turn * self.steps as f32;
        let i = x.floor();
        let here = self.step_height(i as i32 + 1);
        let next = self.step_height(i as i32 + 2);
        here + (next - here) * (x - i - 0.5)
    }

    /// Voir la version TypeScript : la tolérance se compte **vers le bas**, faute de quoi un
    /// corps petit — un cube posé à dix-sept centimètres de son sol — est rangé sur la volée
    /// d'en dessous et tombe de douze mètres.
    fn flight_under(&self, p: V3) -> f32 {
        let sector = self.turn_at(p);
        let raw = ((p.y + 0.5 - self.height_at_turn(sector)) / self.rise).floor();
        let lowest = (self.from - sector - 0.02).ceil();
        let highest = (self.from + self.turns - sector).floor();
        sector + raw.max(lowest).min(highest)
    }

    fn ramp(&self, p: V3) -> f32 {
        self.height_at_turn(self.flight_under(p))
    }
}

// ---------------------------------------------------------------------------
// Le tube vrillé, porté depuis `twist.ts`.
// ---------------------------------------------------------------------------

struct Local {
    s: f32,
    u: f32,
    v: f32,
}

impl Tube {
    fn angle_at(&self, s: f32) -> f32 {
        let clamped = s.max(0.0).min(self.length);
        if clamped <= self.straight {
            return 0.0;
        }
        let span = self.length - self.straight;
        if span <= 0.0 {
            return self.turn;
        }
        let t = (clamped - self.straight) / span;
        self.turn * t * t * (3.0 - 2.0 * t)
    }

    fn frame_at(&self, s: f32) -> (V3, V3) {
        let angle = self.angle_at(s);
        (
            rotate_axis(self.right0, self.axis, angle),
            rotate_axis(self.up0, self.axis, angle),
        )
    }

    fn to_local(&self, p: V3) -> Local {
        let rel = p.sub(self.origin);
        let s = rel.dot(self.axis);
        let (right, up) = self.frame_at(s);
        Local { s, u: rel.dot(right), v: rel.dot(up) }
    }

    fn to_world(&self, l: &Local) -> V3 {
        let (right, up) = self.frame_at(l.s);
        self.origin
            .add(self.axis.scale(l.s))
            .add(right.scale(l.u))
            .add(up.scale(l.v))
    }
}

// ---------------------------------------------------------------------------
// Les corps.
//
// Seize flottants chacun, pour que la page lise et écrive le tableau directement. Le
// découpage est figé et documenté ici, c'est le contrat des deux côtés.
// ---------------------------------------------------------------------------

const STRIDE: usize = 16;
const CAPACITY: usize = 128;

// 0..2 position · 3..6 orientation (x,y,z,w) · 7..9 vitesse · 10..12 rotation
// 13 cellule · 14 âge · 15 sommeil

const HALF: f32 = 0.17;
const GRAVITY: f32 = 11.0;
/// Rebond : un cube de pierre, pas une balle.
const RESTITUTION: f32 = 0.22;
const FRICTION: f32 = 0.55;
/// L'inverse du moment d'inertie d'un cube homogène de masse 1 — un scalaire, le tenseur
/// d'un cube étant isotrope. C'est ce qui rend tout ce solveur aussi court.
const INV_INERTIA: f32 = 6.0 / (2.0 * HALF * 2.0 * HALF);
const SUBSTEP: f32 = 0.04;
/// En dessous, on considère le corps posé et on l'endort : sans quoi il frissonne sur place
/// indéfiniment, et rien n'est plus visible qu'un objet immobile qui tremble.
const SLEEP_SPEED: f32 = 0.35;
const SLEEP_SPIN: f32 = 0.8;
const SLEEP_TIME: f32 = 0.35;

static mut BODIES: [f32; CAPACITY * STRIDE] = [0.0; CAPACITY * STRIDE];
static mut WORLD: Option<World> = None;
static mut SCRATCH: Vec<f32> = Vec::new();

struct Body {
    pos: V3,
    rot: Quat,
    vel: V3,
    spin: V3,
    cell: usize,
    age: f32,
    still: f32,
}

fn read_body(b: &[f32]) -> Body {
    Body {
        pos: v3(b[0], b[1], b[2]),
        rot: Quat { x: b[3], y: b[4], z: b[5], w: b[6] },
        vel: v3(b[7], b[8], b[9]),
        spin: v3(b[10], b[11], b[12]),
        cell: b[13] as usize,
        age: b[14],
        still: b[15],
    }
}

fn write_body(b: &mut [f32], body: &Body) {
    b[0] = body.pos.x;
    b[1] = body.pos.y;
    b[2] = body.pos.z;
    b[3] = body.rot.x;
    b[4] = body.rot.y;
    b[5] = body.rot.z;
    b[6] = body.rot.w;
    b[7] = body.vel.x;
    b[8] = body.vel.y;
    b[9] = body.vel.z;
    b[10] = body.spin.x;
    b[11] = body.spin.y;
    b[12] = body.spin.z;
    b[13] = body.cell as f32;
    b[14] = body.age;
    b[15] = body.still;
}

// ---------------------------------------------------------------------------
// Lecture du monde.
// ---------------------------------------------------------------------------

struct Reader<'a> {
    data: &'a [f32],
    at: usize,
}

impl<'a> Reader<'a> {
    fn f(&mut self) -> f32 {
        let v = self.data[self.at];
        self.at += 1;
        v
    }
    fn i(&mut self) -> i32 {
        self.f() as i32
    }
    fn v(&mut self) -> V3 {
        v3(self.f(), self.f(), self.f())
    }
    fn mouth(&mut self) -> Mouth {
        Mouth {
            c: self.v(),
            right: self.v(),
            up: self.v(),
            n: self.v(),
            hw: self.f(),
            hh: self.f(),
        }
    }
}

fn parse(data: &[f32]) -> World {
    let mut r = Reader { data, at: 0 };
    let cell_count = r.i();
    let mut cells = Vec::with_capacity(cell_count as usize);

    for _ in 0..cell_count {
        let min = r.v();
        let max = r.v();
        let kind = r.i();
        let floor = match kind {
            1 => Floor::Faces,
            2 => {
                let centre = r.v();
                let rise = r.f();
                let steps = r.i();
                let cut = r.f();
                let headroom = r.f();
                let from = r.f();
                let turns = r.f();
                let n = r.i();
                let mut landings = Vec::with_capacity(n as usize);
                for _ in 0..n {
                    landings.push((r.i(), r.i()));
                }
                Floor::Spiral(Spiral { centre, rise, steps, cut, headroom, from, turns, landings })
            }
            3 => Floor::Tube(Tube {
                origin: r.v(),
                axis: r.v(),
                right0: r.v(),
                up0: r.v(),
                length: r.f(),
                half: r.f(),
                turn: r.f(),
                straight: r.f(),
            }),
            _ => Floor::Flat,
        };

        let block_count = r.i();
        let mut blocks = Vec::with_capacity(block_count as usize);
        for _ in 0..block_count {
            let min = r.v();
            let max = r.v();
            let door = if r.i() != 0 { Some(r.mouth()) } else { None };
            blocks.push(Block { min, max, door });
        }

        let passage_count = r.i();
        let mut passages = Vec::with_capacity(passage_count as usize);
        for _ in 0..passage_count {
            let from = r.mouth();
            let dest = r.i() as usize;
            let mut m: M4 = [0.0; 16];
            for slot in m.iter_mut() {
                *slot = r.f();
            }
            passages.push(Passage { from, dest, m });
        }

        cells.push(Cell { min, max, floor, blocks, passages });
    }

    World { cells }
}

// ---------------------------------------------------------------------------
// Le sol, le plafond, les parois.
// ---------------------------------------------------------------------------

/// La direction du bas à un endroit donné, et la distance au sol correspondante.
fn ground_plane(cell: &Cell, p: V3) -> (V3, f32) {
    match &cell.floor {
        Floor::Flat => (v3(0.0, -1.0, 0.0), p.y - cell.min.y),
        Floor::Spiral(s) => (v3(0.0, -1.0, 0.0), p.y - s.ramp(p)),
        Floor::Tube(t) => {
            let l = t.to_local(p);
            let (_, up) = t.frame_at(l.s);
            (up.scale(-1.0), l.v + t.half)
        }
        Floor::Faces => {
            // On tombe vers la paroi dont on est le plus près — la règle de ce qui n'a pas
            // de tête, et c'est ce qui fait que les cubes s'accumulent sur les six faces.
            let mut best = (v3(0.0, -1.0, 0.0), f32::INFINITY);
            for k in 0..3 {
                let lo = p.component(k) - cell.min.component(k);
                let hi = cell.max.component(k) - p.component(k);
                let mut down = v3(0.0, 0.0, 0.0);
                if lo < best.1 {
                    match k {
                        0 => down.x = -1.0,
                        1 => down.y = -1.0,
                        _ => down.z = -1.0,
                    }
                    best = (down, lo);
                }
                let mut up = v3(0.0, 0.0, 0.0);
                if hi < best.1 {
                    match k {
                        0 => up.x = 1.0,
                        1 => up.y = 1.0,
                        _ => up.z = 1.0,
                    }
                    best = (up, hi);
                }
            }
            best
        }
    }
}

/// Le corps est-il en face de cette ouverture ? On mesure le centre, un cube étant petit
/// devant toutes les portes du musée.
fn through(m: &Mouth, p: V3) -> bool {
    let rel = p.sub(m.c);
    rel.dot(m.right).abs() <= m.hw - HALF && rel.dot(m.up).abs() <= m.hh - HALF
}

/// Les plans contre lesquels le corps doit être retenu, dans cette cellule et à cet endroit.
///
/// Chacun est donné par sa normale (vers l'intérieur) et la position de son plan le long de
/// cette normale. Les parois percées d'une ouverture qu'on aborde sont **absentes** de la
/// liste : c'est ce qui laisse un cube franchir une porte.
fn walls(cell: &Cell, p: V3, out: &mut Vec<(V3, f32)>) {
    out.clear();

    match &cell.floor {
        Floor::Tube(t) => {
            // Le tube se traite dans son repère : ses parois y sont droites.
            let l = t.to_local(p);
            let (right, up) = t.frame_at(l.s);
            out.push((up, t.to_world(&Local { s: l.s, u: l.u, v: -t.half }).dot(up)));
            out.push((up.scale(-1.0), -t.to_world(&Local { s: l.s, u: l.u, v: t.half }).dot(up)));
            out.push((right, t.to_world(&Local { s: l.s, u: -t.half, v: l.v }).dot(right)));
            out.push((
                right.scale(-1.0),
                -t.to_world(&Local { s: l.s, u: t.half, v: l.v }).dot(right),
            ));
            return;
        }
        Floor::Spiral(s) => {
            let ramp = s.ramp(p);
            out.push((v3(0.0, 1.0, 0.0), ramp));
            out.push((v3(0.0, -1.0, 0.0), -(ramp + s.headroom)));
        }
        _ => {
            out.push((v3(0.0, 1.0, 0.0), cell.min.y));
            out.push((v3(0.0, -1.0, 0.0), -cell.max.y));
        }
    }

    let sides: [(V3, f32); 4] = [
        (v3(1.0, 0.0, 0.0), cell.min.x),
        (v3(-1.0, 0.0, 0.0), -cell.max.x),
        (v3(0.0, 0.0, 1.0), cell.min.z),
        (v3(0.0, 0.0, -1.0), -cell.max.z),
    ];
    for (n, d) in sides {
        let open = cell.passages.iter().any(|p2| {
            p2.from.n.dot(n) > 0.9 && through(&p2.from, p)
        });
        if !open {
            out.push((n, d));
        }
    }
}

// ---------------------------------------------------------------------------
// Le pas.
// ---------------------------------------------------------------------------

/// Les huit coins du cube, dans le monde.
fn corners(body: &Body, out: &mut [V3; 8]) {
    let mut k = 0;
    for sx in [-1.0f32, 1.0] {
        for sy in [-1.0f32, 1.0] {
            for sz in [-1.0f32, 1.0] {
                out[k] = body.pos.add(body.rot.rotate(v3(sx * HALF, sy * HALF, sz * HALF)));
                k += 1;
            }
        }
    }
}

/// Une impulsion au point `r` (depuis le centre), le long de `n`, avec frottement.
fn impulse(body: &mut Body, r: V3, n: V3, restitution: f32) {
    let point = body.vel.add(body.spin.cross(r));
    let normal_speed = point.dot(n);
    if normal_speed >= 0.0 {
        return;
    }

    let rn = r.cross(n);
    let denom = 1.0 + INV_INERTIA * rn.dot(rn);
    let j = -(1.0 + restitution) * normal_speed / denom;
    body.vel = body.vel.add(n.scale(j));
    body.spin = body.spin.add(r.cross(n.scale(j)).scale(INV_INERTIA));

    // Frottement de Coulomb, borné par l'impulsion normale : c'est lui qui arrête un cube
    // au lieu de le laisser glisser indéfiniment, et qui le fait basculer sur son arête.
    let point = body.vel.add(body.spin.cross(r));
    let tangent = point.sub(n.scale(point.dot(n)));
    let speed = tangent.len();
    if speed > 1e-4 {
        let t = tangent.scale(1.0 / speed);
        let rt = r.cross(t);
        let denom_t = 1.0 + INV_INERTIA * rt.dot(rt);
        let jt = (-speed / denom_t).max(-FRICTION * j);
        body.vel = body.vel.add(t.scale(jt));
        body.spin = body.spin.add(r.cross(t.scale(jt)).scale(INV_INERTIA));
    }
}

/// Résout les contacts, et dit si le corps est **porté** — c'est-à-dire s'il touche quelque
/// chose qui s'oppose à sa chute.
///
/// La nuance décide de l'endormissement, et elle n'est pas une subtilité : un cube ralenti
/// qui frôle une paroi verticale n'est pas posé. Le confondre avec un cube au repos le fige
/// **en l'air**, contre le mur, et rien n'est plus visible qu'un objet suspendu.
fn resolve(cell: &Cell, body: &mut Body, planes: &mut Vec<(V3, f32)>, down: V3) -> bool {
    walls(cell, body.pos, planes);

    let mut corner = [V3::default(); 8];
    corners(body, &mut corner);

    let mut carried = false;
    let mut correction = v3(0.0, 0.0, 0.0);

    for (n, d) in planes.iter() {
        // La pénétration la plus profonde décide du recalage ; chaque coin enfoncé reçoit
        // son impulsion. Un cube qui tombe à plat en a quatre d'un coup, et se pose donc à
        // plat ; posé sur une arête, il n'en a que deux et bascule.
        let mut deepest = 0.0f32;
        for c in corner.iter() {
            let gap = c.dot(*n) - d;
            if gap < 0.0 {
                if n.dot(down) < -0.5 {
                    carried = true;
                }
                if -gap > deepest {
                    deepest = -gap;
                }
                impulse(body, c.sub(body.pos), *n, RESTITUTION);
            }
        }
        if deepest > 0.0 {
            correction = correction.add(n.scale(deepest));
        }
    }

    for block in cell.blocks.iter() {
        if let Some(door) = &block.door {
            if through(door, body.pos) {
                continue;
            }
        }
        for c in corner.iter() {
            if c.x <= block.min.x || c.x >= block.max.x {
                continue;
            }
            if c.y <= block.min.y || c.y >= block.max.y {
                continue;
            }
            if c.z <= block.min.z || c.z >= block.max.z {
                continue;
            }
            // Le coin est dans la matière : on ressort par la face la plus proche.
            let mut best_axis = 0;
            let mut best_sign = 1.0f32;
            let mut best_gap = f32::INFINITY;
            for k in 0..3 {
                let lo = c.component(k) - block.min.component(k);
                let hi = block.max.component(k) - c.component(k);
                if lo < best_gap {
                    best_gap = lo;
                    best_axis = k;
                    best_sign = -1.0;
                }
                if hi < best_gap {
                    best_gap = hi;
                    best_axis = k;
                    best_sign = 1.0;
                }
            }
            let mut n = v3(0.0, 0.0, 0.0);
            match best_axis {
                0 => n.x = best_sign,
                1 => n.y = best_sign,
                _ => n.z = best_sign,
            }
            if n.dot(down) < -0.5 {
                carried = true;
            }
            correction = correction.add(n.scale(best_gap));
            impulse(body, c.sub(body.pos), n, RESTITUTION);
        }
    }

    if correction.len() > 0.0 {
        body.pos = body.pos.add(correction.scale(0.9));
    }
    carried
}

/// Première couture franchie par le segment, s'il y en a une.
fn crossing(cell: &Cell, from: V3, seg: V3) -> Option<(usize, usize)> {
    let to = from.add(seg);
    let mut best: Option<(usize, f32)> = None;
    for (i, p) in cell.passages.iter().enumerate() {
        let m = &p.from;
        let d0 = m.n.dot(from.sub(m.c));
        let d1 = m.n.dot(to.sub(m.c));
        if d0 <= 1e-4 || d1 > 1e-4 {
            continue;
        }
        let denom = d0 - d1;
        if denom < 1e-9 {
            continue;
        }
        let t = (d0 / denom).min(1.0);
        let rel = from.add(seg.scale(t)).sub(m.c);
        if rel.dot(m.right).abs() > m.hw || rel.dot(m.up).abs() > m.hh {
            continue;
        }
        if best.map_or(true, |(_, bt)| t < bt) {
            best = Some((i, t));
        }
    }
    best.map(|(i, _)| (i, i))
}

fn step_body(world: &World, body: &mut Body, dt: f32, planes: &mut Vec<(V3, f32)>) {
    body.age += dt;

    let cell = &world.cells[body.cell.min(world.cells.len() - 1)];
    let (down, _) = ground_plane(cell, body.pos);
    body.vel = body.vel.add(down.scale(GRAVITY * dt));

    // Le déplacement, en sous-pas : sur une seule image un cube rapide traverserait une
    // paroi, et surtout raterait la couture qu'il devait franchir.
    let mut remaining = body.vel.scale(dt);
    for _ in 0..64 {
        let total = remaining.len();
        if total < 1e-7 {
            break;
        }
        let step = total.min(SUBSTEP);
        let seg = remaining.scale(step / total);
        let here = &world.cells[body.cell];

        if let Some((index, _)) = crossing(here, body.pos, seg) {
            let passage = &here.passages[index];
            let m = &passage.m;
            body.pos = transform_point(m, body.pos.add(seg.scale(0.999)));
            body.vel = transform_dir(m, body.vel);
            body.spin = transform_dir(m, body.spin);
            body.rot = quat_of(m).mul(body.rot).normalise();
            remaining = transform_dir(m, remaining);
            body.cell = passage.dest;
            continue;
        }

        body.pos = body.pos.add(seg);
        remaining = remaining.sub(seg);
    }

    // La rotation, intégrée à l'ordre un puis renormalisée. Une base de trois vecteurs se
    // voilerait ; un quaternion, non.
    let w = body.spin;
    let dq = Quat { x: w.x * 0.5 * dt, y: w.y * 0.5 * dt, z: w.z * 0.5 * dt, w: 1.0 };
    body.rot = dq.mul(body.rot).normalise();

    let cell = &world.cells[body.cell];
    let (down_here, _) = ground_plane(cell, body.pos);
    let carried = resolve(cell, body, planes, down_here);

    // Endormissement. Un solide au repos garde toujours un peu de vitesse — les impulsions
    // ne s'annulent jamais exactement — et ce reste se voit comme un frisson.
    if carried && body.vel.len() < SLEEP_SPEED && body.spin.len() < SLEEP_SPIN {
        body.still += dt;
        if body.still > SLEEP_TIME {
            body.vel = v3(0.0, 0.0, 0.0);
            body.spin = v3(0.0, 0.0, 0.0);
        }
    } else {
        body.still = 0.0;
    }
}

/// Les cubes entre eux : les coins de l'un contre le volume de l'autre.
///
/// Sans cela, une poignée de cubes lancés au même endroit s'interpénètrent et forment une
/// masse informe — ce qui se remarque d'autant plus dans une salle qui répète ce tas dans
/// toutes ses copies.
fn resolve_pairs(bodies: &mut [Body]) {
    let reach = 2.0 * HALF * 1.74;
    for i in 0..bodies.len() {
        for j in (i + 1)..bodies.len() {
            if bodies[i].cell != bodies[j].cell {
                continue;
            }
            let delta = bodies[j].pos.sub(bodies[i].pos);
            let distance = delta.len();
            if distance > reach || distance < 1e-6 {
                continue;
            }

            // Séparation par la normale du centre au centre : approximation franche, mais
            // deux cubes de même taille ne se croisent jamais que par un coin ou une face,
            // et l'œil ne fait pas la différence à cette échelle.
            let overlap = reach - distance;
            let n = delta.scale(1.0 / distance);
            let push = n.scale(overlap * 0.25);
            bodies[i].pos = bodies[i].pos.sub(push);
            bodies[j].pos = bodies[j].pos.add(push);

            let relative = bodies[j].vel.sub(bodies[i].vel).dot(n);
            if relative < 0.0 {
                let j_impulse = -(1.0 + RESTITUTION) * relative * 0.5;
                bodies[i].vel = bodies[i].vel.sub(n.scale(j_impulse));
                bodies[j].vel = bodies[j].vel.add(n.scale(j_impulse));
                // Un peu de rotation prise au choc, sans quoi une pile de cubes reste
                // suspecte de sagesse.
                let spin = n.cross(v3(0.0, 1.0, 0.0)).scale(j_impulse * 0.8);
                bodies[i].spin = bodies[i].spin.sub(spin);
                bodies[j].spin = bodies[j].spin.add(spin);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// L'interface. Rien que des nombres.
// ---------------------------------------------------------------------------

/// Réserve de quoi recevoir la description du monde, et rend l'adresse où l'écrire.
#[no_mangle]
pub extern "C" fn world_buffer(len: u32) -> *mut f32 {
    unsafe {
        let scratch = &mut *core::ptr::addr_of_mut!(SCRATCH);
        scratch.clear();
        scratch.resize(len as usize, 0.0);
        scratch.as_mut_ptr()
    }
}

/// Analyse ce qui vient d'être écrit. À rappeler si le monde change.
#[no_mangle]
pub extern "C" fn world_commit() {
    unsafe {
        let scratch = &*core::ptr::addr_of!(SCRATCH);
        WORLD = Some(parse(scratch));
    }
}

/// L'adresse du tableau des corps. Seize flottants chacun, découpage documenté plus haut.
#[no_mangle]
pub extern "C" fn bodies() -> *mut f32 {
    core::ptr::addr_of_mut!(BODIES) as *mut f32
}

#[no_mangle]
pub extern "C" fn capacity() -> u32 {
    CAPACITY as u32
}

/// Avance `count` corps de `dt`.
#[no_mangle]
pub extern "C" fn step(dt: f32, count: u32) {
    let world = match unsafe { &*core::ptr::addr_of!(WORLD) } {
        Some(w) => w,
        None => return,
    };
    if world.cells.is_empty() {
        return;
    }

    let n = (count as usize).min(CAPACITY);
    let slots = unsafe { &mut *core::ptr::addr_of_mut!(BODIES) };

    let mut bodies: Vec<Body> = (0..n)
        .map(|i| read_body(&slots[i * STRIDE..(i + 1) * STRIDE]))
        .collect();

    let mut planes: Vec<(V3, f32)> = Vec::with_capacity(8);
    for body in bodies.iter_mut() {
        if body.cell >= world.cells.len() {
            body.cell = 0;
        }
        step_body(world, body, dt, &mut planes);
    }
    resolve_pairs(&mut bodies);

    for (i, body) in bodies.iter().enumerate() {
        write_body(&mut slots[i * STRIDE..(i + 1) * STRIDE], body);
    }
}
