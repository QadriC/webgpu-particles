import { PARAMS, initParticles, brightness } from './common.js';

// Shader de simulació: s'executa un cop per partícula i escriu el nou estat
// al buffer de sortida (transform feedback). No dibuixa res.
const SIM_VS = `#version 300 es
layout(location = 0) in vec4 a_state;  // x, y, vx, vy
uniform float u_dt;
uniform vec2  u_mouse;
uniform float u_g;
uniform float u_soft;
uniform float u_drag;
uniform float u_swirl;
out vec4 v_state;

void main() {
  vec2 p = a_state.xy;
  vec2 v = a_state.zw;

  // Força cap a l'atractor, més un component tangencial (remolí)
  vec2 d = u_mouse - p;
  float r2 = dot(d, d) + u_soft;
  float k = u_g / (r2 * sqrt(r2));

  // Integració d'Euler amb fregament (igual que a la versió de CPU)
  float drag = 1.0 - u_drag * u_dt;
  v = (v + vec2(d.x - d.y * u_swirl, d.y + d.x * u_swirl) * k * u_dt) * drag;
  p += v * u_dt;

  // Rebot a les vores de la pantalla
  if (p.x > 1.0)       { p.x = 1.0;  v.x *= -0.5; }
  else if (p.x < -1.0) { p.x = -1.0; v.x *= -0.5; }
  if (p.y > 1.0)       { p.y = 1.0;  v.y *= -0.5; }
  else if (p.y < -1.0) { p.y = -1.0; v.y *= -0.5; }

  v_state = vec4(p, v);
}`;

// Cal un fragment shader buit perquè el programa enllaci,
// però no s'executarà mai (RASTERIZER_DISCARD).
const SIM_FS = `#version 300 es
precision highp float;
void main() {}`;

// Shader de dibuix: cada partícula és un punt d'1 píxel.
// El color depèn de la velocitat i es suma amb el de les veïnes (blending additiu).
const RENDER_VS = `#version 300 es
layout(location = 0) in vec4 a_state;
uniform float u_base;  // brillantor base (0..1)
out vec3 v_color;

void main() {
  gl_Position = vec4(a_state.xy, 0.0, 1.0);
  gl_PointSize = 1.0;

  float sp = abs(a_state.z) + abs(a_state.w);
  float intensity = u_base + min(sp * 40.0, 40.0) / 255.0;
  vec3 tint = mix(vec3(0.15, 0.45, 1.0), vec3(0.7, 1.0, 1.0), clamp(sp / 2.0, 0.0, 1.0));
  v_color = tint * intensity;
}`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 o_color;
void main() { o_color = vec4(v_color, 1.0); }`;

export default class WebGLBackend {
  async init(canvas, n) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');

    this.gl = gl;
    this.n = n;
    this.w = canvas.width;
    this.h = canvas.height;
    this.base = brightness(n) / 255;

    this.simProg = createProgram(gl, SIM_VS, SIM_FS, ['v_state']);
    this.renderProg = createProgram(gl, RENDER_VS, RENDER_FS);

    // Ubicacions dels uniforms (les consultem un cop, no a cada frame)
    this.uSim = {
      dt:    gl.getUniformLocation(this.simProg, 'u_dt'),
      mouse: gl.getUniformLocation(this.simProg, 'u_mouse'),
      g:     gl.getUniformLocation(this.simProg, 'u_g'),
    };
    this.uBase = gl.getUniformLocation(this.renderProg, 'u_base');

    // Uniforms constants de la física: es fixen un sol cop
    gl.useProgram(this.simProg);
    gl.uniform1f(gl.getUniformLocation(this.simProg, 'u_soft'), PARAMS.SOFT);
    gl.uniform1f(gl.getUniformLocation(this.simProg, 'u_drag'), PARAMS.DRAG);
    gl.uniform1f(gl.getUniformLocation(this.simProg, 'u_swirl'), PARAMS.SWIRL);

    // Dos buffers amb l'estat de les partícules (ping-pong):
    // en cada frame llegim d'un i escrivim a l'altre.
    const data = initParticles(n);
    this.buffers = [gl.createBuffer(), gl.createBuffer()];
    this.vaos = [gl.createVertexArray(), gl.createVertexArray()];
    for (let i = 0; i < 2; i++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
      gl.bindVertexArray(this.vaos[i]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);
    // Un buffer lligat al transform feedback no pot estar lligat a cap altre target
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.tf = gl.createTransformFeedback();
    this.cur = 0;  // índex del buffer que conté l'estat actual
  }

  frame(dt, mouse) {
    this.simulate(dt, mouse);
    this.draw();
  }

  // Llegir un sol píxel obliga la GPU a acabar tot el que té pendent
  async sync() {
    const gl = this.gl;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
  }

  simulate(dt, mouse) {
    const { gl, n } = this;
    const src = this.cur;
    const dst = 1 - this.cur;

    gl.useProgram(this.simProg);
    gl.uniform1f(this.uSim.dt, dt);
    gl.uniform2f(this.uSim.mouse, mouse.x, mouse.y);
    gl.uniform1f(this.uSim.g, mouse.down ? PARAMS.G * 4 : PARAMS.G);

    // Llegim del buffer "src" i el transform feedback escriu al buffer "dst"
    gl.bindVertexArray(this.vaos[src]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers[dst]);

    gl.enable(gl.RASTERIZER_DISCARD);  // només volem calcular, no dibuixar
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    this.cur = dst;  // intercanviem els rols dels buffers
  }

  draw() {
    const { gl, n } = this;

    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.renderProg);
    gl.uniform1f(this.uBase, this.base);

    // Blending additiu: els punts que se superposen se sumen i brillen més
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.bindVertexArray(this.vaos[this.cur]);
    gl.drawArrays(gl.POINTS, 0, n);

    gl.disable(gl.BLEND);
  }

  destroy() {
    const gl = this.gl;
    this.buffers.forEach(b => gl.deleteBuffer(b));
    this.vaos.forEach(v => gl.deleteVertexArray(v));
    gl.deleteTransformFeedback(this.tf);
    gl.deleteProgram(this.simProg);
    gl.deleteProgram(this.renderProg);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader error: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

// feedbackVaryings: noms de les sortides del vertex shader que s'han de
// capturar (només el programa de simulació). S'han d'indicar abans d'enllaçar.
function createProgram(gl, vsSource, fsSource, feedbackVaryings) {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
  if (feedbackVaryings) {
    gl.transformFeedbackVaryings(program, feedbackVaryings, gl.INTERLEAVED_ATTRIBS);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Link error: ' + gl.getProgramInfoLog(program));
  }
  return program;
}