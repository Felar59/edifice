/**
 * Depuis TypeScript 5.7, les tableaux typés sont génériques sur leur tampon :
 * `Float32Array` tout court vaut `Float32Array<ArrayBufferLike>`, ce qui englobe
 * `SharedArrayBuffer`. Or WebGPU refuse la mémoire partagée dans `writeBuffer`.
 * On fixe donc le tampon une fois pour toutes, plutôt que de le répéter partout.
 */
export type F32 = Float32Array<ArrayBuffer>
