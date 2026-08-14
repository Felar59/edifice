export interface GpuContext {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
}

export async function initGpu(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU n'est pas disponible dans ce navigateur. " +
        'Essayez Chrome ou Edge à jour (chrome://gpu pour vérifier).',
    )
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error("Aucun adaptateur graphique n'a répondu.")

  const device = await adapter.requestDevice()
  device.lost.then((info) => {
    console.error('Périphérique graphique perdu :', info.message)
  })

  const context = canvas.getContext('webgpu')
  if (!context) throw new Error("Impossible d'obtenir un contexte WebGPU sur le canvas.")

  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })

  return { device, context, format }
}
