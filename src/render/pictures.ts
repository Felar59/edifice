/**
 * Les images accrochées aux murs.
 *
 * Le musée n'a jamais chargé la moindre texture : ses matières sont calculées, et c'est un
 * parti pris qui tient — ce qui se calcule ne pèse rien et ne pixellise pas. Mais un tableau
 * n'est pas une matière. Un cadre qui ne montre qu'un aplat n'est pas un tableau, c'est un
 * cadre ; et le musée est fait pour montrer des projets, qui sont des images.
 *
 * Elles vivent donc dans **un tableau de textures**, une couche par image, et la matière d'une
 * surface désigne sa couche. Un tableau plutôt que des textures séparées, pour une raison de
 * fond : le nuanceur ne peut pas choisir une texture en fonction d'une donnée par sommet — un
 * `texture_2d` est une ressource, pas une valeur. La couche, elle, est un indice ordinaire.
 *
 * ## La chaîne de mip-maps
 *
 * WebGPU n'en fabrique pas. Sans elle, une image vue de loin ou de biais scintille — c'est
 * exactement le défaut qu'on vient de corriger dans les matières calculées, et il serait
 * absurde de le réintroduire par la porte des images. On la construit donc à la main : une
 * passe de rendu par niveau, chacune lisant le niveau précédent. C'est une trentaine de
 * lignes et cela règle la question pour de bon.
 */

/**
 * Taille des images en mémoire, en seize neuvièmes.
 *
 * Ce sont des captures d'écran : les forcer au carré les écrase, et un tableau écrasé se
 * remarque avant tout le reste. Le cadre qui les porte a le même rapport, de sorte que rien
 * n'est déformé nulle part.
 */
const WIDE = 512
const HIGH = 288

/**
 * L'indice de matière à partir duquel une surface porte une image.
 *
 * Le numéro voyage dans le même flottant que les matières calculées : au-delà de cent, c'est
 * une couche du tableau d'images. On évite ainsi un attribut de sommet de plus, et le format
 * de sommet reste ce qu'il était.
 */
export const PICTURE_BASE = 100

export interface Pictures {
  view: GPUTextureView
  sampler: GPUSampler
  count: number
  /**
   * Écrit une image dans une couche, et refait sa chaîne de mip-maps.
   *
   * C'est par là qu'une **machine** s'affiche. Le musée sait déjà accrocher une image sur un
   * mur : une couche de plus, réécrite à chaque instant, et l'écran d'une machine devient un
   * tableau comme les autres — même matière, même filtrage, même anticrénelage. Il n'y a rien
   * eu à ajouter au nuanceur.
   */
  paint(layer: number, rgba: Uint8Array<ArrayBuffer>, width: number, height: number): void
}

const BLIT = /* wgsl */ `
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
  // Un triangle qui déborde de l'écran : deux fois moins de sommets qu'un quad, et pas de
  // diagonale au milieu où les dérivées seraient discontinues.
  let x = f32(i32(i) / 2) * 4.0 - 1.0;
  let y = f32(i32(i) % 2) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) at : vec4<f32>) -> @location(0) vec4<f32> {
  // La taille de la destination se déduit de la source par une **division entière**, comme le
  // fait WebGPU. La moitié exacte s'en écarte dès qu'une dimension est impaire — 9 devient 4
  // et non 4,5 — et le niveau suivant se retrouve décalé, ce qui saute à l'œil quand la
  // distance fait basculer d'un niveau à l'autre.
  let src_size = vec2<f32>(textureDimensions(src, 0));
  let dst_size = max(floor(src_size * 0.5), vec2<f32>(1.0));
  return textureSampleLevel(src, samp, (floor(at.xy) + 0.5) / dst_size, 0.0);
}
`

/**
 * Charge les images et les monte en tableau de textures, mip-maps comprises.
 *
 * Les URL sont résolues par l'appelant : c'est la page qui sait où sont ses fichiers, et ce
 * module ne doit rien savoir de l'arborescence.
 */
export async function loadPictures(
  device: GPUDevice,
  urls: string[],
  /** Couches vides réservées aux écrans des machines, qui se réécrivent en cours de visite. */
  spare = 0,
): Promise<Pictures> {
  const levels = Math.floor(Math.log2(WIDE)) + 1
  const texture = device.createTexture({
    label: 'tableaux',
    size: [WIDE, HIGH, Math.max(1, urls.length + spare)],
    format: 'rgba8unorm',
    mipLevelCount: levels,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })

  for (let layer = 0; layer < urls.length; layer++) {
    const response = await fetch(urls[layer]!)
    const blob = await response.blob()
    // Le redimensionnement est fait par le navigateur, qui le fait bien : les images du
    // portfolio sont en 1920 × 1080 et n'ont aucune raison d'occuper la mémoire à cette
    // taille pour être vues dans un cadre d'un mètre.
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: WIDE,
      resizeHeight: HIGH,
      resizeQuality: 'high',
    })
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture, origin: [0, 0, layer] },
      [WIDE, HIGH],
    )
    bitmap.close()
  }

  buildMips(device, texture, urls.length, levels)

  const paint = (layer: number, rgba: Uint8Array<ArrayBuffer>, width: number, height: number): void => {
    device.queue.writeTexture(
      { texture, origin: [0, 0, layer] },
      rgba,
      { bytesPerRow: width * 4, rowsPerImage: height },
      [width, height],
    )
    // La chaîne de réduction est refaite pour cette couche seulement : sans elle, l'écran
    // scintille dès qu'on s'en éloigne, exactement comme le faisaient les tableaux avant
    // qu'on la construise à la main.
    buildMips(device, texture, layer + 1, levels, layer)
  }

  return {
    paint,
    view: texture.createView({ dimension: '2d-array' }),
    sampler: device.createSampler({
      label: 'tableaux',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      maxAnisotropy: 4,
    }),
    count: urls.length,
  }
}

function buildMips(
  device: GPUDevice,
  texture: GPUTexture,
  layers: number,
  levels: number,
  first = 0,
): void {
  const module = device.createShaderModule({ label: 'réduction', code: BLIT })
  const pipeline = device.createRenderPipeline({
    label: 'réduction',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })

  const encoder = device.createCommandEncoder({ label: 'mip-maps des tableaux' })
  for (let layer = first; layer < layers; layer++) {
    for (let level = 1; level < levels; level++) {
      const source = texture.createView({
        dimension: '2d',
        baseMipLevel: level - 1,
        mipLevelCount: 1,
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      })
      const target = texture.createView({
        dimension: '2d',
        baseMipLevel: level,
        mipLevelCount: 1,
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      })
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: source },
            { binding: 1, resource: sampler },
          ],
        }),
      )
      pass.draw(3)
      pass.end()
    }
  }
  device.queue.submit([encoder.finish()])
}

/** Un tableau vide, pour le cas où le chargement échoue : mieux vaut un aplat qu'un plantage. */
export function noPictures(device: GPUDevice): Pictures {
  const texture = device.createTexture({
    label: 'tableaux (absents)',
    size: [1, 1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture({ texture }, new Uint8Array([120, 118, 112, 255]), {}, [1, 1])
  return {
    paint: () => {},
    view: texture.createView({ dimension: '2d-array' }),
    sampler: device.createSampler({}),
    count: 0,
  }
}
