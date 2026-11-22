export default class WebGPUBackend {
  async init(canvas, n) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');

    // Adapter: representa la GPU física. Demanem la d'alt rendiment (la NVIDIA).
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No GPU adapter found');

    // Device: la connexió lògica amb la GPU; Queue: la cua on enviem les ordres
    this.device = await adapter.requestDevice();
    this.queue = this.device.queue;

    // Configurem el canvas perquè la GPU hi pugui dibuixar
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.n = n;
    console.log('Adapter:', adapter.info);
  }

  frame(dt, mouse) {
    // Per ara només netegem la pantalla; la simulació arriba a la Fase 4
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.02, b: 0.08, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.end();
    this.queue.submit([enc.finish()]);
  }

  destroy() { this.device.destroy(); }
}