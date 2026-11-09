const TARIFAS = require("./tarifas");

// Catálogo de servicios que puede proponer el asistente.
// Los precios NO se escriben aquí: las reglas se generan a partir de TARIFAS,
// que sigue siendo el único sitio donde están los importes.
//
// categoria "tipo"  → tipo de web: el presupuesto lleva exactamente uno.
// categoria "extra" → servicios opcionales que se suman al tipo de web.
// requiere          → datos que el usuario tiene que completar para calcular la partida.
const CATALOGO = Object.freeze([
  Object.freeze({
    id: "landing",
    nombre: "Landing page",
    categoria: "tipo",
    descripcion:
      "Web de presentación sencilla, pensada para una sola página con las secciones principales del negocio (presentación, servicios y contacto). Incluye la primera página; cada página adicional se presupuesta aparte.",
    regla: `${TARIFAS.landing} € (incluye la primera página) + ${TARIFAS.paginaAdicional} € por cada página adicional`,
    requiere: Object.freeze(["paginas"])
  }),
  Object.freeze({
    id: "corporativa",
    nombre: "Web corporativa",
    categoria: "tipo",
    descripcion:
      "Web de empresa con varias secciones o páginas (por ejemplo, inicio, quiénes somos, servicios, carta o catálogo y contacto). Incluye la primera página; cada página adicional se presupuesta aparte.",
    regla: `${TARIFAS.corporativa} € (incluye la primera página) + ${TARIFAS.paginaAdicional} € por cada página adicional`,
    requiere: Object.freeze(["paginas"])
  }),
  Object.freeze({
    id: "formulario",
    nombre: "Formulario de contacto",
    categoria: "extra",
    descripcion:
      "Formulario para que los visitantes envíen mensajes o solicitudes (por ejemplo, de contacto o de reserva), que llegan por correo electrónico. No incluye gestión de disponibilidad, calendario ni pagos.",
    regla: `${TARIFAS.formulario} € (precio fijo)`,
    requiere: Object.freeze([])
  }),
  Object.freeze({
    id: "segundo-idioma",
    nombre: "Segundo idioma",
    categoria: "extra",
    descripcion: "Versión completa de la web en un segundo idioma, con selector de idioma.",
    regla: `${TARIFAS.segundoIdioma} € (precio fijo)`,
    requiere: Object.freeze([])
  })
]);

const IDS = Object.freeze(CATALOGO.map((s) => s.id));
const POR_ID = Object.freeze(Object.fromEntries(CATALOGO.map((s) => [s.id, s])));

/** Límites del dato «paginas» (los mismos que la calculadora original). */
const PAGINAS_MIN = 1;
const PAGINAS_MAX = 20;

module.exports = { CATALOGO, IDS, POR_ID, PAGINAS_MIN, PAGINAS_MAX };
