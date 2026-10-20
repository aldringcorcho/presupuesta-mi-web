const express = require("express");
const TARIFAS = require("./src/tarifas");
const { validarSolicitud } = require("./src/validar");
const { calcularPresupuesto } = require("./src/calcular");

const app = express();
const PORT = process.env.PORT || 4000;

// Para poder leer el JSON que nos envían (lo guarda en req.body)
app.use(express.json());

// Portada: lista de rutas
app.get("/", (req, res) => {
  res.json({
    mensaje: "API Presupuesta mi web",
    rutas: ["GET /api/estado", "GET /api/tarifas", "POST /api/presupuesto"]
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

// Si piden una ruta que no existe
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

// Si envían un JSON mal escrito u ocurre otro fallo
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Solicitud incorrecta", detalles: ["El cuerpo no es un JSON válido."] });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// Encender el servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});