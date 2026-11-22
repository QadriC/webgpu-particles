const $ = id => document.getElementById(id);
const stage = $('stage');
const mouse = { x: 0, y: 0, down: false };   // coordenadas normalizadas -1..1

stage.addEventListener('pointermove', e => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = 1 - (e.clientY / innerHeight) * 2;
});
stage.addEventListener('pointerdown', () => mouse.down = true);
stage.addEventListener('pointerup',   () => mouse.down = false);

let backend = null;
let last = performance.now();
let avgMs = 16;

async function start() {
  if (backend) { backend.destroy(); backend = null; }
  stage.innerHTML = '';

  // Canvas nuevo cada vez: un canvas no puede cambiar de tipo de contexto
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(innerWidth  * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
  stage.appendChild(canvas);

  const name = $('backend').value;
  const n = Number($('count').value);
  $('status').textContent = 'Inicializando ' + name + '...';

  try {
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
  const dt = Math.min((t - last) / 1000, 0.05);
  const ms = t - last;
  last = t;
  avgMs += (ms - avgMs) * 0.05;               // media suavizada

  if (!backend) return;
  backend.frame(dt, mouse);
  $('status').textContent =
    `${$('backend').value} · ${Number($('count').value).toLocaleString()} partículas\n` +
    `${avgMs.toFixed(1)} ms/frame · ${(1000 / avgMs).toFixed(0)} FPS`;
}

$('start').addEventListener('click', start);
requestAnimationFrame(loop);