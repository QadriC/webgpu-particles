const $ = id => document.getElementById(id);
const stage = $('stage');
const mouse = { x: 0, y: 0, down: false };  // coordenades normalitzades de -1 a 1

stage.addEventListener('pointermove', e => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = 1 - (e.clientY / innerHeight) * 2;  // l'eix Y va cap amunt
});
stage.addEventListener('pointerdown', () => mouse.down = true);
stage.addEventListener('pointerup',   () => mouse.down = false);

let backend = null;
let last = performance.now();
let avgMs = 16;

async function start() {
  if (backend) { backend.destroy(); backend = null; }
  stage.innerHTML = '';

  // Canvas nou cada vegada: un canvas no pot canviar de tipus de context
  // (2d, webgl o webgpu) un cop creat.
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(innerWidth  * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
  stage.appendChild(canvas);

  const name = $('backend').value;
  const n = Number($('count').value);
  $('status').textContent = 'Initializing ' + name + '...';

  try {
    // Carreguem el motor triat de manera dinàmica (cpu.js, webgl.js o webgpu.js)
    const mod = await import(`./${name}.js`);
    const b = new mod.default();
    await b.init(canvas, n);
    backend = b;
  } catch (e) {
    console.error(e);
    $('status').textContent = 'Error: ' + e.message;
  }
}

function loop(t) {
  requestAnimationFrame(loop);
  const ms = t - last;
  const dt = Math.min(ms / 1000, 0.05);  // limitem dt perquè la simulació no exploti
  last = t;
  avgMs += (ms - avgMs) * 0.05;          // mitjana suavitzada

  if (!backend) return;
  backend.frame(dt, mouse);
  $('status').textContent =
    `${$('backend').value} · ${Number($('count').value).toLocaleString()} particles\n` +
    `${avgMs.toFixed(1)} ms/frame · ${(1000 / avgMs).toFixed(0)} FPS`;
}

$('start').addEventListener('click', start);
requestAnimationFrame(loop);

// Mode benchmark: executa tots els casos i mostra la taula de resultats
let lastCSV = '';

// Informació de la GPU que fan servir WebGPU i WebGL, per deixar-la al resultat
async function gpuInfo() {
  const lines = [];
  const adapter = await navigator.gpu?.requestAdapter();
  if (adapter) lines.push(`WebGPU adapter: ${adapter.info.vendor} ${adapter.info.architecture}`);

  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  if (ext) lines.push('WebGL renderer: ' + gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return lines.join('\n');
}

$('bench').addEventListener('click', async () => {
  if (backend) { backend.destroy(); backend = null; }
  // Bloquegem els botons perquè ningú interfereixi durant la mesura
  $('bench').disabled = true;
  $('start').disabled = true;
  $('copy').disabled = true;

  try {
    const { runBenchmark, formatTable, toCSV } = await import('./benchmark.js');
    const rows = await runBenchmark(stage, msg => $('status').textContent = msg);

    lastCSV = toCSV(rows);
    $('status').textContent =
      navigator.userAgent + '\n' + (await gpuInfo()) + '\n\n' + formatTable(rows);
    console.table(rows);
    $('copy').disabled = false;
  } catch (e) {
    console.error(e);
    $('status').textContent = 'Error: ' + e.message;
  } finally {
    $('bench').disabled = false;
    $('start').disabled = false;
  }
});

// El porta-retalls requereix un gest de l'usuari, per això és un botó a part
$('copy').addEventListener('click', () => navigator.clipboard.writeText(lastCSV));