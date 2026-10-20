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
const fondo = document.querySelector(".fondo");
// Si el ratón sale de la ventana, la luz se apaga
document.documentElement.addEventListener("mouseleave", () => fondo.classList.remove("con-cursor"));
if (!menosMovimiento) {
  document.addEventListener("pointermove", (e) => {
    luzCursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    fondo.style.setProperty("--cx", `${e.clientX}px`);
    fondo.style.setProperty("--cy", `${e.clientY}px`);
    fondo.classList.add("con-cursor");
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

// ===== Características: lista numerada + panel (en móvil, acordeón) =====
const elementosLista = document.querySelectorAll("#lista-caracteristicas li");
const itemsPanel = document.querySelectorAll("#panel-caracteristicas .panel__item");

// En móvil el contenido se abre debajo de cada punto: copiamos el del panel
elementosLista.forEach((li, i) => {
  const copia = document.createElement("div");
  copia.className = "panel-movil cristal";
  copia.innerHTML = itemsPanel[i].innerHTML;
  li.querySelector(".lista-caracteristicas__movil > div").appendChild(copia);
});

let caracteristicaActiva = 0;
function activarCaracteristica(indice) {
  if (indice === caracteristicaActiva) return;
  const anterior = itemsPanel[caracteristicaActiva];
  anterior.classList.remove("activo");
  anterior.classList.add("saliendo");
  setTimeout(() => anterior.classList.remove("saliendo"), 350);
  itemsPanel[indice].classList.add("activo");

  elementosLista.forEach((li, i) => {
    li.classList.toggle("activo", i === indice);
    li.querySelector("button").setAttribute("aria-expanded", i === indice);
  });
  caracteristicaActiva = indice;
}
elementosLista[0].classList.add("activo");
elementosLista.forEach((li, i) => li.querySelector("button").addEventListener("click", () => activarCaracteristica(i)));

// ===== 4. Conexión con la API (estado y tarifas; la calculadora está en calculadora.js, hecha con React) =====
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
