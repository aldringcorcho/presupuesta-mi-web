const path = require("path");
const express = require("express");
const TARIFAS = require("./src/tarifas");
const { validarSolicitud } = require("./src/validar");
const { calcularPresupuesto } = require("./src/calcular");
const { CATALOGO, PAGINAS_MIN, PAGINAS_MAX } = require("./src/catalogo");
const {
  ErrorIA,
  pedirPropuesta,
  validarRespuestaIA,
  validarSolicitudCliente,
  enriquecerPropuesta
} = require("./src/asistente");
const { validarSeleccion, construirPresupuesto } = require("./src/confirmar");
const { generarPdf } = require("./src/pdf");

const app = express();
const PORT = process.env.PORT || 4000;

// Para poder leer el JSON que nos envían (lo guarda en req.body).
// Límite pequeño: la descripción más larga permitida cabe de sobra.
app.use(express.json({ limit: "32kb" }));

// Portada: la landing (carpeta public/)
app.use(express.static(path.join(__dirname, "public")));

// Lista de rutas de la API
app.get("/api", (req, res) => {
  res.json({
    mensaje: "API Presupuesta mi web",
    rutas: [
      "GET /api/estado",
      "GET /api/tarifas",
      "POST /api/presupuesto",
      "GET /api/catalogo",
      "POST /api/propuesta",
      "POST /api/confirmar",
      "POST /api/presupuesto/pdf"
    ]
  });
});

// RUTA 1: comprobar que el servidor funciona
app.get("/api/estado", (req, res) => {
  res.json({ status: "ok" });
});

// RUTA 2: mostrar las tarifas
app.get("/api/tarifas", (req, res) => {
  res.json({
    moneda: TARIFAS.moneda,
    tarifas: {
      landing: { descripcion: "Landing, incluida la primera página", precio: TARIFAS.landing },
      corporativa: { descripcion: "Web corporativa, incluida la primera página", precio: TARIFAS.corporativa },
      paginaAdicional: { descripcion: "Cada página adicional a la primera", precio: TARIFAS.paginaAdicional },
      formulario: { descripcion: "Formulario de contacto", precio: TARIFAS.formulario },
      segundoIdioma: { descripcion: "Segundo idioma", precio: TARIFAS.segundoIdioma }
    }
  });
});

// RUTA 3: calcular un presupuesto
app.post("/api/presupuesto", (req, res) => {
  // PASO 1: comprobar que nos envían JSON
  if (!req.is("application/json")) {
    return res.status(400).json({
      error: "Solicitud incorrecta",
      detalles: ["La cabecera Content-Type debe ser application/json."]
    });
  }

  // PASO 2: validar los datos (el "portero")
  const resultado = validarSolicitud(req.body);
  if (!resultado.ok) {
    return res.status(400).json({ error: "Solicitud incorrecta", detalles: resultado.errores });
  }

  // PASO 3: calcular, solo si todo está bien
  const presupuesto = calcularPresupuesto(resultado.datos);
  res.status(200).json(presupuesto);
});

// ===== Asistente con IA =====

// Todas las rutas POST del asistente exigen JSON.
function exigirJson(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(400).json({
      error: "Solicitud incorrecta",
      detalles: ["La cabecera Content-Type debe ser application/json."]
    });
  }
  next();
}

// RUTA 4: catálogo de servicios (para añadir servicios en la revisión)
app.get("/api/catalogo", (req, res) => {
  res.json({
    moneda: TARIFAS.moneda,
    paginas: { min: PAGINAS_MIN, max: PAGINAS_MAX },
    servicios: CATALOGO
  });
});

// RUTA 5: la IA interpreta la solicitud y propone servicios del catálogo
app.post("/api/propuesta", exigirJson, async (req, res) => {
  const solicitud = validarSolicitudCliente(req.body);
  if (!solicitud.ok) {
    return res.status(400).json({ error: "Solicitud incorrecta", detalles: solicitud.errores });
  }

  try {
    const json = await pedirPropuesta(solicitud.datos);
    const propuesta = enriquecerPropuesta(validarRespuestaIA(json));
    res.json({ cliente: solicitud.datos.cliente, ...propuesta });
  } catch (err) {
    if (!(err instanceof ErrorIA)) throw err;
    // Al usuario solo le llega el mensaje amable; el detalle técnico se queda en el log.
    console.error("[OpenAI]", err.message, err.causa ?? "");
    res.status(err.estado).json({ error: err.message, reintentar: err.reintentar });
  }
});

// RUTA 6: el servidor valida la selección confirmada y calcula los importes
app.post("/api/confirmar", exigirJson, (req, res) => {
  const seleccion = validarSeleccion(req.body);
  if (!seleccion.ok) {
    return res.status(400).json({ error: "Selección incompleta", detalles: seleccion.errores });
  }
  res.json(construirPresupuesto(seleccion.datos));
});

// RUTA 7: PDF del presupuesto. Se vuelve a validar y calcular: no se fía de importes del navegador.
app.post("/api/presupuesto/pdf", exigirJson, async (req, res) => {
  const seleccion = validarSeleccion(req.body);
  if (!seleccion.ok) {
    return res.status(400).json({ error: "Selección incompleta", detalles: seleccion.errores });
  }
  const presupuesto = construirPresupuesto(seleccion.datos);
  const pdf = await generarPdf(presupuesto);
  const archivo = `presupuesto-${slug(presupuesto.cliente)}-${presupuesto.fecha}.pdf`;
  res
    .status(200)
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo}"`,
      "Content-Length": pdf.length,
      "Cache-Control": "no-store"
    })
    .send(pdf);
});

function slug(texto) {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "cliente"
  );
}

// Si piden una ruta que no existe
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

// Si envían un JSON mal escrito u ocurre otro fallo
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Solicitud incorrecta", detalles: ["El cuerpo no es un JSON válido."] });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Solicitud demasiado grande", detalles: ["El texto enviado es demasiado largo."] });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// Se exporta la app para las pruebas y para Vercel.
module.exports = app;

// Encender el servidor solo si se ejecuta directamente (npm start / npm run dev)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor funcionando en http://localhost:${PORT}`);
    if (!process.env.OPENAI_API_KEY) {
      console.warn("Aviso: falta OPENAI_API_KEY en .env; el asistente de IA no funcionará.");
    }
  });
}