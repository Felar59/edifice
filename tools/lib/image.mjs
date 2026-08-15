/**
 * Le minimum d'opérations sur les images pour que je puisse *regarder* les
 * résultats sans ouvrir quarante fichiers.
 *
 * Le décodage vit dans `scripts/png.mjs`, qui est commité parce que le test de
 * torture en dépend. L'encodage est ici : il ne sert qu'à moi, pour fabriquer des
 * planches de contact et des images de différence.
 *
 * Pas de dépendance : `zlib` suffit, un PNG n'étant qu'un en-tête, des lignes
 * filtrées et un flux déflaté.
 */

import { deflateSync } from 'node:zlib'

// --- CRC32, exigé par chaque bloc d'un PNG ----------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, payload) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * Encode une image en PNG, huit bits par canal, en RVB.
 *
 * Toutes les lignes utilisent le filtre « aucun ». Les fichiers sont un peu plus
 * gros qu'avec un filtrage adaptatif, et on s'en moque : ces images ne sont pas
 * livrées, elles sont regardées une fois.
 */
export function encode({ width, height, channels, data }) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1)
    raw[dst] = 0 // filtre : aucun
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels
      const out = dst + 1 + x * 3
      raw[out] = data[src]
      raw[out + 1] = data[src + 1]
      raw[out + 2] = data[src + 2]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 2 // type de couleur : RVB
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filtrage
  ihdr[12] = 0 // entrelacement

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Une image vide, en RVB. */
export function blank(width, height, [r, g, b] = [0, 0, 0]) {
  const data = Buffer.alloc(width * height * 3)
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
  return { width, height, channels: 3, data }
}

/** Réduction par moyenne de zone : préserve les détails fins mieux que l'échantillonnage. */
export function resize(image, width, height) {
  const out = blank(width, height)
  const sx = image.width / width
  const sy = image.height / height

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))

      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let v = y0; v < y1 && v < image.height; v++) {
        for (let u = x0; u < x1 && u < image.width; u++) {
          const i = (v * image.width + u) * image.channels
          r += image.data[i]
          g += image.data[i + 1]
          b += image.data[i + 2]
          n++
        }
      }
      const o = (y * width + x) * 3
      out.data[o] = r / n
      out.data[o + 1] = g / n
      out.data[o + 2] = b / n
    }
  }
  return out
}

/** Recopie une image dans une autre, à une position donnée. */
export function paste(target, source, atX, atY) {
  for (let y = 0; y < source.height; y++) {
    const ty = atY + y
    if (ty < 0 || ty >= target.height) continue
    for (let x = 0; x < source.width; x++) {
      const tx = atX + x
      if (tx < 0 || tx >= target.width) continue
      const s = (y * source.width + x) * source.channels
      const t = (ty * target.width + tx) * target.channels
      target.data[t] = source.data[s]
      target.data[t + 1] = source.data[s + 1]
      target.data[t + 2] = source.data[s + 2]
    }
  }
}

/**
 * Une planche de contact : toutes les vignettes dans une seule image.
 *
 * C'est l'outil qui me fait gagner le plus de temps. Regarder une transition
 * répartie sur quarante fichiers demande quarante lectures et interdit de comparer ;
 * une planche unique la montre d'un coup, et un accident d'une seule image y saute
 * aux yeux.
 */
export function contactSheet(images, { columns = 8, cell = 200, gap = 3 } = {}) {
  const rows = Math.ceil(images.length / columns)
  const ratio = images[0] ? images[0].height / images[0].width : 0.6
  const cellW = cell
  const cellH = Math.round(cell * ratio)

  const sheet = blank(
    columns * cellW + (columns + 1) * gap,
    rows * cellH + (rows + 1) * gap,
    [24, 24, 28],
  )

  images.forEach((image, i) => {
    const col = i % columns
    const row = Math.floor(i / columns)
    paste(
      sheet,
      resize(image, cellW, cellH),
      gap + col * (cellW + gap),
      gap + row * (cellH + gap),
    )
  })

  return sheet
}

/**
 * Où deux images diffèrent, et de combien.
 *
 * Comparer des statistiques dit *si* quelque chose a changé ; cette fonction dit
 * *où*. Le gain amplifie les écarts, parce qu'une régression de rendu se joue
 * souvent sur quelques niveaux à peine.
 */
export function difference(a, b, { gain = 8 } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `tailles différentes : ${a.width}×${a.height} contre ${b.width}×${b.height}`,
    )
  }

  const out = blank(a.width, a.height)
  let max = 0
  let total = 0
  let changed = 0
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const ia = (y * a.width + x) * a.channels
      const ib = (y * b.width + x) * b.channels
      const d =
        Math.abs(a.data[ia] - b.data[ib]) +
        Math.abs(a.data[ia + 1] - b.data[ib + 1]) +
        Math.abs(a.data[ia + 2] - b.data[ib + 2])

      total += d
      if (d > max) max = d
      if (d > 2) {
        changed++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }

      const v = Math.min(255, d * gain)
      const o = (y * a.width + x) * 3
      out.data[o] = v
      out.data[o + 1] = v
      out.data[o + 2] = v
    }
  }

  const pixels = a.width * a.height
  return {
    image: out,
    max,
    mean: total / pixels,
    changedFraction: changed / pixels,
    box: changed ? { minX, minY, maxX, maxY } : null,
  }
}
