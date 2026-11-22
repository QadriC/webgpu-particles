import { PARAMS, initParticles } from './common.js';

export default class CPUBackend {
  async init(canvas, n) {
    this.n = n;
    this.w = canvas.width;
    this.h = canvas.height;
    this.ctx = canvas.getContext('2d');
    this.data = initParticles(n);
    this.img = this.ctx.createImageData(this.w, this.h);
    this.pix = new Uint32Array(this.img.data.buffer);  // vista de 32 bits sobre los píxeles
    this.acc = new Uint8Array(this.w * this.h);        // brillo acumulado por píxel
    this.pal = makePalette();
  }

  frame(dt, mouse) {
    this.simulate(dt, mouse);
    this.draw();
  }

  simulate(dt, mouse) {
    const { G, SOFT, DRAG, SWIRL } = PARAMS;
    const g = mouse.down ? G * 4 : G;
    const d = this.data, n = this.n;
    const mx = mouse.x, my = mouse.y;
    const drag = 1 - DRAG * dt;

    for (let i = 0, j = 0; i < n; i++, j += 4) {
      let x = d[j], y = d[j + 1], vx = d[j + 2], vy = d[j + 3];

      const dx = mx - x, dy = my - y;
      const r2 = dx * dx + dy * dy + SOFT;
      const k = g / (r2 * Math.sqrt(r2));

      vx = (vx + (dx - dy * SWIRL) * k * dt) * drag;
      vy = (vy + (dy + dx * SWIRL) * k * dt) * drag;
      x += vx * dt;
      y += vy * dt;

      if (x > 1)  { x = 1;  vx *= -0.5; } else if (x < -1) { x = -1; vx *= -0.5; }
      if (y > 1)  { y = 1;  vy *= -0.5; } else if (y < -1) { y = -1; vy *= -0.5; }

      d[j] = x; d[j + 1] = y; d[j + 2] = vx; d[j + 3] = vy;
    }
  }

  draw() {
    const { acc, pix, pal, data: d, w, h, n } = this;

    // 1) cada partícula suma brillo en su píxel (más rápida = más brillo)
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const px = ((d[j] * 0.5 + 0.5) * w) | 0;
      const py = ((0.5 - d[j + 1] * 0.5) * h) | 0;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const idx = py * w + px;
      const sp = Math.abs(d[j + 2]) + Math.abs(d[j + 3]);
      const v = acc[idx] + 10 + Math.min(sp * 40, 40);
      acc[idx] = v > 255 ? 255 : v;
    }

    // 2) brillo -> color con la paleta, y limpiar para el siguiente frame
    for (let i = 0; i < pix.length; i++) pix[i] = pal[acc[i]];
    acc.fill(0);

    this.ctx.putImageData(this.img, 0, 0);
  }

  destroy() {}
}

// Paleta negro -> azul -> cian -> blanco (formato ABGR, little-endian)
function makePalette() {
  const pal = new Uint32Array(256);
  const ss = (a, b, t) => {
    t = Math.min(Math.max((t - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const r = (255 * ss(0.5, 1.0, t)) | 0;
    const g = (255 * ss(0.2, 0.9, t)) | 0;
    const b = (255 * ss(0.0, 0.5, t)) | 0;
    pal[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return pal;
}