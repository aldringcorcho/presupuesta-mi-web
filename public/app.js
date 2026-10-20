// Landing de "Presupuesta mi web".
// Los precios NO están aquí: todo sale de la API (/api/tarifas y /api/presupuesto).

document.documentElement.classList.add("js");

const menosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ===== 1. Smooth scroll con Lenis =====
let lenis = null;
if (window.Lenis && !menosMovimiento) {
  lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
  function bucle(tiempo) {
    lenis.raf(tiempo);
    requestAnimationFrame(bucle);
  }
  requestAnimationFrame(bucle);
}

// Los enlaces internos (#seccion) se desplazan suavemente, dejando hueco para la barra fija
document.querySelectorAll('a[href^="#"]').forEach((enlace) => {
  enlace.addEventListener("click", (e) => {
    const destino = document.querySelector(enlace.getAttribute("href"));
    if (!destino) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(destino, { offset: -90 });
    else destino.scrollIntoView({ behavior: menosMovimiento ? "auto" : "smooth" });
  });
});

// ===== 2. Efectos al hacer scroll =====
const nav = document.querySelector(".nav");
const manchas = document.querySelectorAll("[data-parallax]");
const enlacesNav = document.querySelectorAll(".nav__enlaces a");
const secciones = [...enlacesNav].map((a) => document.querySelector(a.getAttribute("href")));

function alHacerScroll() {
  const y = window.scrollY;
  nav.classList.toggle("nav--compacta", y > 40);

  if (!menosMovimiento) {
    // Las manchas oscilan con el scroll (sin salirse de pantalla), así el cristal siempre tiene color detrás
    manchas.forEach((m, i) => {
      const desplazamiento = Math.sin(y * 0.0015 + i * 1.7) * 900 * m.dataset.parallax;
      m.style.transform = `translate3d(${desplazamiento * 0.4}px, ${desplazamiento}px, 0)`;
    });
  }

  // Marca en la barra la sección que se está viendo
  let actual = -1;
  secciones.forEach((s, i) => {
    if (s && s.getBoundingClientRect().top < window.innerHeight * 0.4) actual = i;
  });
  enlacesNav.forEach((a, i) => a.classList.toggle("activo", i === actual));
}
if (lenis) lenis.on("scroll", alHacerScroll);
else window.addEventListener("scroll", alHacerScroll, { passive: true });
alHacerScroll();

// Aparición de los bloques cuando entran en pantalla
const observador = new IntersectionObserver(
  (entradas) => entradas.forEach((en) => {
    if (en.isIntersecting) {
      en.target.classList.add("visible");
      observador.unobserve(en.target);
    }
  }),
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
);
document.querySelectorAll(".revelar").forEach((el) => observador.observe(el));

// ===== 3. Liquid glass =====
// La refracción con filtro SVG solo funciona en Chromium (Chrome, Edge, Opera)
const esChromium = navigator.userAgentData?.brands?.some((b) => b.brand === "Chromium");
if (esChromium) document.documentElement.classList.add("refraccion");

// El reflejo del cristal y la luz del fondo siguen al ratón
const luzCursor = document.querySelector(".luz-cursor");
if (!menosMovimiento) {
  document.addEventListener("pointermove", (e) => {
    luzCursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    document.querySelectorAll(".cristal").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }, { passive: true });
}

// Efecto "descifrar" en el titular: las letras se van revelando
const titular = document.getElementById("titular-efecto");
if (titular && !menosMovimiento) {
  const final = titular.textContent;
  const simbolos = "▓▒░<>/\\{}[]#*01";
  const t0 = performance.now();
  const duracion = 1200;
  function descifrar(ahora) {
    const p = Math.min((ahora - t0) / duracion, 1);
    const reveladas = Math.floor(p * final.length);
    titular.textContent = [...final]
      .map((letra, i) => (i < reveladas || letra === " " ? letra : simbolos[Math.floor(Math.random() * simbolos.length)]))
      .join("");
    if (p < 1) requestAnimationFrame(descifrar);
  }
  setTimeout(() => requestAnimationFrame(descifrar), 300);
}

// ===== 4. Vista previa: ejemplo de landing o de web corporativa =====
const NOMBRES_PAGINAS = [
  "Inicio", "Servicios", "Nosotros", "Proyectos", "Blog", "Contacto", "Equipo", "Clientes", "Precios", "FAQ",
  "Empleo", "Prensa", "Casos", "Recursos", "Eventos", "Partners", "Soporte", "Legal", "Privacidad", "Cookies"
];
const pantalla = document.getElementById("pantalla");
const sitios = document.querySelectorAll("[data-sitio]");
const menuCorporativa = document.getElementById("menu-corporativa");
const mapa = document.getElementById("mapa");
const vistaUrl = document.getElementById("vista-url");
const vistaTipo = document.getElementById("vista-tipo");
let tipoAnterior = null;
let paginasAnteriores = 0;

function actualizarVista({ tipo, paginas, formulario, segundoIdioma }) {
  // Cambiar de ejemplo con una línea de escaneo
  if (tipo !== tipoAnterior) {
    sitios.forEach((s) => s.classList.toggle("activo", s.dataset.sitio === tipo));
    if (tipoAnterior !== null) {
      pantalla.classList.remove("escaneando");
      void pantalla.offsetWidth; // reinicia la animación
      pantalla.classList.add("escaneando");
    }
    tipoAnterior = tipo;
  }

  // Extras: formulario y selector de idioma
  const extras = { formulario, segundoIdioma };
  document.querySelectorAll("[data-extra]").forEach((el) => el.classList.toggle("activo", extras[el.dataset.extra]));

  // Barra del navegador y etiqueta
  const dominio = tipo === "landing" ? "orbita.app" : "vertice.es";
  vistaUrl.textContent = dominio + (segundoIdioma ? "/es" : "");
  vistaTipo.textContent = `${tipo === "landing" ? "Landing" : "Corporativa"} · ${paginas} ${paginas === 1 ? "página" : "páginas"}`;

  // Menú de la corporativa: hasta 4 páginas y "+N" con el resto
  const visibles = Math.min(paginas, 4);
  menuCorporativa.innerHTML =
    NOMBRES_PAGINAS.slice(0, visibles)
      .map((n, i) => `<span class="${i >= paginasAnteriores ? "nuevo" : ""}">${n}</span>`)
      .join("") + (paginas > visibles ? `<span class="s-menu__mas">+${paginas - visibles}</span>` : "");

  // Mapa del sitio: una pastilla por página (solo se animan las nuevas)
  mapa.innerHTML = NOMBRES_PAGINAS.slice(0, paginas)
    .map((n, i) => `<span class="${i >= paginasAnteriores ? "nueva" : ""}">/${i === 0 ? "" : n.toLowerCase()}</span>`)
    .join("");
  paginasAnteriores = paginas;
}

// ===== 5. Conexión con la API =====
let moneda = "EUR";
const formatear = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: moneda, maximumFractionDigits: 0, useGrouping: "always" }).format(n);

const AVISO_SERVIDOR = "No se puede conectar con la API. Arranca el servidor con <code>npm start</code> y abre <code>http://localhost:4000</code>.";

// Estado del servicio
fetch("/api/estado")
  .then((r) => r.json())
  .then((d) => {
    const ok = d.status === "ok";
    document.getElementById("punto-estado").classList.add(ok ? "ok" : "error");
    const el = document.getElementById("ruta-estado");
    el.textContent = ok ? '● en línea · {"status":"ok"}' : "● sin respuesta";
    el.classList.add(ok ? "ok" : "error");
  })
  .catch(() => {
    document.getElementById("punto-estado").classList.add("error");
    const el = document.getElementById("ruta-estado");
    el.textContent = "● sin conexión";
    el.classList.add("error");
  });

// Tarifas
const NOMBRES = {
  landing: ["Landing", ""],
  corporativa: ["Web corporativa", ""],
  paginaAdicional: ["Página adicional", "/ página"],
  formulario: ["Formulario", ""],
  segundoIdioma: ["Segundo idioma", ""]
};

fetch("/api/tarifas")
  .then((r) => r.json())
  .then((datos) => {
    moneda = datos.moneda;
    const lista = document.getElementById("lista-tarifas");
    lista.innerHTML = "";
    Object.entries(datos.tarifas).forEach(([clave, t], i) => {
      const [nombre, unidad] = NOMBRES[clave] || [clave, ""];
      const tarjeta = document.createElement("article");
      tarjeta.className = "tarifa cristal revelar" + (clave === "corporativa" ? " tarifa--destacada" : "");
      tarjeta.style.setProperty("--retraso", `${i * 0.07}s`);
      tarjeta.innerHTML = `
        <div>
          <h3>${nombre}</h3>
          <p class="tarifa__nombre">${t.descripcion}</p>
        </div>
        <span class="tarifa__precio">${formatear(t.precio)}<small>${unidad}</small></span>`;
      lista.appendChild(tarjeta);
      observador.observe(tarjeta);
    });
  })
  .catch(() => {
    document.getElementById("lista-tarifas").innerHTML = `<p class="mensaje-error cristal">${AVISO_SERVIDOR}</p>`;
  });

// Calculadora
const formulario = document.getElementById("formulario");
const deslizador = document.getElementById("paginas");
const salidaPaginas = document.getElementById("salida-paginas");
const caja = document.querySelector(".resultado");
const totalEl = document.getElementById("total");
const desglose = document.getElementById("desglose");
const aviso = document.getElementById("aviso");
const jsonPeticion = document.getElementById("json-peticion");

let totalMostrado = 0;
let peticionActual = 0;
let espera;

function leerFormulario() {
  return {
    tipo: formulario.tipo.value,
    paginas: Number(deslizador.value),
    formulario: formulario.formulario.checked,
    segundoIdioma: formulario.segundoIdioma.checked
  };
}

// El total "cuenta" hasta el nuevo valor
function animarTotal(destino) {
  const inicio = totalMostrado;
  const duracion = menosMovimiento ? 0 : 600;
  const t0 = performance.now();
  function paso(ahora) {
    const p = duracion ? Math.min((ahora - t0) / duracion, 1) : 1;
    const valor = Math.round(inicio + (destino - inicio) * (1 - Math.pow(1 - p, 3)));
    totalEl.textContent = formatear(valor);
    if (p < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
  totalMostrado = destino;
}

function pintarDesglose(r, datos) {
  const extra = datos.paginas - 1;
  const filas = [
    [`Base · ${datos.tipo === "landing" ? "Landing" : "Corporativa"}`, r.base],
    [`Páginas adicionales${extra ? ` (${extra})` : ""}`, r.paginasAdicionales],
    ["Formulario de contacto", r.formulario],
    ["Segundo idioma", r.segundoIdioma]
  ];
  desglose.innerHTML = filas
    .map(([texto, valor]) => `<li class="${valor ? "" : "cero"}"><span>${texto}</span><b>${formatear(valor)}</b></li>`)
    .join("");
}

async function calcular() {
  const datos = leerFormulario();
  jsonPeticion.textContent = JSON.stringify(datos, null, 2);
  const id = ++peticionActual;
  caja.classList.add("cargando");

  try {
    const r = await fetch("/api/presupuesto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });
    const cuerpo = await r.json();
    if (id !== peticionActual) return; // ya hay una petición más nueva

    if (!r.ok) {
      aviso.innerHTML = `<b>${cuerpo.error}</b><ul>${(cuerpo.detalles || []).map((d) => `<li>${d}</li>`).join("")}</ul>`;
      aviso.hidden = false;
      return;
    }
    aviso.hidden = true;
    moneda = cuerpo.moneda;
    pintarDesglose(cuerpo, datos);
    animarTotal(cuerpo.total);
  } catch {
    if (id !== peticionActual) return;
    aviso.innerHTML = AVISO_SERVIDOR;
    aviso.hidden = false;
  } finally {
    if (id === peticionActual) caja.classList.remove("cargando");
  }
}

function actualizarDeslizador() {
  salidaPaginas.textContent = deslizador.value;
  const progreso = ((deslizador.value - deslizador.min) / (deslizador.max - deslizador.min)) * 100;
  deslizador.style.setProperty("--progreso", `${progreso}%`);
}

formulario.addEventListener("input", () => {
  actualizarDeslizador();
  actualizarVista(leerFormulario()); // la vista cambia al instante, sin esperar a la API
  clearTimeout(espera);
  espera = setTimeout(calcular, 120);
});
formulario.addEventListener("submit", (e) => e.preventDefault());

actualizarDeslizador();
actualizarVista(leerFormulario());
calcular();
