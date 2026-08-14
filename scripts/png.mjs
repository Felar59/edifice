/**
 * Décodeur PNG minimal, pour mesurer les captures sans ajouter de dépendance.
 *
 * On ne cherche pas à lire n'importe quel PNG : seulement ceux que produit le
 * protocole DevTools, c'est-à-dire 8 bits par canal, non entrelacés, en RGB ou
 * RGBA. Tout le reste est refusé bruyamment plutôt que deviné.
 *
 * Mesurer le fichier enregistré plutôt que le canevas a un avantage qui n'est pas
 * qu'une commodité : on mesure **exactement** l'image qu'on regarde ensuite. Une
 * lecture dans la page pourrait diverger de ce qui est capturé — et c'est
 * précisément ce qui s'est produit, un canevas WebGPU ne se relisant pas avec
 * `drawImage` en dehors de la boucle de rendu.
 */

import { inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("ce n'est pas un PNG")

  let offset = 8
  let header = null
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8

    if (type === 'IHDR') {
      header = {
        width: buffer.readUInt32BE(start),
        height: buffer.readUInt32BE(start + 4),
        bitDepth: buffer[start + 8],
        colourType: buffer[start + 9],
        interlace: buffer[start + 12],
      }
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }

    offset = start + length + 4 // + CRC
  }

  if (!header) throw new Error('IHDR manquant')
  if (header.bitDepth !== 8) throw new Error(`profondeur non gérée : ${header.bitDepth}`)
  if (header.interlace !== 0) throw new Error('PNG entrelacé non géré')

  const channels = header.colourType === 6 ? 4 : header.colourType === 2 ? 3 : 0
  if (!channels) throw new Error(`type de couleur non géré : ${header.colourType}`)

  const { width, height } = header
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(stride * height)

  // Défiltrage ligne par ligne. Chaque ligne est précédée du numéro de son filtre,
  // et se reconstruit à partir du pixel de gauche (a) et de la ligne du dessus (b).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = (y * (stride + 1)) + 1
    const dst = y * stride
    const up = dst - stride

    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]
      const a = i >= channels ? out[dst + i - channels] : 0
      const b = y > 0 ? out[up + i] : 0
      const c = y > 0 && i >= channels ? out[up + i - channels] : 0

      let value
      switch (filter) {
        case 0: value = x; break
        case 1: value = x + a; break
        case 2: value = x + b; break
        case 3: value = x + ((a + b) >> 1); break
        case 4: {
          // Prédicteur de Paeth : on choisit, de a, b ou c, le plus proche de a+b-c.
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`filtre inconnu : ${filter} (ligne ${y})`)
      }
      out[dst + i] = value & 0xff
    }
  }

  return { width, height, channels, data: out }
}

/**
 * Ce qu'il faut savoir d'une image pour dire si elle vaut quelque chose :
 * sa luminance moyenne, son relief (l'écart-type de cette luminance), le nombre de
 * teintes distinctes qu'elle contient, et sa moyenne par canal.
 *
 * Cette dernière sert à raisonner sur la **couleur** de la lumière : le hall est
 * chaud, la salle est froide, donc le rapport rouge/bleu mesuré au sol dit si la
 * lumière franchit bien les ouvertures.
 *
 * Une image utile n'est jamais un aplat. C'est grossier, et c'est exactement le
 * contrôle qui manquait : une vue cisaillée, une ouverture noire ou un écran vide
 * au franchissement laissaient tous les compteurs du moteur intacts.
 */
export function stats(png) {
  const { width, height, channels, data } = png
  let sum = 0
  let sumSq = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const seen = new Set()
  const count = width * height

  for (let i = 0; i < count; i++) {
    const o = i * channels
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const lum = (r + g + b) / 3
    sum += lum
    sumSq += lum * lum
    sumR += r
    sumG += g
    sumB += b
    // Quantifié à 16 niveaux par canal : on compte des teintes, pas du bruit.
    seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
  }

  const mean = sum / count
  return {
    mean,
    spread: Math.sqrt(Math.max(0, sumSq / count - mean * mean)),
    colours: seen.size,
    red: sumR / count,
    green: sumG / count,
    blue: sumB / count,
    /** Au-dessus de 1 la lumière est ambrée, en dessous bleutée. */
    warmth: sumB > 0 ? sumR / sumB : 0,
  }
}
