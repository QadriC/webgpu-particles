// Parámetros de la física, compartidos por CPU, WebGL y WebGPU.
// Si los cambias, hazlo aquí y los tres motores quedan iguales.
export const PARAMS = {
  G: 0.4,       // fuerza del atractor (ratón)
  SOFT: 0.01,   // suavizado para evitar división por ~0 cerca del atractor
  DRAG: 0.6,    // rozamiento (por segundo)
  SWIRL: 0.5,   // componente tangencial: hace que las partículas orbiten
};

// Estado inicial determinista (mismo en los tres motores).
// 4 floats por partícula: x, y, vx, vy (coordenadas de -1 a 1).
export function initParticles(n) {
  const data = new Float32Array(n * 4);
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.9;
    data[4 * i]     = Math.cos(a) * r;
    data[4 * i + 1] = Math.sin(a) * r;
    data[4 * i + 2] = -Math.sin(a) * r * 0.3;  // giro inicial
    data[4 * i + 3] =  Math.cos(a) * r * 0.3;
  }
  return data;
}