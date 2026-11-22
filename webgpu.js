import { PARAMS, initParticles, brightness } from './common.js';

// Estructura de paràmetres, compartida pels dos shaders.
// Només escalars, per evitar problemes d'alineació als uniforms.
const PARAMS_WGSL = `
struct Params {
  dt: f32,
  mx: f32,
  my: f32,
  g: f32,
  soft: f32,
  drag: f32,
  swirl: f32,
  bright: f32,
  count: u32,
}
@group(0) @binding(0) var<uniform> params: Params;
`;

// Compute shader: un fil per partícula; actualitza l'estat al mateix buffer.
const COMPUTE_WGSL = PARAMS_WGSL + `
@group(0) @binding(1) var<storage, read_write> particles: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }  // el darrer grup pot tenir fils de sobra

  let s = particles[i];
  var p = s.xy;
  var v = s.zw;

  // Força cap a l'atractor, més un component tangencial (remolí)
  let d = vec2f(params.mx, params.my) - p;
  let r2 = dot(d, d) + params.soft;
  let k = params.g / (r2 * sqrt(r2));

  // Integració d'Euler amb fregament (igual que a CPU i WebGL)
  let drag = 1.0 - params.drag * params.dt;
  v = (v + vec2f(d.x - d.y * params.swirl, d.y + d.x * params.swirl) * k * params.dt) * drag;
  p = p + v * params.dt;

  // Rebot a les vores de la pantalla
  if (p.x > 1.0)       { p.x = 1.0;  v.x = v.x * -0.5; }
  else if (p.x < -1.0) { p.x = -1.0; v.x = v.x * -0.5; }
  if (p.y > 1.0)       { p.y = 1.0;  v.y = v.y * -0.5; }
  else if (p.y < -1.0) { p.y = -1.0; v.y = v.y * -0.5; }

  particles[i] = vec4f(p, v);
}
`;

// Shaders de dibuix: el vertex shader llegeix directament el buffer de partícules.
const RENDER_WGSL = PARAMS_WGSL + `
@group(0) @binding(1) var<storage, read> particles: array<vec4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  let s = particles[i];
  var o: VSOut;
  o.pos = vec4f(s.xy, 0.0, 1.0);

  // El color depèn de la velocitat (igual que a WebGL)
  let sp = abs(s.z) + abs(s.w);
  let intensity = params.bright + min(sp * 40.0, 40.0) / 255.0;
  let tint = mix(vec3f(0.15, 0.45, 1.0), vec3f(0.7, 1.0, 1.0), clamp(sp / 2.0, 0.0, 1.0));
  o.color = tint * intensity;
  return o;
}

@fragment
fn fs(input: VSOut) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`;

export default class WebGPUBackend {
  async init(canvas, n) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');

    // Adapter: representa la GPU física. Demanem la d'alt rendiment (la NVIDIA).
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No GPU adapter found');

    // Device: la connexió lògica amb la GPU; Queue: la cua on enviem les ordres
    this.device = await adapter.requestDevice();
    this.queue = this.device.queue;
    this.device.addEventListener('uncapturederror', e => console.error('WebGPU error:', e.error.message));
    console.log('Adapter:', adapter.info);

    // Configurem el canvas perquè la GPU hi pugui dibuixar
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.n = n;
    this.bright = brightness(n) / 255;
    const device = this.device;

    // Buffer de partícules (4 floats cadascuna), inicialitzat amb l'estat comú
    const data = initParticles(n);
    this.particles = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });
    new Float32Array(this.particles.getMappedRange()).set(data);
    this.particles.unmap();

    // Buffer uniform amb els paràmetres. Una vista f32 i una u32 sobre les mateixes
    // dades, perquè l'últim camp (count) és un enter.
    this.uniformBuf = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const raw = new ArrayBuffer(48);
    this.uf = new Float32Array(raw);
    this.uu = new Uint32Array(raw);
    this.uf[4] = PARAMS.SOFT;
    this.uf[5] = PARAMS.DRAG;
    this.uf[6] = PARAMS.SWIRL;
    this.uf[7] = this.bright;
    this.uu[8] = n;

    // Pipelines: compute (simulació) i render (dibuix)
    const computeModule = await createModule(device, COMPUTE_WGSL);
    const renderModule = await createModule(device, RENDER_WGSL);

    this.computePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'main' },
    });

    // Blending additiu: els punts que se superposen se sumen i brillen més
    const additive = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };
    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs',
        targets: [{ format: this.format, blend: additive }],
      },
      primitive: { topology: 'point-list' },
    });

    // Bind groups: connecten els buffers amb les variables dels shaders
    this.computeBindGroup = device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.particles } },
      ],
    });
    this.renderBindGroup = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.particles } },
      ],
    });
  }

  frame(dt, mouse) {
    // Actualitzem els uniforms que canvien a cada frame
    this.uf[0] = dt;
    this.uf[1] = mouse.x;
    this.uf[2] = mouse.y;
    this.uf[3] = mouse.down ? PARAMS.G * 4 : PARAMS.G;
    this.queue.writeBuffer(this.uniformBuf, 0, this.uf);

    const enc = this.device.createCommandEncoder();

    // 1) Passada de compute: simula totes les partícules (256 fils per grup)
    const cpass = enc.beginComputePass();
    cpass.setPipeline(this.computePipeline);
    cpass.setBindGroup(0, this.computeBindGroup);
    cpass.dispatchWorkgroups(Math.ceil(this.n / 256));
    cpass.end();

    // 2) Passada de render: dibuixa cada partícula com un punt
    const rpass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    rpass.setPipeline(this.renderPipeline);
    rpass.setBindGroup(0, this.renderBindGroup);
    rpass.draw(this.n);
    rpass.end();

    // Enviem totes les ordres a la GPU d'un sol cop
    this.queue.submit([enc.finish()]);
  }

  // Espera que la GPU hagi acabat tot el que s'ha enviat a la cua
  async sync() {
    await this.queue.onSubmittedWorkDone();
  }

  destroy() {
    this.particles.destroy();
    this.uniformBuf.destroy();
    this.device.destroy();
  }
}

// Crea un mòdul de shader i llença un error llegible si no compila
// (a WebGPU els errors de shader arriben de manera asíncrona).
async function createModule(device, code) {
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(m => m.type === 'error');
  if (errors.length) {
    throw new Error(errors.map(m => `line ${m.lineNum}: ${m.message}`).join('\n'));
  }
  return module;
}