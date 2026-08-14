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
import { dot, sub, type Vec3 } from '../math/vec3'
import { cameraToWorld, type Camera } from './camera'

export type { Camera }
import { FLOATS_PER_VERTEX } from '../world/geometry'
import { MAX_LIGHTS, MAX_MOUTH_LIGHTS } from '../world/light'
import type { Cell, Mouth, Passage, World } from '../world/types'
import sceneShader from '../shaders/scene.wgsl?raw'
import portalShader from '../shaders/portal.wgsl?raw'

const OFFSCREEN_FORMAT: GPUTextureFormat = 'rgba8unorm'
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus'
/**
 * Un bloc d'uniformes de scène porte l'éclairage de la cellule : six lampes et huit
 * ouvertures, soit 896 octets, alignés sur 1024. Les portails, eux, se contentent
 * toujours de 256.
 */
const SCENE_STRIDE = 1024
const SCENE_BYTES = 896
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
const FOG_CLEAR = FOG_COLOR.map((c) => c ** (1 / 2.2)) as unknown as [number, number, number]

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
const NEAR = 0.004
/**
 * Épaisseur devant l'œil en deçà de laquelle un sommet compte comme derrière.
 *
 * Volontairement minuscule : on ne retire de l'ouverture que ce qui est réellement
 * invisible. Une valeur confortable coûterait cher au pire moment — à un dixième de
 * millimètre du plan, elle supprimait les quatre coins d'un coup, donc l'ouverture
 * entière, donc l'image.
 */
const EYE_EPS = 1e-7

/** Une bouche dont la surface à l'écran tombe sous ce seuil ne mérite pas une passe. */
const MIN_COVERAGE = 0.00004

export interface DynObject {
  cell: string
  model: Mat4
}

export interface RenderStats {
  passes: number
  deepest: number
  skipped: number
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
  /** Profondeur de récursion maximale. Réglable à chaud, c'est un outil de mise au point. */
  maxDepth = 3
  /** Garde-fou : plafond du nombre de passes par image. */
  maxPasses = 24
  fovY = (72 * Math.PI) / 180
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

  private stats: RenderStats = { passes: 0, deepest: 0, skipped: 0 }

  // Matrices réutilisées d'une image sur l'autre : rien ici ne doit allouer par
  // image, sinon le ramasse-miettes se réveille au pire moment.
  private readonly proj = create()
  private readonly scratch = new Float32Array(240)

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

    this.sceneUniforms = new Ring(device, SCENE_STRIDE, 256, 'uniformes de scène')
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

    this.stats = { passes: 0, deepest: 0, skipped: 0 }
    this.sceneUniforms.reset()
    this.portalUniforms.reset()

    perspective(this.proj, this.fovY, this.width / this.height, NEAR, 300)

    const camWorld = cameraToWorld(camera)

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
    )

    this.device.queue.submit([encoder.finish()])
  }

  private renderNode(
    encoder: GPUCommandEncoder,
    cell: Cell,
    camWorld: Mat4,
    proj: Mat4,
    depth: number,
    target: { colorView: GPUTextureView; depthView: GPUTextureView },
    objects: DynObject[],
    world: World,
  ): void {
    this.stats.deepest = Math.max(this.stats.deepest, depth)
    this.stats.passes++

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
      target: Target | null
      visible: boolean
      polygon: Vec3[]
    }[] = []
    for (const passage of cell.passages) {
      const mouth = passage.from
      const dist = dot(mouth.normal, sub(camPos, mouth.center))

      // Le seuil sur la distance est zéro, et non un epsilon confortable : écarter
      // une bouche dont on n'est qu'à un dixième de millimètre revenait à ne rien
      // dessiner pendant l'image du franchissement, c'est-à-dire au pire moment.
      const polygon = dist <= 0 ? [] : this.mouthPolygon(mouth, camPos, viewFwd)
      const cover = polygon.length < 3 ? 0 : this.coverage(polygon, viewProj)
      if (cover <= 0) {
        children.push({ passage, target: null, visible: false, polygon: [] })
        continue
      }

      let child: Target | null = null
      if (depth < this.maxDepth && this.stats.passes < this.maxPasses && cover >= MIN_COVERAGE) {
        child = this.acquireTarget()
        const childCam = multiply(create(), passage.transform, camWorld)
        const childProj = this.obliqueFor(proj, passage.to, childCam)
        const destCell = world.cells.get(passage.to.cell)
        if (!destCell) throw new Error(`Cellule de destination inconnue : ${passage.to.cell}`)
        this.renderNode(encoder, destCell, childCam, childProj, depth + 1, child, objects, world)
      } else {
        this.stats.skipped++
      }
      children.push({ passage, target: child, visible: true, polygon })
    }

    // --- 2. Puis la cellule elle-même. --------------------------------------
    const pass = encoder.beginRenderPass({
      label: `cellule ${cell.id} · profondeur ${depth}`,
      colorAttachments: [
        {
          view: target.colorView,
          clearValue: { r: FOG_CLEAR[0], g: FOG_CLEAR[1], b: FOG_CLEAR[2], a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: target.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    })

    const colorFormat = depth === 0 ? this.canvasFormat : OFFSCREEN_FORMAT
    const scenePipeline = this.scenePipeline(colorFormat)
    pass.setPipeline(scenePipeline)

    const mesh = this.meshes.get(cell.id)
    if (mesh) {
      const offset = this.writeSceneUniforms(viewProj, IDENTITY, camPos, cell)
      pass.setBindGroup(0, this.sceneBindGroup, [offset])
      pass.setVertexBuffer(0, mesh.buffer)
      pass.draw(mesh.vertexCount)
    }

    // Les objets ne sont dessinés que dans la cellule où ils se trouvent — ce qui
    // suffit à ce qu'un objet lancé de l'autre côté d'une couture apparaisse
    // naturellement à travers l'ouverture, sans traitement particulier.
    if (this.objectMesh) {
      for (const obj of objects) {
        if (obj.cell !== cell.id) continue
        const offset = this.writeSceneUniforms(viewProj, obj.model, camPos, cell)
        pass.setBindGroup(0, this.sceneBindGroup, [offset])
        pass.setVertexBuffer(0, this.objectMesh.buffer)
        pass.draw(this.objectMesh.vertexCount)
      }
    }

    // --- 3. Les ouvertures, peintes avec l'image de l'autre côté. ------------
    pass.setPipeline(this.portalPipeline(colorFormat))
    for (const { target: child, visible, polygon } of children) {
      if (!visible) continue
      const offset = this.writePortalUniforms(viewProj, polygon, child !== null)
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

  private writeSceneUniforms(viewProj: Mat4, model: Mat4, camPos: Vec3, cell: Cell): number {
    const s = this.scratch
    s.set(viewProj, 0)
    s.set(model, 16)
    s[32] = camPos.x; s[33] = camPos.y; s[34] = camPos.z; s[35] = 1
    s[36] = FOG_COLOR[0]; s[37] = FOG_COLOR[1]; s[38] = FOG_COLOR[2]; s[39] = FOG_DENSITY

    const { ambient, lights } = cell.lighting
    s[40] = ambient[0]; s[41] = ambient[1]; s[42] = ambient[2]; s[43] = 0

    const lightCount = Math.min(lights.length, MAX_LIGHTS)
    const mouthCount = Math.min(cell.passages.length, MAX_MOUTH_LIGHTS)
    s[44] = lightCount; s[45] = mouthCount; s[46] = 0; s[47] = 0

    for (let i = 0; i < MAX_LIGHTS; i++) {
      const o = 48 + i * 8
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
      const o = 96 + i * 16
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

    return this.sceneUniforms.write(s, 224)
  }

  private writePortalUniforms(viewProj: Mat4, polygon: Vec3[], hasImage: boolean): number {
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
    // Au fond de la récursion, l'ouverture prend la couleur du brouillard : la
    // coupure se confond alors avec l'éloignement, et ne se voit pas.
    s[40] = FOG_COLOR[0]
    s[41] = FOG_COLOR[1]
    s[42] = FOG_COLOR[2]
    s[43] = 1
    return this.portalUniforms.write(s, 44)
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
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout] }),
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
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
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
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
      })
      this.portalPipelines.set(format, p)
    }
    return p
  }
}

const IDENTITY = create()

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
