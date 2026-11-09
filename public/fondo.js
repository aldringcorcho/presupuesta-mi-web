// Portada: fondo "Chrome Arcs" en WebGL, paletas de color, pantalla de carga,
// smooth scrolling (Lenis) y la barra de la portada que se escribe sola.
//
// El fondo es una adaptación a JavaScript sin compilación del componente
// "Chrome Arcs" by Louis Studios (https://studios.lou15.com/?ref=21st-code),
// publicado en 21st.dev. Shader original; aquí sin interacción con el cursor.

const MENOS_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ===== Paletas =====
// tint: [cálido, frío] = color de los bordes de cada reflejo (null = espectro natural).
// Los colores de la interfaz están en estilos.css, en html[data-paleta="..."].
const PALETAS = {
  azul: { nombre: "Azul eléctrico", tint: ["#5b8cff", "#36d6ff"] },
  oceano: { nombre: "Océano", tint: ["#2f6bff", "#7ee8ff"] },
  hielo: { nombre: "Hielo", tint: ["#cfe6ff", "#4c9dff"] },
  indigo: { nombre: "Índigo", tint: ["#7c8cff", "#3f5bff"] },
  espectro: { nombre: "Espectro", tint: null }
};
const PALETA_INICIAL = "azul";

// ===== 1. Fondo Chrome Arcs =====

// Una vuelta en segundos a velocidad 1: cada anillo avanza un puesto y la luz oscila una vez.
const LOOP = 10;
const TAU = Math.PI * 2;
// La referencia mide 1179 x 1967 px; todo se mide en sus píxeles.
const REF_W = 1179;
const REF_H = 1967;
const VIEW_X = 590;
const VIEW_Y = 984;
const SWAY = 26;
const MAX_PIXELS = 2560 * 1600;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec4 uView;   // centro (px de referencia), px de referencia por px del dispositivo, densidad
uniform vec3 uMotion; // avance (0..1), desplazamiento de la luz, intensidad de los reflejos
uniform mat3 uTint;   // lleva el rojo, verde y azul del reflejo a los colores de la paleta
uniform float uSeed;

const vec2 C = vec2(3777.39, 2674.21);
const float R0 = 6657.9;
const float D1 = 2264.66;
const float LNQ = 0.0670042;

float sq(float x) { return x * x; }

const float CORE = 0.24;
const vec2 TAIL_R = vec2(0.40033, 0.33513);
const vec2 TAIL_G = vec2(0.38067, 0.32096);
const vec2 TAIL_B = vec2(0.35736, 0.32278);
const float BLOOM = 2.2;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float nudge(vec2 p) {
  vec2 q = clamp(p, vec2(0.0), vec2(${REF_W}.0, ${REF_H}.0)) / 1000.0 - vec2(0.6, 1.0);
  float X = q.x, Y = q.y;
  return -0.01066 + Y * (-0.0588 + Y * (0.02479 + Y * 0.12054))
    + X * (0.00943 + Y * (0.08212 + Y * 0.05649)) + X * X * (0.06149 - 0.00377 * Y) - 0.01411 * X * X * X;
}

float envelope(vec2 q, float a, float bx, float by, float bxx, float byy, float bxy, float cap) {
  return exp(min(a + bx * q.x + by * q.y + bxx * q.x * q.x + byy * q.y * q.y + bxy * q.x * q.y, cap));
}

vec2 meet(float ra, float x0, float sx) {
  float A = x0 - 1000.0 * sx - C.x;
  float a = sx * sx + 1.0, b = 2.0 * (A * sx - C.y), c = A * A + C.y * C.y - ra * ra;
  float y = (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
  return vec2(atan(y - C.y, x0 + sx * (y - 1000.0) - C.x), y);
}

float radius(float k) { return R0 - D1 * exp(LNQ * (k - 1.0)); }

float lobe(float d, float outer, float inner) {
  return 1.0 * exp(-sq(d / CORE)) + 0.31106 * exp(-abs(d) / (d > 0.0 ? outer : inner));
}
vec3 sheen(float phi) {
  return vec3(
    16.614 * lobe(phi - 0.11247, TAIL_R.x, TAIL_R.y),
    16.018 * lobe(phi + 0.040111, TAIL_G.x, TAIL_G.y),
    16.169 * lobe(phi + 0.17831, TAIL_B.x, TAIL_B.y));
}

vec3 band(float kp, float t, float th, float r, float w, float aa, vec4 env) {
  float m = uView.w, flow = uMotion.x;
  float kc = 4.5 + (kp + 0.5 - flow - 4.5) / m;

  float crest = 0.46263 + 0.070742 * (kc - 4.0) - 0.0040818 * (degrees(th) + 150.0);
  float spread = t < crest ? max(0.38553 - 0.071703 * (kc - 4.0), 0.03) : 0.12301;
  vec3 col = vec3(env.x * exp(-sq((t - crest) / spread)));
  col += env.y * exp(-sq((1.0 - t) / 0.16965)) * vec3(0.55, 0.7, 1.0);

  float t0 = 0.26151 + 0.032207 * (kc - 4.5);
  float ta = meet(radius(4.5 + (kp + t0 - flow - 4.5) / m), 536.54 + uMotion.y, 0.014062).x;
  float u = (th - ta) * r / w;
  float dt = t - t0;
  float bend = dt < 0.0 ? 8.3036 : 3.5178 - 0.021064 * (kc - 4.5);
  float phi = (-u + bend * dt * dt - 0.37954) * (1.0471 - 0.14429 * (kc - 4.5));
  col += uTint * sheen(phi) * env.w;
  col += BLOOM * env.w * exp(-sq((phi - 0.12) / 0.42) - sq(dt / 0.2)) * vec3(1.0, 0.9, 0.78);

  float rw = sqrt(0.000144 + aa * aa * 0.35);
  float prof = 0.012 / rw * exp(-sq(t / rw));
  if (prof > 1e-4) {
    float rk = radius(4.5 + (kp - flow - 4.5) / m);
    vec2 g = meet(rk, 613.43 + uMotion.y, 0.0);
    float s = (th - g.x) * rk;
    float hl = max(137.51 + 0.37297 * (g.y - 1000.0), 10.0);
    float o = -s - hl, i = s - hl;
    vec3 glint = exp(-max(max(vec3(o - 20.938, o, o + 31.302), vec3(i + 20.938, i, i - 31.302)), 0.0) / 76.225);
    col += prof * (vec3(env.z) + uTint * (25.0 * env.w * glint));
  }
  return col;
}

vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = uView.xy + (fc - 0.5 * uRes) * uView.z;
  vec2 d = p - C;
  float r = length(d);
  float th = atan(d.y, d.x);
  float gap = max(R0 - r, 1.0);
  float m = uView.w;
  float K = 4.5 + (1.0 + log(gap / D1) / LNQ + nudge(p) - 4.5) * m + uMotion.x;
  float w = gap * LNQ / m;
  float aa = uView.z / w;

  vec2 q = clamp(p, vec2(0.0), vec2(${REF_W}.0, ${REF_H}.0)) / 1000.0 - vec2(0.6, 1.0);
  float body = envelope(q, -3.7092, 2.4996, -4.3156, -4.975, -1.6414, 0.77581, 0.5);
  vec4 env = vec4(
    body,
    min(sqrt(body) * exp(-2.9914), 1.65),
    envelope(q, -9.7404, 26.18, -13.223, -19.901, -6.2186, 16.602, 1.0),
    envelope(q, -1.8032, -1.5862, -0.34234, -12.467, -1.9718, 7.467, 1.0) * uMotion.z
  );

  float kp = floor(K);
  float t = K - kp;
  vec3 col = band(kp, t, th, r, w, aa, env);
  if (t < aa * 0.5) col = mix(band(kp - 1.0, t + 1.0, th, r, w, aa, env), col, 0.5 + t / aa);
  else if (t > 1.0 - aa * 0.5) col = mix(band(kp + 1.0, t - 1.0, th, r, w, aa, env), col, 0.5 + (1.0 - t) / aa);

  col = encode(1.0 - exp(-col * 0.69504));
  col += (hash(fc + uSeed) - 0.5) * (3.0 / 255.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// Cualquier color CSS → RGB 0..1
function leerColor(css, ctx) {
  const hex = css.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  if (!ctx) return [0.5, 0.5, 0.5];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const p = ctx.getImageData(0, 0, 1, 1).data;
  return [p[0] / 255, p[1] / 255, p[2] / 255];
}
const lineal = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// El rojo del reflejo va al color cálido, el azul al frío, y el verde a lo que falte para blanco.
function matrizTinte(tint, ctx) {
  if (!tint) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const calido = leerColor(tint[0], ctx).map(lineal);
  const frio = leerColor(tint[1], ctx).map(lineal);
  const pico = Math.max(...calido.map((v, i) => v + frio[i]), 1e-3);
  const s = Math.min(1, 1 / pico);
  const medio = calido.map((v, i) => Math.max(0, 1 - s * (v + frio[i])));
  return new Float32Array([...calido.map((v) => v * s), ...medio, ...frio.map((v) => v * s)]);
}

// Píxeles de referencia por píxel CSS: más ancho muestra más arcos a los lados.
function escalaVista(w, h) {
  const aspecto = w / Math.max(h, 1);
  return aspecto >= 1 ? (REF_W * Math.sqrt(aspecto)) / w : REF_W / w;
}

function iniciarArcos(lienzo, { velocidad = 1, anillos = 1, intensidad = 1, tint = null } = {}) {
  const gl = lienzo.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return null;

  const compilar = (tipo, src) => {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("No se pudo enlazar el shader");
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (n) => gl.getUniformLocation(prog, n);
  const uRes = u("uRes"), uView = u("uView"), uMotion = u("uMotion"), uTint = u("uTint"), uSeed = u("uSeed");
  const sonda = document.createElement("canvas");
  sonda.width = sonda.height = 1;
  const ctxSonda = sonda.getContext("2d", { willReadFrequently: true });
  gl.uniformMatrix3fv(uTint, false, matrizTinte(tint, ctxSonda));

  const enMovimiento = !MENOS_MOVIMIENTO && velocidad > 0;
  let cw = 0, ch = 0, ref = 1;
  let raf = 0, reloj = 0, primer = null;
  const inicio = performance.now();
  const listo = new Promise((ok) => (primer = ok));

  function dibujar(ahora) {
    raf = 0;
    if (enMovimiento) reloj = ((ahora - inicio) / 1000) * velocidad;
    const vuelta = (((reloj / LOOP) % 1) + 1) % 1;
    const oscila = enMovimiento ? SWAY * Math.sin(TAU * vuelta) : 0;
    gl.uniform2f(uRes, cw, ch);
    gl.uniform4f(uView, VIEW_X, VIEW_Y, ref, Math.max(anillos, 0.1));
    gl.uniform3f(uMotion, vuelta, oscila, intensidad);
    gl.uniform1f(uSeed, enMovimiento ? Math.floor(reloj * 30) % 97 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    primer();
    if (enMovimiento && !document.hidden) raf = requestAnimationFrame(dibujar);
  }
  const pedirFotograma = () => { if (!raf) raf = requestAnimationFrame(dibujar); };

  function ajustar() {
    const r = lienzo.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / Math.max(r.width * r.height, 1)));
    cw = Math.max(1, Math.round(r.width * dpr));
    ch = Math.max(1, Math.round(r.height * dpr));
    if (lienzo.width !== cw || lienzo.height !== ch) {
      lienzo.width = cw;
      lienzo.height = ch;
    }
    ref = (escalaVista(r.width, r.height) * r.width) / cw;
    gl.viewport(0, 0, cw, ch);
    pedirFotograma();
  }
  new ResizeObserver(ajustar).observe(lienzo);
  ajustar();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pedirFotograma(); });
  lienzo.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    document.documentElement.classList.add("sin-webgl");
  });

  return {
    listo,
    cambiarTinte(nuevo) {
      gl.uniformMatrix3fv(uTint, false, matrizTinte(nuevo, ctxSonda));
      pedirFotograma();
    }
  };
}

// ===== 2. Paletas: cambian el tinte del fondo y los colores de la interfaz =====
function iniciarPaletas(arcos) {
  const raiz = document.documentElement;
  let guardada = null;
  try { guardada = localStorage.getItem("paleta-v2"); } catch {}
  const aplicar = (id) => {
    if (!PALETAS[id]) id = PALETA_INICIAL;
    raiz.dataset.paleta = id;
    arcos?.cambiarTinte(PALETAS[id].tint);
    document.querySelectorAll("[data-elegir-paleta]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.elegirPaleta === id));
    try { localStorage.setItem("paleta-v2", id); } catch {}
  };
  document.querySelectorAll("[data-elegir-paleta]").forEach((b) => {
    b.title = PALETAS[b.dataset.elegirPaleta]?.nombre ?? "";
    b.addEventListener("click", () => aplicar(b.dataset.elegirPaleta));
  });
  aplicar(guardada || PALETA_INICIAL);
}

// ===== 3. Smooth scrolling (Lenis) =====
function iniciarScrollSuave() {
  if (MENOS_MOVIMIENTO || !window.Lenis) return;
  const lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
  window.lenis = lenis; // el asistente lo usa para desplazarse entre pasos
  document.documentElement.classList.add("scroll-suave");
  (function bucle(t) {
    lenis.raf(t);
    requestAnimationFrame(bucle);
  })(performance.now());
  // Los enlaces internos (#asistente) también van suaves
  document.querySelectorAll('a[href^="#"]').forEach((a) =>
    a.addEventListener("click", (e) => {
      const destino = document.querySelector(a.getAttribute("href"));
      if (!destino) return;
      e.preventDefault();
      lenis.scrollTo(destino, { offset: -24 });
    })
  );
}

/** Desplaza suavemente hasta un elemento (con Lenis si está activo). */
window.desplazarA = (elemento, offset = -24) => {
  if (!elemento) return;
  if (window.lenis) window.lenis.scrollTo(elemento, { offset });
  else elemento.scrollIntoView({ behavior: MENOS_MOVIMIENTO ? "auto" : "smooth", block: "start" });
};

// ===== 4. Pantalla de carga con porcentaje =====
function pantallaDeCarga(fondoListo) {
  const cargador = document.getElementById("cargador");
  const cifra = document.getElementById("cargador-cifra");
  if (!cargador) return;
  const terminar = () => {
    cargador.classList.add("oculto-cargador");
    document.documentElement.classList.add("cargado");
    setTimeout(() => cargador.remove(), 900);
  };
  if (MENOS_MOVIMIENTO) return terminar();

  let valor = 0, completo = false;
  const t0 = performance.now();
  Promise.all([document.fonts?.ready, fondoListo].filter(Boolean)).finally(() => (completo = true));
  setTimeout(() => (completo = true), 3500);

  (function avanzar(ahora) {
    const minimo = Math.min(1, (ahora - t0) / 900);
    const objetivo = completo && minimo >= 1 ? 100 : Math.min(90, minimo * 90);
    valor += (objetivo - valor) * 0.18;
    cifra.textContent = `${Math.round(valor)}%`;
    if (valor > 99.5) {
      cifra.textContent = "100%";
      return setTimeout(terminar, 150);
    }
    requestAnimationFrame(avanzar);
  })(t0);
}

// ===== 5. Barra de la portada que se escribe sola =====
const EJEMPLOS = [
  "Una web para mi restaurante, con la carta y reservas…",
  "Una landing para presentar mi estudio de fotografía…",
  "La web de mi clínica en español e inglés…",
  "Una web corporativa para mi empresa de reformas…"
];

function barraQueSeEscribe() {
  const formulario = document.getElementById("barra-portada");
  const campo = document.getElementById("barra-portada-texto");
  if (!formulario || !campo) return;

  formulario.addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = campo.value.trim();
    if (!texto) return campo.focus();
    window.dispatchEvent(new CustomEvent("asistente:descripcion", { detail: { descripcion: texto } }));
    campo.value = "";
  });

  if (MENOS_MOVIMIENTO) return (campo.placeholder = EJEMPLOS[0]);

  let i = 0, letras = 0, borrando = false;
  (function escribir() {
    const activo = document.activeElement === campo || campo.value;
    if (!activo) {
      const frase = EJEMPLOS[i];
      letras += borrando ? -2 : 1;
      campo.placeholder = frase.slice(0, Math.max(0, letras));
      if (!borrando && letras >= frase.length) { borrando = true; return setTimeout(escribir, 1800); }
      if (borrando && letras <= 0) { borrando = false; i = (i + 1) % EJEMPLOS.length; }
    } else {
      campo.placeholder = "Describe la web que necesitas…";
    }
    setTimeout(escribir, borrando ? 22 : 45);
  })();
}

// ===== Arranque =====
let arcos = null;
try {
  const lienzo = document.getElementById("fondo-arcos");
  arcos = lienzo ? iniciarArcos(lienzo, { velocidad: 1, anillos: 1, intensidad: 1 }) : null;
  if (!arcos) document.documentElement.classList.add("sin-webgl");
} catch (err) {
  console.warn("Fondo Chrome Arcs no disponible:", err);
  document.documentElement.classList.add("sin-webgl");
}
iniciarPaletas(arcos);
iniciarScrollSuave();
pantallaDeCarga(arcos?.listo);
barraQueSeEscribe();
