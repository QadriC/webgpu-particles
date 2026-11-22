// Paràmetres de la física, compartits per CPU, WebGL i WebGPU.
export const PARAMS = {
  G: 0.4,      // força de l'atractor (ratolí)
  SOFT: 0.01,  // suavitzat per evitar dividir per ~0 a prop de l'atractor
  DRAG: 0.6,   // fregament (per segon)
  SWIRL: 0.5,  // component tangencial: fa que les partícules orbitin
};

// Brillantor base per partícula: com menys partícules, més brillant,
// perquè amb poques partícules gairebé no es veurien.
export function brightness(n) {
  return Math.min(200, Math.max(10, 10 * Math.sqrt(1e6 / n)));
}

// Estat inicial determinista (el mateix als tres motors).
// 4 floats per partícula: x, y, vx, vy (coordenades de -1 a 1).
export function initParticles(n) {
  const data = new Float32Array(n * 4);
  let s = 12345;
  // Generador pseudoaleatori simple amb llavor fixa
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.9;  // l'arrel reparteix uniformement dins del cercle
    data[4 * i]     = Math.cos(a) * r;
    data[4 * i + 1] = Math.sin(a) * r;
    data[4 * i + 2] = -Math.sin(a) * r * 0.3;  // gir inicial
    data[4 * i + 3] =  Math.cos(a) * r * 0.3;
  }
  return data;
}