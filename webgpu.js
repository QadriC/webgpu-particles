export default class WebGPUBackend {
  async init(canvas, n) {
    if (!navigator.gpu) throw new Error('WebGPU no disponible en este navegador');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No se encontró ningún adaptador GPU');
    this.device = await adapter.requestDevice();
    this.queue = this.device.queue;
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    this.n = n;
    console.log('Adaptador:', adapter.info);
  }

  frame(dt, mouse) {
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