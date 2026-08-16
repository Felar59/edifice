/**
 * Le rendu des coutures, par récursion.
 *
 * Principe : pour dessiner une cellule, on commence par dessiner, dans des
 * textures séparées, ce qu'on aperçoit à travers chacune de ses bouches ; puis
 * on dessine la cellule elle-même, et on peint chaque ouverture avec l'image
 * correspondante. La récursion se fait en profondeur d'abord, et comme les
 * passes sont encodées dans le même tampon de commandes, l'ordre d'exécution
 * garantit que l'image d'un enfant est prête quand son parent la lit.
 *
 * Deux choix méritent d'être explicités :
 *
 *  — **Textures plein écran plutôt que stencil.** Le rendu par stencil évite les
 *    textures intermédiaires mais devient rapidement inextricable au-delà de
 *    deux niveaux. Avec des cibles de la taille de la fenêtre, la caméra
 *    virtuelle garde exactement la même projection en x et y, donc le pixel
 *    cherché est au même endroit à l'écran : un `textureLoad` à la position du
 *    fragment est exact, sans interpolation ni dérive d'un demi-pixel.
 *
 *  — **Plan proche oblique.** Sans lui, la paroi qui contient la bouche de
 *    sortie apparaît en tranche dès qu'on approche le visage de l'ouverture.
 *    C'est le défaut qui trahit immédiatement un portail bricolé. Voir
 *    `mat4.obliqueNear`.
 */

import {
  copy,
  create,
  invertRigid,
  multiply,
  obliqueNear,
  origin,
  perspective,
  transformDir,
  type Mat4,
} from '../math/mat4'
import type { F32 } from '../f32'
import { add, dot, neg, sub, type Vec3 } from '../math/vec3'
import { cameraToWorld, type Camera } from './camera'

export type { Camera }
import { FLOATS_PER_VERTEX } from '../world/geometry'
import { MAX_LIGHTS, MAX_MOUTH_LIGHTS } from '../world/light'
import type { Pictures } from './pictures'

/**
 * La disposition du bloc uniforme de scène, en flottants, déduite des deux plafonds.
 *
 * Elle l'était en chiffres écrits à la main, ce qui tenait tant que les plafonds ne
 * bougeaient pas. Le jour où l'escalier a demandé douze lampes, les ouvertures se seraient
 * retrouvées lues six lampes trop tôt — et le nuanceur aurait éclairé la salle avec des
 * morceaux de position de lampe.
 */
const HEADER_FLOATS = 56
const MOUTH_BLOCK = HEADER_FLOATS + MAX_LIGHTS * 8
const SCENE_FLOATS = MOUTH_BLOCK + MAX_MOUTH_LIGHTS * 16
import type { Cell, Mouth, Passage, World } from '../world/types'
import sceneShader from '../shaders/scene.wgsl?raw'
import portalShader from '../shaders/portal.wgsl?raw'

const OFFSCREEN_FORMAT: GPUTextureFormat = 'rgba8unorm'
/**
 * Un tampon de profondeur **flottant**, et lu à l'envers.
 *
 * Vingt-quatre bits entiers répartissent leur précision uniformément dans l'espace projeté,
 * c'est-à-dire presque toute contre le plan proche. Un flottant, lui, est dense près de zéro
 * — et l'on met donc le lointain à zéro. Voir `perspective` : c'est là que l'inversion se
 * fait, et c'est ce qui a fait cesser le clignotement des tableaux vus de loin.
 */
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float'
/**
 * Un bloc d'uniformes de scène porte l'éclairage de la cellule : ses lampes et ses
 * ouvertures. Sa taille se déduit des deux plafonds et s'aligne sur 256, comme le veut le
 * décalage dynamique. Les portails, eux, se contentent toujours de 256.
 */
const SCENE_BYTES = SCENE_FLOATS * 4
const SCENE_STRIDE = Math.ceil(SCENE_BYTES / 256) * 256
const PORTAL_STRIDE = 256

/** Fond, et couleur du brouillard : c'est aussi ce qui masque la coupure de récursion. */
export const FOG_COLOR: readonly [number, number, number] = [0.055, 0.056, 0.065]
const FOG_DENSITY = 0.014

/**
 * La même couleur, encodée en gamma.
 *
 * Les nuanceurs calculent en linéaire puis encodent avant d'écrire ; une valeur
 * d'effacement, elle, part telle quelle dans la cible. Effacer avec la couleur
 * linéaire donnait donc un fond presque noir là où le brouillard, lui, est un gris
 * sombre — et toute zone non couverte tranchait violemment au lieu de se confondre
 * avec l'éloignement.
 */
/**
 * La couleur d'effacement d'une cellule, encodée comme le fait le nuanceur.
 *
 * Le format du canevas n'est pas sRGB : la scène encode elle-même, et le fond doit encoder
 * pareil, sans quoi le lointain d'une salle trancherait sur le vide qui l'entoure au lieu
 * de s'y fondre.
 */
function clearFor(cell: Cell): GPUColor {
  const haze = cell.fogColour ?? FOG_COLOR
  return { r: haze[0] ** (1 / 2.2), g: haze[1] ** (1 / 2.2), b: haze[2] ** (1 / 2.2), a: 1 }
}

/**
 * Distance du plan proche. Partagée : le rendu des coutures en dépend.
 *
 * Volontairement courte. Toute géométrie plus proche que cette distance est
 * écrêtée, et comme rien ne se trouve derrière une paroi, la zone qu'elle occupait
 * devient la couleur d'effacement — une bande grise pendant le franchissement. Les
 * embrasures écartent le cas courant en éloignant toute surface de l'œil ; quatre
 * millimètres réduisent ce qu'il en reste à une largeur qu'on ne traverse pas.
 *
 * Ce raccourcissement ne coûte rien en précision de profondeur parce que la scène
 * n'a plus aucune surface coplanaire : l'encadrement peint des ouvertures, seul
 * candidat au conflit, a été remplacé par le relief des embrasures.
 */
/**
 * Distance du plan proche.
 *
 * **C'est le réglage qui décide de toute la précision de profondeur**, et il était bien trop
 * petit. Un tampon de profondeur dépense sa précision près de l'œil : à quatre millimètres,
 * le pas de profondeur atteint trois millimètres et demi à quinze mètres — plus que
 * l'épaisseur qui sépare un chiffre de sa plaque. Deux surfaces si voisines se mettent alors
 * à se disputer les pixels **à partir d'une certaine distance et sous certains angles**, ce
 * qui est exactement le défaut qu'on observait : un tableau, un numéro, un sol qui clignotent
 * de loin et se tiennent tranquilles de près.
 *
 * Cinq centimètres divisent ce pas par douze. Le musée le supporte : la collision tient le
 * corps à trente-cinq centimètres des parois, et rien ne s'approche plus près de l'œil qu'un
 * jambage d'embrasure — dont on passe toujours à quarante centimètres au moins. Le seul cas
 * limite, le nez collé à une couture, est traité autrement depuis longtemps : le quad du
 * portail borne sa profondeur à zéro plutôt que de compter sur le plan proche.
 */
const NEAR = 0.05
/**
 * Épaisseur devant l'œil en deçà de laquelle un sommet compte comme derrière.
 *
 * Volontairement minuscule : on ne retire de l'ouverture que ce qui est réellement
 * invisible. Une valeur confortable coûterait cher au pire moment — à un dixième de
 * millimètre du plan, elle supprimait les quatre coins d'un coup, donc l'ouverture
 * entière, donc l'image.
 */
const EYE_EPS = 1e-7

/**
 * Distance au-delà de laquelle on cesse de répéter un objet dans les copies d'un réseau.
 *
 * Dix-huit mètres : au-delà, un cube de trente-quatre centimètres ne pèse plus rien à
 * l'écran, et chaque copie coûte un bloc d'uniformes et un appel de dessin. En deçà, ne pas
 * le répéter se voit tout de suite — une salle qui se répète dont les objets, eux, ne se
 * répètent pas désigne aussitôt laquelle des copies est la vraie.
 */
const OBJECT_REACH = 18

/** Une bouche dont la surface à l'écran tombe sous ce seuil ne mérite pas une passe. */
const MIN_COVERAGE = 0.00004

export interface DynObject {
  cell: string
  model: Mat4
}

export interface RenderStats {
  passes: number
  /** Copies de réseau dessinées : le coût de la salle pavée. */
  copies: number
  deepest: number
  skipped: number
  /**
   * Surface réellement dessinée, en écrans : la somme des cisailles.
   *
   * Sans la cisaille, ce nombre vaudrait `passes` — chaque passe coûtait l'écran entier.
   * C'est la mesure directe du remplissage économisé, et c'est le chiffre à regarder
   * quand une machine peine.
   */
  fill: number
}

/** Un rectangle d'écran, en pixels de cible : la cisaille d'une passe de couture. */
interface Scissor {
  x: number
  y: number
  w: number
  h: number
}

interface Target {
  color: GPUTexture
  colorView: GPUTextureView
  depth: GPUTexture
  depthView: GPUTextureView
}

interface CellMesh {
  buffer: GPUBuffer
  vertexCount: number
}

export class Renderer {
  /**
   * Profondeur de récursion maximale.
   *
   * Douze, et non trois : depuis que le budget de passes se dépense par ordre de surface à
   * l'écran, c'est lui qui borne le travail, et la profondeur n'est plus qu'un garde-fou. La
   * salle pavée y gagne tout — son couloir de copies s'enfonçait sur trois longueurs, avec
   * un mur gris au bout ; il s'enfonce maintenant jusqu'à ce que le brouillard s'en charge.
   */
  maxDepth = 12
  /** Garde-fou : plafond du nombre de passes par image. */
  maxPasses = 24
  fovY = (72 * Math.PI) / 180
  /**
   * Coupe les matières : tout devient aplat, sans motif ni image.
   *
   * C'est un outil de diagnostic, et le seul moyen honnête de trancher une question qu'on ne
   * peut pas trancher à l'œil — un scintillement qui survit à l'aplat vient de la géométrie
   * ou de la profondeur, jamais de la texture.
   */
  flat = false
  /**
   * Facteur appliqué à la lumière que les ouvertures transmettent.
   *
   * Existe pour être **mesurable**. Rien ne casse visiblement quand la transmission
   * disparaît : les images restent contrastées et colorées, simplement fausses. Et
   * on ne peut pas la déduire de la couleur d'une image, parce que le sol devant une
   * porte se refroidit surtout parce qu'on *voit* la pièce froide au travers. Le seul
   * moyen honnête d'isoler la transmission est de comparer la même pose avec et sans.
   */
  transmission = 1

  private readonly device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly canvasFormat: GPUTextureFormat

  private readonly sceneLayout: GPUBindGroupLayout
  private readonly portalUniformLayout: GPUBindGroupLayout
  private readonly portalTextureLayout: GPUBindGroupLayout
  private readonly sceneModule: GPUShaderModule
  private readonly portalModule: GPUShaderModule
  private readonly scenePipelines = new Map<string, GPURenderPipeline>()
  private readonly portalPipelines = new Map<string, GPURenderPipeline>()

  private readonly sceneUniforms: Ring
  private readonly portalUniforms: Ring
  private readonly sceneBindGroup: GPUBindGroup
  private readonly pictureLayout: GPUBindGroupLayout
  private pictureBindGroup: GPUBindGroup | null = null
  private readonly portalUniformBindGroup: GPUBindGroup
  private readonly textureBindGroups = new WeakMap<GPUTextureView, GPUBindGroup>()
  private readonly blankBindGroup: GPUBindGroup

  private world: World | null = null
  private readonly meshes = new Map<string, CellMesh>()
  private objectMesh: CellMesh | null = null

  private width = 1
  private height = 1
  private mainDepth: Target | null = null
  private readonly freeTargets: Target[] = []
  private readonly allTargets: Target[] = []

  private stats: RenderStats = { passes: 0, deepest: 0, skipped: 0, copies: 0, fill: 0 }

  // Matrices réutilisées d'une image sur l'autre : rien ici ne doit allouer par
  // image, sinon le ramasse-miettes se réveille au pire moment.
  private readonly proj = create()
  private readonly lastViewProj = create()
  private readonly scratch = new Float32Array(Math.max(SCENE_FLOATS, 240))

  constructor(device: GPUDevice, context: GPUCanvasContext, canvasFormat: GPUTextureFormat) {
    this.device = device
    this.context = context
    this.canvasFormat = canvasFormat

    this.sceneLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SCENE_BYTES },
        },
      ],
    })
    this.pictureLayout = device.createBindGroupLayout({
      label: 'tableaux',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d-array' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    })
    this.portalUniformLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 176 },
        },
      ],
    })
    this.portalTextureLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
        },
      ],
    })

    this.sceneModule = device.createShaderModule({ code: sceneShader, label: 'scene' })
    this.portalModule = device.createShaderModule({ code: portalShader, label: 'portal' })

    // Deux mille blocs : une salle en réseau en consomme un par copie et par objet, et
    // dépasser la capacité ne se voit pas — l'anneau repart au début et réécrit par-dessus
    // des blocs déjà encodés, si bien que des salles entières se dessinent avec l'éclairage
    // d'une autre. Mieux vaut trois mégaoctets qu'une corruption silencieuse.
    this.sceneUniforms = new Ring(device, SCENE_STRIDE, 2048, 'uniformes de scène')
    this.portalUniforms = new Ring(device, PORTAL_STRIDE, 256, 'uniformes de portail')

    this.sceneBindGroup = device.createBindGroup({
      layout: this.sceneLayout,
      entries: [{ binding: 0, resource: { buffer: this.sceneUniforms.buffer, size: SCENE_BYTES } }],
    })
    this.portalUniformBindGroup = device.createBindGroup({
      layout: this.portalUniformLayout,
      entries: [{ binding: 0, resource: { buffer: this.portalUniforms.buffer, size: 176 } }],
    })

    // Une texture 1×1 pour les cas de repli : WGSL exige que la liaison existe,
    // même quand le nuanceur ne la lit pas.
    const blank = device.createTexture({
      size: [1, 1],
      format: OFFSCREEN_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.blankBindGroup = device.createBindGroup({
      layout: this.portalTextureLayout,
      entries: [{ binding: 0, resource: blank.createView() }],
    })
  }

  /** Les images accrochées aux murs. À poser avant la première image, sinon rien ne s'affiche. */
  setPictures(pictures: Pictures): void {
    this.pictureBindGroup = this.device.createBindGroup({
      label: 'tableaux',
      layout: this.pictureLayout,
      entries: [
        { binding: 0, resource: pictures.view },
        { binding: 1, resource: pictures.sampler },
      ],
    })
  }

  setWorld(world: World, objectVerts: F32): void {
    this.world = world
    for (const mesh of this.meshes.values()) mesh.buffer.destroy()
    this.meshes.clear()
    for (const cell of world.cells.values()) {
      this.meshes.set(cell.id, this.upload(cell.verts, `cellule ${cell.id}`))
    }
    this.objectMesh?.buffer.destroy()
    this.objectMesh = this.upload(objectVerts, 'objet')
  }

  private upload(verts: F32, label: string): CellMesh {
    const buffer = this.device.createBuffer({
      label,
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(buffer, 0, verts)
    return { buffer, vertexCount: verts.length / FLOATS_PER_VERTEX }
  }

  /**
   * Où un point de la salle courante tombe sur l'écran, en pixels de mise en page.
   *
   * Le musée en a besoin pour une seule chose, et elle vaut la peine : faire naître l'image
   * d'une machine **à l'endroit exact de son écran** avant de l'agrandir jusqu'au bord de la
   * page. Sans cette mesure, l'agrandissement partirait du centre et l'on verrait une image
   * apparaître ; avec elle, on entre dans la borne qu'on regarde.
   *
   * Rend `null` derrière l'œil, où la projection ne veut plus rien dire.
   */
  ouOnRegarde(point: Vec3, dpr: number): { x: number; y: number } | null {
    const m = this.lastViewProj
    const x = m[0]! * point.x + m[4]! * point.y + m[8]! * point.z + m[12]!
    const y = m[1]! * point.x + m[5]! * point.y + m[9]! * point.z + m[13]!
    const w = m[3]! * point.x + m[7]! * point.y + m[11]! * point.z + m[15]!
    if (w <= 1e-4) return null
    return {
      x: ((x / w) * 0.5 + 0.5) * (this.width / dpr),
      y: (0.5 - (y / w) * 0.5) * (this.height / dpr),
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)

    for (const t of this.allTargets) {
      t.color.destroy()
      t.depth.destroy()
    }
    this.allTargets.length = 0
    this.freeTargets.length = 0

    this.mainDepth?.depth.destroy()
    const depth = this.device.createTexture({
      label: 'profondeur principale',
      size: [this.width, this.height],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    // Seul le tampon de profondeur est utile ici : la couleur est la texture du
    // canvas, fournie par le contexte à chaque image.
    this.mainDepth = {
      color: depth,
      colorView: depth.createView(),
      depth,
      depthView: depth.createView(),
    }
  }

  getStats(): RenderStats {
    return this.stats
  }

  render(camera: Camera, objects: DynObject[]): void {
    const world = this.world
    if (!world || !this.mainDepth) return
    const cell = world.cells.get(camera.cell)
    if (!cell) throw new Error(`Cellule inconnue : ${camera.cell}`)

    this.stats = { passes: 0, deepest: 0, skipped: 0, copies: 0, fill: 0 }
    this.sceneUniforms.reset()
    this.portalUniforms.reset()

    perspective(this.proj, this.fovY, this.width / this.height, NEAR, 300)

    const camWorld = cameraToWorld(camera)
    // Gardée pour `ouOnRegarde` : le musée s'en sert pour savoir où un objet de la salle
    // atterrit sur l'écran, et faire grandir une image depuis exactement cet endroit.
    multiply(this.lastViewProj, this.proj, invertRigid(create(), camWorld))

    const encoder = this.device.createCommandEncoder({ label: 'image' })
    const canvasView = this.context.getCurrentTexture().createView()

    this.renderNode(
      encoder,
      cell,
      camWorld,
      this.proj,
      0,
      { colorView: canvasView, depthView: this.mainDepth.depthView },
      objects,
      world,
      this.maxPasses,
    )

    this.device.queue.submit([encoder.finish()])
  }

  /**
   * Le rectangle d'ecran, en pixels de cible, ou une passe de couture a le droit d'ecrire.
   * Voir le parametre `scissor` de renderNode.
   */
  private renderNode(
    encoder: GPUCommandEncoder,
    cell: Cell,
    camWorld: Mat4,
    proj: Mat4,
    depth: number,
    target: { colorView: GPUTextureView; depthView: GPUTextureView },
    objects: DynObject[],
    world: World,
    /**
     * Nombre de passes que ce sous-arbre a le droit de consommer, celle-ci comprise.
     *
     * **Le budget se partage, il ne se dispute pas.** Sans quota, la première ouverture
     * traitée s'enfonçait aussi loin que le budget le permettait et le vidait pour ses
     * sœurs. Dans une salle en réseau, où l'on voit vingt portes identiques, cela donnait
     * deux portes montrant la rotonde et dix-huit trous noirs — c'est-à-dire l'illusion
     * exactement à l'envers : la copie où l'on se tient devenait la seule vraie.
     *
     * Chaque enfant reçoit donc une part de ce qui reste. Là où il y a peu d'ouvertures, la
     * part est grosse et la récursion s'enfonce ; là où il y en a vingt, chacune a droit à
     * son image, et c'est tout ce qu'on lui demande.
     */
    quota = Infinity,
    /**
     * Le rectangle d'écran hors duquel cette passe est illisible — la **cisaille**.
     *
     * Une passe de couture peint dans une cible plein écran, mais le parent ne la lit
     * qu'à travers sa porte : tout pixel calculé hors du rectangle de cette porte est
     * du travail jeté. Une porte à dix pas couvre un dixième de l'écran ; sans la
     * cisaille, sa passe coûte l'écran entier — et la récursion multiplie ce gâchis à
     * chaque profondeur. C'est le levier de remplissage le plus lourd du moteur, et il
     * ne change pas un pixel : on renonce seulement à calculer ceux que personne ne lit.
     */
    scissor: Scissor | null = null,
  ): void {
    this.stats.deepest = Math.max(this.stats.deepest, depth)
    this.stats.passes++
    this.stats.fill += scissor ? (scissor.w * scissor.h) / (this.width * this.height) : 1
    const spentAtEntry = this.stats.passes

    const camPos = origin(camWorld)
    const view = invertRigid(create(), camWorld)
    const viewProj = multiply(create(), proj, view)

    // --- 1. Ce qu'on voit à travers chaque bouche, d'abord. ------------------
    //
    // Trois états, et non deux. La distinction entre « invisible » et « visible
    // sans image » est le point qui a coûté le plus cher à comprendre :
    //
    //   invisible — la caméra est derrière la bouche, ou la bouche est hors du
    //     champ. **On ne dessine rien.** Vue de dos, une bouche n'est pas une
    //     surface, c'est un trou. La peindre serait catastrophique : la bouche de
    //     sortie occupe à l'écran exactement la zone que le parent s'apprête à
    //     lire, si bien qu'un aplat posé là recouvre toute l'image utile.
    //
    //   sans image — la bouche est bien visible, mais le budget de récursion est
    //     épuisé. On peint la couleur du brouillard, qui se confond avec
    //     l'éloignement.
    //
    //   avec image — le cas normal.
    // Direction du regard, reprise de la matrice de la caméra, dont le troisième axe
    // est l'opposé du regard.
    const viewFwd = { x: -camWorld[8]!, y: -camWorld[9]!, z: -camWorld[10]! }

    const children: {
      passage: Passage
      /** La copie du réseau où se trouve cette ouverture — nulle partout ailleurs. */
      shift: Vec3
      target: Target | null
      visible: boolean
      polygon: Vec3[]
      /** Fraction de l'écran couverte : c'est elle qui décide de l'ordre des passes. */
      cover: number
      /** Le rectangle d'écran où cette ouverture peut se voir : la cisaille de sa passe. */
      clip: Scissor | null
    }[] = []

    // **Chaque copie a sa porte, et chaque porte donne sur la rotonde.**
    //
    // Une salle en réseau est dessinée autant de fois qu'elle a de copies visibles ; ses
    // ouvertures le sont donc aussi, et chacune doit montrer ce qu'il y a derrière. Ne
    // rendre que celle de la copie centrale laissait toutes les autres en trou noir : on
    // s'approchait, la rotonde apparaissait dans l'encadrement, et l'illusion tombait — la
    // copie où l'on se tient cessait d'être une copie comme les autres.
    //
    // Le coût reste borné par le budget de passes, qui se dépense par ordre de surface à
    // l'écran : les portes proches ont leur image, les lointaines s'éteignent dans le
    // brouillard, et c'est exactement ce qu'on veut d'une porte à quarante mètres.
    const shifts = this.lattice(cell, camPos, viewFwd)
    for (const passage of cell.passages) {
      // **Une couture de réseau ne se dessine pas.** Ce qu'elle montrerait — la salle
      // voisine, c'est-à-dire la même — est déjà dessiné, et bien mieux : par la copie
      // suivante du réseau, sans passe plein écran et sans coupure au bout de trois
      // longueurs. Elle continue de servir au déplacement, et à lui seul.
      if (cell.lattice && passage.to.cell === cell.id) continue

      for (const shift of shifts) {
        const mouth = moved(passage.from, shift)
        const dist = dot(mouth.normal, sub(camPos, mouth.center))

        // Le seuil sur la distance est zéro, et non un epsilon confortable : écarter
        // une bouche dont on n'est qu'à un dixième de millimètre revenait à ne rien
        // dessiner pendant l'image du franchissement, c'est-à-dire au pire moment.
        const polygon = dist <= 0 ? [] : this.mouthPolygon(mouth, camPos, viewFwd)
        const cover = polygon.length < 3 ? 0 : this.coverage(polygon, viewProj)
        // Le rectangle d'écran de l'ouverture, rogné par celui de la passe courante. S'il
        // est vide, l'ouverture est certes dans le champ — mais dans une zone de l'image
        // que personne ne lira : à travers la porte du parent, elle n'apparaît pas.
        const clip = cover <= 0 ? null : this.clipFor(polygon, viewProj, scissor)
        const seen = cover > 0 && clip !== null
        children.push({ passage, shift, target: null, visible: seen, polygon, cover, clip })
      }
    }

    // **Le budget va d'abord à ce qui occupe le plus d'écran.**
    //
    // La récursion est en profondeur d'abord, et le nombre de passes par image est plafonné.
    // Prises dans l'ordre où elles sont déclarées, une bouche minuscule pouvait donc épuiser
    // le budget en s'enfonçant, et laisser sans image celle qui remplit la moitié de l'écran
    // — un aplat de brouillard à deux mètres du visiteur, alors que le fond du couloir était
    // dessiné jusqu'au bout. Trié, le budget se dépense là où il se voit, et s'épuiser ne
    // coûte plus que les lointains, c'est-à-dire ce que le brouillard efface déjà.
    const ranked = [...children].filter((c) => c.visible).sort((a, b) => b.cover - a.cover)
    let waiting = ranked.length
    for (const child of ranked) {
      const mine = quota - (this.stats.passes - spentAtEntry) - 1
      const share = Math.max(1, Math.floor(mine / waiting))
      waiting--
      if (
        depth >= this.maxDepth ||
        this.stats.passes >= this.maxPasses ||
        mine < 1 ||
        child.cover < MIN_COVERAGE
      ) {
        this.stats.skipped++
        continue
      }
      const target = this.acquireTarget()
      // Ce qu'on voit par la porte d'une copie décalée de `s`, c'est ce qu'on verrait par
      // la porte de la copie centrale depuis un point reculé de `s`.
      const through =
        child.shift === ORIGIN
          ? child.passage.transform
          : multiply(create(), child.passage.transform, translation(neg(child.shift)))
      const childCam = multiply(create(), through, camWorld)
      const childProj = this.obliqueFor(proj, child.passage.to, childCam)
      const destCell = world.cells.get(child.passage.to.cell)
      if (!destCell) throw new Error(`Cellule de destination inconnue : ${child.passage.to.cell}`)
      this.renderNode(
        encoder,
        destCell,
        childCam,
        childProj,
        depth + 1,
        target,
        objects,
        world,
        share,
        child.clip,
      )
      child.target = target
    }

    // --- 2. Puis la cellule elle-même. --------------------------------------
    const pass = encoder.beginRenderPass({
      label: `cellule ${cell.id} · profondeur ${depth}`,
      colorAttachments: [
        {
          view: target.colorView,
          // Le fond prend la couleur du brouillard **de cette cellule** : c'est ce qui
          // fait que le lointain d'une salle et son fond d'écran ne se distinguent pas.
          clearValue: clearFor(cell),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: target.depthView,
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    })

    // La cisaille. Elle borne tout ce que la passe dessine — la scene, les objets, les
    // quads d'ouverture — au rectangle que le parent lira. L'effacement, lui, couvre
    // toute la cible : c'est une operation de tuiles, quasi gratuite, et la garder
    // pleine evite de gerer des restes d'images precedentes hors du rectangle.
    if (scissor) pass.setScissorRect(scissor.x, scissor.y, scissor.w, scissor.h)

    const colorFormat = depth === 0 ? this.canvasFormat : OFFSCREEN_FORMAT
    const scenePipeline = this.scenePipeline(colorFormat)
    pass.setPipeline(scenePipeline)
    if (this.pictureBindGroup) pass.setBindGroup(1, this.pictureBindGroup)

    const mesh = this.meshes.get(cell.id)
    if (mesh) {
      pass.setVertexBuffer(0, mesh.buffer)
      // `shifts` est déjà calculé plus haut pour les ouvertures : le recalculer ici
      // refaisait tout le quadrillage du réseau une seconde fois par passe.
      for (const shift of shifts) {
        const model = translation(shift)
        const offset = this.writeSceneUniforms(viewProj, model, camPos, cell, shift)
        pass.setBindGroup(0, this.sceneBindGroup, [offset])
        pass.draw(mesh.vertexCount)
        this.stats.copies++
      }
    }

    // Les objets ne sont dessinés que dans la cellule où ils se trouvent — ce qui
    // suffit à ce qu'un objet lancé de l'autre côté d'une couture apparaisse
    // naturellement à travers l'ouverture, sans traitement particulier.
    if (this.objectMesh) {
      for (const obj of objects) {
        if (obj.cell !== cell.id) continue
        // Un cube posé dans une salle qui se répète se répète avec elle : ne dessiner que
        // le sien reviendrait à dire laquelle des copies est la vraie.
        // Les objets se répètent comme la salle, mais on s'arrête à ce qui se voit encore.
        // Un cube fait trente-quatre centimètres : au-delà de vingt-cinq mètres il ne couvre
        // plus grand-chose, et le dessiner coûterait un bloc d'uniformes par copie.
        for (const shift of shifts) {
          const dx = obj.model[12]! + shift.x - camPos.x
          const dy = obj.model[13]! + shift.y - camPos.y
          const dz = obj.model[14]! + shift.z - camPos.z
          if (dx * dx + dy * dy + dz * dz > OBJECT_REACH * OBJECT_REACH) continue
          const model = multiply(create(), translation(shift), obj.model)
          const offset = this.writeSceneUniforms(viewProj, model, camPos, cell, shift)
          pass.setBindGroup(0, this.sceneBindGroup, [offset])
          pass.setVertexBuffer(0, this.objectMesh.buffer)
          pass.draw(this.objectMesh.vertexCount)
        }
      }
    }

    // --- 3. Les ouvertures, peintes avec l'image de l'autre côté. ------------
    pass.setPipeline(this.portalPipeline(colorFormat))
    for (const { passage, target: child, visible, polygon } of children) {
      if (!visible) continue
      const offset = this.writePortalUniforms(
        viewProj,
        polygon,
        child !== null,
        child ? FOG_COLOR : this.behind(passage, polygon, camPos, cell),
      )
      pass.setBindGroup(0, this.portalUniformBindGroup, [offset])
      pass.setBindGroup(1, child ? this.textureBindGroup(child.colorView) : this.blankBindGroup)
      // Trois triangles en éventail : de quoi couvrir cinq sommets.
      pass.draw(9)
    }

    pass.end()

    for (const { target: child } of children) if (child) this.releaseTarget(child)
  }

  /**
   * Projection de la caméra virtuelle, dont le plan proche est remplacé par le
   * plan de la bouche de sortie.
   */
  private obliqueFor(proj: Mat4, dest: Mouth, childCam: Mat4): Mat4 {
    const childView = invertRigid(create(), childCam)
    const n = transformDir(childView, dest.normal)
    const camPos = origin(childCam)
    const w = dot(dest.normal, sub(camPos, dest.center))

    // Plan de coupe quasi confondu avec la caméra : on renonce, et c'est correct.
    //
    // Le plan proche oblique existe pour écarter ce qui se trouve **entre** la
    // caméra virtuelle et la bouche de sortie. Quand la caméra est déjà sur cette
    // bouche — c'est-à-dire pendant l'image où le visiteur franchit la couture — il
    // n'y a rien entre les deux, donc rien à écarter : la paroi qui porte la bouche
    // est coplanaire, et son dos est de toute façon écarté par le tri des faces.
    //
    // L'appliquer quand même serait pire que superflu, ce serait destructeur. La
    // troisième ligne de la matrice devient alors l'opposée de la quatrième, tous
    // les fragments atterrissent exactement sur le plan lointain, la comparaison de
    // profondeur `less` échoue partout, et la passe ne dessine rien : un aplat de
    // la couleur d'effacement, précisément à l'instant le plus visible.
    if (Math.abs(w) < NEAR) return copy(create(), proj)

    return obliqueNear(create(), proj, { x: n.x, y: n.y, z: n.z, w })
  }

  /**
   * Silhouette visible d'une bouche : le quadrilatère de l'ouverture, découpé contre
   * le demi-espace situé devant l'œil.
   *
   * Nécessaire parce qu'un sommet derrière l'œil n'a pas de projection utilisable, et
   * que le laisser au nuanceur fausse la silhouette : debout dans une embrasure, le
   * regard incliné, deux coins de l'ouverture passent derrière l'œil, et l'arête qui
   * les relie aux coins de devant traverse alors le plan proche au mauvais endroit.
   * C'était la cause d'une bande de quelques millimètres, dans une plage
   * d'inclinaisons étroite, où l'image se vidait.
   *
   * Le reste — dessiner une ouverture plus proche que le plan proche — se règle dans
   * le nuanceur en bornant la profondeur, ce qui ne déplace aucun sommet.
   *
   * Un quadrilatère convexe coupé par un demi-espace donne au plus cinq sommets.
   */
  private mouthPolygon(mouth: Mouth, camPos: Vec3, viewFwd: Vec3): Vec3[] {
    const depthOf = (p: Vec3): number =>
      (p.x - camPos.x) * viewFwd.x + (p.y - camPos.y) * viewFwd.y + (p.z - camPos.z) * viewFwd.z

    const corners: Vec3[] = []
    const signs: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    for (const [sx, sy] of signs) {
      corners.push({
        x: mouth.center.x + mouth.right.x * mouth.halfWidth * sx + mouth.up.x * mouth.halfHeight * sy,
        y: mouth.center.y + mouth.right.y * mouth.halfWidth * sx + mouth.up.y * mouth.halfHeight * sy,
        z: mouth.center.z + mouth.right.z * mouth.halfWidth * sx + mouth.up.z * mouth.halfHeight * sy,
      })
    }

    // Sutherland-Hodgman contre un seul plan : celui du regard, juste devant l'œil.
    const kept: Vec3[] = []
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]!
      const b = corners[(i + 1) % corners.length]!
      const da = depthOf(a)
      const db = depthOf(b)
      const inA = da >= EYE_EPS
      const inB = db >= EYE_EPS
      if (inA) kept.push(a)
      if (inA !== inB) {
        const t = (EYE_EPS - da) / (db - da)
        kept.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        })
      }
    }

    return kept
  }

  /**
   * Fraction de l'écran couverte par la bouche, en très gros.
   *
   * Les coins sont repoussés au-delà du plan proche exactement comme le fait le
   * nuanceur, et pour la même raison : sans cela, une ouverture qu'on a sous le nez
   * a ses quatre coins derrière le plan proche, sa boîte englobante est vide, et on
   * la déclare invisible au moment même où elle occupe tout l'écran. Repousser un
   * point le long de son rayon ne change pas sa projection, donc la mesure reste
   * juste.
   */
  /**
   * Le rectangle d'écran d'une ouverture, rogné par la cisaille de la passe courante.
   *
   * C'est la même projection que `coverage`, mais rendue en pixels et intersectée : le
   * résultat borne la passe de l'enfant. Deux pixels de marge absorbent les arrondis de
   * rastérisation — le quad de l'ouverture ne peut pas déborder d'un demi-pixel que la
   * cisaille aurait coupé.
   *
   * Rend `null` quand l'intersection est vide : l'ouverture est dans le champ, mais dans
   * une zone de l'image que le parent ne lira jamais — il n'y a alors ni passe à faire,
   * ni quad à peindre.
   */
  private clipFor(polygon: Vec3[], viewProj: Mat4, parent: Scissor | null): Scissor | null {
    const whole: Scissor = { x: 0, y: 0, w: this.width, h: this.height }
    const outer = parent ?? whole

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const p of polygon) {
      const cw = viewProj[3]! * p.x + viewProj[7]! * p.y + viewProj[11]! * p.z + viewProj[15]!
      // Un sommet posé presque sur l'œil : l'ouverture couvre tout ce que le parent couvre.
      if (cw <= 1e-6) return outer
      const ndcX = (viewProj[0]! * p.x + viewProj[4]! * p.y + viewProj[8]! * p.z + viewProj[12]!) / cw
      const ndcY = (viewProj[1]! * p.x + viewProj[5]! * p.y + viewProj[9]! * p.z + viewProj[13]!) / cw
      if (ndcX < minX) minX = ndcX
      if (ndcX > maxX) maxX = ndcX
      if (ndcY < minY) minY = ndcY
      if (ndcY > maxY) maxY = ndcY
    }

    // NDC vers pixels — l'axe y se retourne — puis marge et intersection.
    const x0 = Math.max(outer.x, Math.floor(((minX + 1) / 2) * this.width) - 2)
    const x1 = Math.min(outer.x + outer.w, Math.ceil(((maxX + 1) / 2) * this.width) + 2)
    const y0 = Math.max(outer.y, Math.floor(((1 - maxY) / 2) * this.height) - 2)
    const y1 = Math.min(outer.y + outer.h, Math.ceil(((1 - minY) / 2) * this.height) + 2)

    const x = Math.max(0, Math.min(this.width, x0))
    const y = Math.max(0, Math.min(this.height, y0))
    const w = Math.max(0, Math.min(this.width, x1) - x)
    const h = Math.max(0, Math.min(this.height, y1) - y)
    if (w <= 0 || h <= 0) return null
    return { x, y, w, h }
  }

  private coverage(polygon: Vec3[], viewProj: Mat4): number {
    if (polygon.length < 3) return 0

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const p of polygon) {
      const cw = viewProj[3]! * p.x + viewProj[7]! * p.y + viewProj[11]! * p.z + viewProj[15]!
      // Après découpage, aucun sommet n'est derrière l'œil, mais un sommet posé
      // presque sur l'œil donne une projection démesurée : dans ce cas la bouche
      // couvre tout l'écran, et c'est ce qu'on renvoie.
      if (cw <= 1e-6) return 1
      const ndcX = (viewProj[0]! * p.x + viewProj[4]! * p.y + viewProj[8]! * p.z + viewProj[12]!) / cw
      const ndcY = (viewProj[1]! * p.x + viewProj[5]! * p.y + viewProj[9]! * p.z + viewProj[13]!) / cw
      if (ndcX < minX) minX = ndcX
      if (ndcX > maxX) maxX = ndcX
      if (ndcY < minY) minY = ndcY
      if (ndcY > maxY) maxY = ndcY
    }

    const w = Math.min(maxX, 1) - Math.max(minX, -1)
    const h = Math.min(maxY, 1) - Math.max(minY, -1)
    if (w <= 0 || h <= 0) return 0
    return (w * h) / 4
  }

  /**
   * Les décalages des copies à dessiner pour cette cellule.
   *
   * Une seule, nulle, pour toutes les salles ordinaires. Pour une salle en réseau, la grille
   * des copies, débarrassée de ce qui est franchement derrière l'œil ou au-delà de
   * l'horizon : dessiner ce qui ne peut pas se voir coûterait autant que le reste, et le
   * reste est déjà presque gratuit.
   */
  private lattice(cell: Cell, camPos: Vec3, viewFwd: Vec3, cap = Infinity): Vec3[] {
    if (!cell.lattice) return [ORIGIN]
    const { x: stepX, z: stepZ } = cell.lattice
    const radius = Math.min(cell.lattice.radius, cap)
    const centre = {
      x: (cell.min.x + cell.max.x) / 2,
      y: (cell.min.y + cell.max.y) / 2,
      z: (cell.min.z + cell.max.z) / 2,
    }
    const half = Math.hypot(cell.max.x - cell.min.x, cell.max.z - cell.min.z) / 2
    const reach = 3 / (cell.fog ?? FOG_DENSITY) + half

    const out: Vec3[] = []
    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        const shift = { x: i * stepX, y: 0, z: j * stepZ }
        const to = {
          x: centre.x + shift.x - camPos.x,
          y: centre.y - camPos.y,
          z: centre.z + shift.z - camPos.z,
        }
        const d = Math.hypot(to.x, to.y, to.z)
        if (d > reach) continue
        // Franchement derrière : la copie où l'on se tient et ses voisines immédiates
        // restent, puisqu'on en voit toujours un morceau de côté.
        if (d > half * 2 && dot(to, viewFwd) < 0) continue
        out.push(shift)
      }
    }
    return out
  }

  private writeSceneUniforms(
    viewProj: Mat4,
    model: Mat4,
    camPos: Vec3,
    cell: Cell,
    /** Décalage de la copie de réseau qu'on dessine, nul pour tout le reste. */
    shift: Vec3 = ORIGIN,
  ): number {
    const s = this.scratch
    s.set(viewProj, 0)
    s.set(model, 16)
    s[32] = camPos.x; s[33] = camPos.y; s[34] = camPos.z; s[35] = 1
    // La densité du brouillard peut être propre à la cellule. Une salle qui se répète sans
    // fin a besoin d'un horizon plus proche que les autres : c'est le brouillard, et lui
    // seul, qui rend la coupure de récursion invisible.
    const haze = cell.fogColour ?? FOG_COLOR
    s[36] = haze[0]; s[37] = haze[1]; s[38] = haze[2]
    s[39] = cell.fog ?? FOG_DENSITY

    const { ambient, lights } = cell.lighting
    s[40] = ambient[0]; s[41] = ambient[1]; s[42] = ambient[2]; s[43] = 0

    const lightCount = Math.min(lights.length, MAX_LIGHTS)
    const mouthCount = Math.min(cell.passages.length, MAX_MOUTH_LIGHTS)
    s[44] = lightCount; s[45] = mouthCount; s[46] = this.flat ? 1 : 0; s[47] = 0
    s[48] = shift.x; s[49] = shift.y; s[50] = shift.z; s[51] = 0
    // Une bande dégénérée dit au nuanceur de s'en passer : voir `evenFog`.
    s[52] = cell.evenFog ? 0 : cell.min.y
    s[53] = cell.evenFog ? 0 : cell.max.y
    s[54] = 0; s[55] = 0

    for (let i = 0; i < MAX_LIGHTS; i++) {
      const o = HEADER_FLOATS + i * 8
      const light = i < lightCount ? lights[i]! : null
      if (!light) {
        s.fill(0, o, o + 8)
        continue
      }
      s[o] = light.position.x
      s[o + 1] = light.position.y
      s[o + 2] = light.position.z
      s[o + 3] = light.radius
      s[o + 4] = light.colour[0]
      s[o + 5] = light.colour[1]
      s[o + 6] = light.colour[2]
      s[o + 7] = light.intensity
    }

    // Chaque ouverture de la cellule devient une lampe rectangulaire portant la
    // lumière de la pièce d'en face. Les demi-dimensions voyagent dans la longueur
    // des vecteurs, ce qui évite deux flottants de plus.
    for (let i = 0; i < MAX_MOUTH_LIGHTS; i++) {
      const o = MOUTH_BLOCK + i * 16
      const passage = i < mouthCount ? cell.passages[i]! : null
      if (!passage) {
        s.fill(0, o, o + 16)
        continue
      }
      const m = passage.from
      s[o] = m.center.x; s[o + 1] = m.center.y; s[o + 2] = m.center.z; s[o + 3] = 0
      s[o + 4] = m.right.x * m.halfWidth
      s[o + 5] = m.right.y * m.halfWidth
      s[o + 6] = m.right.z * m.halfWidth
      s[o + 7] = 0
      s[o + 8] = m.up.x * m.halfHeight
      s[o + 9] = m.up.y * m.halfHeight
      s[o + 10] = m.up.z * m.halfHeight
      s[o + 11] = 0
      s[o + 12] = passage.radiance[0] * this.transmission
      s[o + 13] = passage.radiance[1] * this.transmission
      s[o + 14] = passage.radiance[2] * this.transmission
      s[o + 15] = 0
    }

    return this.sceneUniforms.write(s, SCENE_FLOATS)
  }

  private writePortalUniforms(
    viewProj: Mat4,
    polygon: Vec3[],
    hasImage: boolean,
    fallback: readonly [number, number, number] = FOG_COLOR,
  ): number {
    const s = this.scratch
    s.set(viewProj, 0)
    for (let i = 0; i < 5; i++) {
      const p = polygon[Math.min(i, polygon.length - 1)]!
      s[16 + i * 4] = p.x
      s[17 + i * 4] = p.y
      s[18 + i * 4] = p.z
      s[19 + i * 4] = 1
    }
    s[36] = hasImage ? 1 : 0
    s[37] = polygon.length
    s[38] = 0
    s[39] = 0
    // Au fond du budget, l'ouverture prend la couleur de ce qu'il y a derrière, noyée dans
    // le brouillard selon sa distance. Le brouillard seul en faisait un **trou noir** : une
    // salle éclairée vue par une porte lointaine devenait un rectangle sombre, ce qui se
    // remarque bien davantage qu'une lueur imprécise.
    s[40] = fallback[0]
    s[41] = fallback[1]
    s[42] = fallback[2]
    s[43] = 1
    return this.portalUniforms.write(s, 44)
  }

  /**
   * La couleur d'une ouverture qu'on n'a pas les moyens de dessiner.
   *
   * L'ambiance de la pièce d'en face, éclaircie pour valoir une paroi éclairée, puis noyée
   * dans le brouillard selon la distance — exactement comme le serait la géométrie qu'on
   * renonce à rendre. De près, on n'y a jamais recours ; de loin, cela vaut mieux que le
   * gris du brouillard, qui creuse un trou là où il devrait y avoir une lueur.
   */
  private behind(
    passage: Passage,
    polygon: Vec3[],
    camPos: Vec3,
    cell: Cell,
  ): [number, number, number] {
    const ambient = this.world?.cells.get(passage.to.cell)?.lighting.ambient ?? FOG_COLOR
    const at = polygon[0] ?? passage.from.center
    const d = Math.hypot(at.x - camPos.x, at.y - camPos.y, at.z - camPos.z)
    const haze = 1 - Math.exp(-d * (cell.fog ?? FOG_DENSITY))
    const lit = 4
    // **La brume de la salle où l'on se tient, et non celle par défaut.** Chaque cellule a
    // depuis longtemps son propre lointain — c'est ce qui donne à chaque aile sa température
    // — mais cette formule-ci était restée sur la couleur globale, qui est presque noire.
    // Une ouverture lointaine dans une salle à brume claire devenait donc un trou sombre, et
    // le défaut ne s'est vu que le jour où une salle a eu une brume franchement blanche : au
    // pont, en regardant le vide, on voyait la nuit.
    const far = cell.fogColour ?? FOG_COLOR
    return [
      ambient[0] * lit * (1 - haze) + far[0] * haze,
      ambient[1] * lit * (1 - haze) + far[1] * haze,
      ambient[2] * lit * (1 - haze) + far[2] * haze,
    ]
  }

  private textureBindGroup(view: GPUTextureView): GPUBindGroup {
    let bg = this.textureBindGroups.get(view)
    if (!bg) {
      bg = this.device.createBindGroup({
        layout: this.portalTextureLayout,
        entries: [{ binding: 0, resource: view }],
      })
      this.textureBindGroups.set(view, bg)
    }
    return bg
  }

  private acquireTarget(): Target {
    const reused = this.freeTargets.pop()
    if (reused) return reused
    const color = this.device.createTexture({
      label: `cible de couture ${this.allTargets.length}`,
      size: [this.width, this.height],
      format: OFFSCREEN_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const depth = this.device.createTexture({
      size: [this.width, this.height],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const t: Target = {
      color,
      colorView: color.createView(),
      depth,
      depthView: depth.createView(),
    }
    this.allTargets.push(t)
    return t
  }

  private releaseTarget(t: Target): void {
    this.freeTargets.push(t)
  }

  private scenePipeline(format: GPUTextureFormat): GPURenderPipeline {
    let p = this.scenePipelines.get(format)
    if (!p) {
      p = this.device.createRenderPipeline({
        label: `scène ${format}`,
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.sceneLayout, this.pictureLayout],
        }),
        vertex: {
          module: this.sceneModule,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: FLOATS_PER_VERTEX * 4,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                { shaderLocation: 1, offset: 12, format: 'float32x3' },
                { shaderLocation: 2, offset: 24, format: 'float32x2' },
                { shaderLocation: 3, offset: 32, format: 'float32x3' },
                { shaderLocation: 4, offset: 44, format: 'float32' },
              ],
            },
          ],
        },
        fragment: { module: this.sceneModule, entryPoint: 'fs', targets: [{ format }] },
        // Les faces arrière sont écartées. Toutes les parois sont orientées vers
        // l'intérieur de leur pièce, si bien que cela supprime un travail inutile
        // et systématique : dans une passe de couture, la caméra virtuelle se
        // trouve **dehors**, et sans ce tri elle dessinerait le dos du mur qui
        // contient la bouche de sortie sur tout l'écran.
        // Effet de bord bienvenu : une paroi dont l'enroulement serait faux
        // devient invisible, donc le défaut se signale au lieu de se cacher.
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
      })
      this.scenePipelines.set(format, p)
    }
    return p
  }

  private portalPipeline(format: GPUTextureFormat): GPURenderPipeline {
    let p = this.portalPipelines.get(format)
    if (!p) {
      p = this.device.createRenderPipeline({
        label: `portail ${format}`,
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.portalUniformLayout, this.portalTextureLayout],
        }),
        vertex: { module: this.portalModule, entryPoint: 'vs' },
        fragment: { module: this.portalModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
      })
      this.portalPipelines.set(format, p)
    }
    return p
  }
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

/** La même bouche, dans une autre copie du réseau. */
function moved(m: Mouth, shift: Vec3): Mouth {
  if (shift.x === 0 && shift.y === 0 && shift.z === 0) return m
  return { ...m, center: add(m.center, shift) }
}

/** Une matrice de translation pure, pour poser une copie de réseau. */
function translation(v: Vec3): Mat4 {
  const m = create()
  m[12] = v.x
  m[13] = v.y
  m[14] = v.z
  return m
}

/**
 * Tampon d'uniformes circulaire, découpé en blocs alignés. Une passe = un bloc,
 * désigné par un décalage dynamique : on évite ainsi de créer un groupe de
 * liaison par passe, alors qu'il y en a jusqu'à une vingtaine par image.
 */
class Ring {
  readonly buffer: GPUBuffer
  private cursor = 0

  constructor(
    private readonly device: GPUDevice,
    private readonly stride: number,
    private readonly capacity: number,
    label: string,
  ) {
    this.buffer = device.createBuffer({
      label,
      size: stride * capacity,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  reset(): void {
    this.cursor = 0
  }

  write(data: F32, floatCount: number): number {
    if (this.cursor >= this.capacity) this.cursor = 0 // filet de sécurité
    const offset = this.cursor * this.stride
    this.cursor++
    this.device.queue.writeBuffer(this.buffer, offset, data, 0, floatCount)
    return offset
  }
}
