// Confirmación de la selección final y cálculo del presupuesto.
// Recibe lo que el usuario ha revisado (servicios, páginas, aclaraciones) y lo
// vuelve a validar: nunca se fía de importes ni de descripciones del navegador.

const TARIFAS = require("./tarifas");
const { POR_ID, IDS, PAGINAS_MIN, PAGINAS_MAX } = require("./catalogo");
const { calcularPresupuesto } = require("./calcular");
const { MAX_CLIENTE } = require("./asistente");

const MAX_RESUMEN = 800;
const MAX_PENDIENTE = 400;
const MAX_PENDIENTES = 15;

function texto(valor, max) {
  return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Valida la selección confirmada. Devuelve { ok, datos } o { ok: false, errores }. */
function validarSeleccion(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errores: ["El cuerpo de la petición debe ser un objeto JSON."] };
  }
  const errores = [];

  const cliente = texto(body.cliente, MAX_CLIENTE + 1);
  if (!cliente) errores.push("Falta el nombre del cliente o de la empresa.");
  else if (cliente.length > MAX_CLIENTE) errores.push(`El nombre no puede superar los ${MAX_CLIENTE} caracteres.`);

  const resumen = texto(body.resumen, MAX_RESUMEN);
  if (!resumen) errores.push("Falta el resumen del proyecto.");

  if (!Array.isArray(body.servicios)) {
    errores.push('"servicios" debe ser una lista de identificadores del catálogo.');
    return { ok: false, errores };
  }
  const servicios = [];
  for (const id of body.servicios) {
    if (typeof id !== "string" || !IDS.includes(id)) {
      errores.push(`El servicio ${JSON.stringify(id)} no existe en el catálogo.`);
    } else if (!servicios.includes(id)) {
      servicios.push(id);
    }
  }

  const tipos = servicios.filter((id) => POR_ID[id].categoria === "tipo");
  if (tipos.length === 0) errores.push("Elige un tipo de web (landing o web corporativa) para poder calcular el presupuesto.");
  if (tipos.length > 1) errores.push("Elige solo un tipo de web: landing o web corporativa, no las dos.");

  // Dato necesario para calcular la partida del tipo de web.
  const paginas = body.paginas;
  if (tipos.length === 1 && (!Number.isInteger(paginas) || paginas < PAGINAS_MIN || paginas > PAGINAS_MAX)) {
    errores.push(`Indica el número total de páginas: un número entero entre ${PAGINAS_MIN} y ${PAGINAS_MAX}.`);
  }

  const pendientes = [];
  for (const p of Array.isArray(body.pendientes) ? body.pendientes : []) {
    const t = texto(typeof p === "string" ? p : p?.texto, MAX_PENDIENTE);
    if (t) pendientes.push(t);
    if (pendientes.length >= MAX_PENDIENTES) break;
  }

  if (errores.length) return { ok: false, errores };
  return { ok: true, datos: { cliente, resumen, servicios, paginas, pendientes } };
}

const euros = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: TARIFAS.moneda, maximumFractionDigits: 0, useGrouping: "always" }).format(n);

/**
 * Calcula el presupuesto con las tarifas del servidor y lo devuelve listo para
 * mostrar y para el PDF: líneas con concepto, descripción, detalle e importe.
 */
function construirPresupuesto({ cliente, resumen, servicios, paginas, pendientes }, fecha = new Date()) {
  const tipo = servicios.find((id) => POR_ID[id].categoria === "tipo");
  const importes = calcularPresupuesto({
    tipo,
    paginas,
    formulario: servicios.includes("formulario"),
    segundoIdioma: servicios.includes("segundo-idioma")
  });

  const lineas = [
    {
      id: tipo,
      concepto: POR_ID[tipo].nombre,
      descripcion: POR_ID[tipo].descripcion,
      detalle: "Incluye la primera página",
      importe: importes.base
    }
  ];
  if (paginas > 1) {
    lineas.push({
      id: "paginas-adicionales",
      concepto: "Páginas adicionales",
      descripcion: "Cada página a partir de la segunda.",
      detalle: `${paginas - 1} × ${euros(TARIFAS.paginaAdicional)}`,
      importe: importes.paginasAdicionales
    });
  }
  if (servicios.includes("formulario")) {
    lineas.push({ id: "formulario", concepto: POR_ID.formulario.nombre, descripcion: POR_ID.formulario.descripcion, detalle: "Precio fijo", importe: importes.formulario });
  }
  if (servicios.includes("segundo-idioma")) {
    lineas.push({ id: "segundo-idioma", concepto: POR_ID["segundo-idioma"].nombre, descripcion: POR_ID["segundo-idioma"].descripcion, detalle: "Precio fijo", importe: importes.segundoIdioma });
  }

  // Comprobación de coherencia: el total es la suma de las líneas.
  const suma = lineas.reduce((s, l) => s + l.importe, 0);
  if (suma !== importes.total) throw new Error(`Descuadre en el presupuesto: ${suma} ≠ ${importes.total}`);

  return {
    cliente,
    fecha: fecha.toISOString().slice(0, 10),
    resumen,
    paginas,
    servicios,
    lineas,
    total: importes.total,
    moneda: importes.moneda,
    pendientes
  };
}

module.exports = { validarSeleccion, construirPresupuesto, euros };
