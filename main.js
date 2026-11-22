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