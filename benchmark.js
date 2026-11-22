// Mode benchmark: mesura el temps real de treball per frame de cada motor,
// sense esperar el refresc del monitor (v-sync).

const BACKENDS = ['cpu', 'webgl', 'webgpu'];
const SIZES = [10000, 100000, 1000000, 4000000, 8000000];
const MIN_TIME_MS = 2000;  // temps mínim de mesura per cas
const WARMUP_FRAMES = 10;  // frames descartats (compilació, caches...)
const DT = 1 / 60;         // pas de temps fix: simulació idèntica als tres motors

export async function runBenchmark(stage, onProgress) {
  const rows = [];
  for (const name of BACKENDS) {
    for (const n of SIZES) {
      onProgress(`Measuring ${name} · ${n.toLocaleString()} particles...`);
      rows.push(await measure(stage, name, n));
    }
  }
  stage.innerHTML = '';
  return rows;
}

async function measure(stage, name, n) {
  // Canvas nou per cada cas (un canvas no pot canviar de tipus de context)
  stage.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(innerWidth  * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
  stage.appendChild(canvas);

  const mod = await import(`./${name}.js`);
  const backend = new mod.default();

  try {
    await backend.init(canvas, n);

    // Trajectòria del ratolí determinista: igual als tres motors
    const mouse = { x: 0, y: 0, down: false };
    let step = 0;
    const run = frames => {
      for (let i = 0; i < frames; i++) {
        const t = step++ * DT;
        mouse.x = 0.6 * Math.cos(t);
        mouse.y = 0.6 * Math.sin(1.3 * t);
        backend.frame(DT, mouse);
      }
    };

    // Escalfament: no es mesura
    run(WARMUP_FRAMES);
    await backend.sync();

    // Mesura per tandes: només es cronometra la feina real (frames + espera de la GPU)
    const batch = name === 'cpu' ? 1 : 16;
    let total = 0, frames = 0;
    while (total < MIN_TIME_MS || frames < 5) {
      const t0 = performance.now();
      run(batch);
      await backend.sync();
      total += performance.now() - t0;
      frames += batch;
      // Cedim el control al navegador entre tandes (fora del temps mesurat)
      await new Promise(r => setTimeout(r));
    }

    return { backend: name, n, frames, msPerFrame: total / frames };
  } catch (e) {
    // Un cas fallit queda registrat com a error, però la resta continua
    console.error(name, n, e);
    return { backend: name, n, error: e.message };
  } finally {
    // Si init() ha fallat a mitges, destroy() també pot fallar: ho ignorem
    try { backend.destroy(); } catch {}
  }
}

// Taula de text per mostrar a la pàgina
export function formatTable(rows) {
  const lines = ['backend   particles    ms/frame   max FPS'];
  for (const r of rows) {
    if (r.error) {
      lines.push(`${r.backend.padEnd(9)} ${String(r.n).padStart(9)}    ERROR: ${r.error}`);
    } else {
      lines.push(
        `${r.backend.padEnd(9)} ${String(r.n).padStart(9)}  ${r.msPerFrame.toFixed(3).padStart(10)}  ${(1000 / r.msPerFrame).toFixed(0).padStart(8)}`
      );
    }
  }
  return lines.join('\n');
}

// CSV per copiar a Excel / gràfiques
export function toCSV(rows) {
  const lines = ['backend,particles,frames,ms_per_frame,max_fps'];
  for (const r of rows) {
    if (r.error) continue;
    lines.push(`${r.backend},${r.n},${r.frames},${r.msPerFrame.toFixed(4)},${(1000 / r.msPerFrame).toFixed(1)}`);
  }
  return lines.join('\n');
}