// Pruebas del asistente con IA, de la confirmación y del PDF.
// No se llama a OpenAI de verdad: levantamos un "OpenAI falso" en local y la app
// lo usa gracias a la variable OPENAI_URL. Así podemos simular respuestas buenas,
// respuestas con trampas y fallos (500, 429, sin conexión...).
// Uso: npm test   (o solo estas: node --test pruebas/asistente.test.js)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// ----- OpenAI falso -----
let siguiente = null; // función (peticion) => { estado, cuerpo } para la próxima llamada
let ultimaPeticion = null; // lo que la app envió a "OpenAI"
let llamadas = 0;

/** Respuesta con la forma de la Responses API que contiene el JSON del modelo. */
function respuestaModelo(json) {
  return {
    estado: 200,
    cuerpo: {
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(json) }] }]
    }
  };
}

const openaiFalso = http.createServer((req, res) => {
  let datos = "";
  req.on("data", (c) => (datos += c));
  req.on("end", () => {
    llamadas++;
    ultimaPeticion = { cabeceras: req.headers, cuerpo: JSON.parse(datos) };
    const { estado, cuerpo, crudo } = siguiente(ultimaPeticion);
    res.writeHead(estado, { "Content-Type": "application/json" });
    res.end(crudo ?? JSON.stringify(cuerpo));
  });
});

// ----- App real -----
let app, servidor, BASE;

before(async () => {
  await new Promise((ok) => openaiFalso.listen(0, ok));
  process.env.OPENAI_URL = `http://localhost:${openaiFalso.address().port}/v1/responses`;
  process.env.OPENAI_API_KEY = "sk-falsa-solo-para-pruebas";
  process.env.OPENAI_MODEL = "modelo-de-prueba";
  app = require("../server");
  servidor = await new Promise((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  BASE = `http://localhost:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  openaiFalso.close();
});

const post = (ruta, body) =>
  fetch(BASE + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const RESTAURANTE =
  "Necesito una web para un restaurante. Quiero mostrar la carta, tener un formulario para solicitar reservas y ofrecer el contenido en dos idiomas.";

// ===== 1. Solicitud clara que encaja con el catálogo =====
test("1 · solicitud clara: propone servicios del catálogo con justificación", async () => {
  siguiente = () =>
    respuestaModelo({
      resumen: "Web para un restaurante ficticio con la carta, solicitud de reservas y contenido en dos idiomas.",
      servicios: [
        { id: "corporativa", justificacion: "Hacen falta varias secciones: inicio, carta y contacto." },
        { id: "formulario", justificacion: "Permite a los clientes enviar solicitudes de reserva." },
        { id: "segundo-idioma", justificacion: "El cliente quiere el contenido en dos idiomas." }
      ],
      paginas: null,
      pendientes: [{ tipo: "aclaracion", texto: "¿Cuántas páginas tendrá la web (inicio, carta, contacto...)?" }]
    });

  const r = await post("/api/propuesta", { cliente: "Restaurante La Prueba S.L.", descripcion: RESTAURANTE });
  assert.equal(r.status, 200);
  const p = await r.json();

  assert.deepEqual(p.servicios.map((s) => s.id), ["corporativa", "formulario", "segundo-idioma"]);
  assert.ok(p.servicios.every((s) => s.justificacion && s.nombre && s.descripcion));
  assert.equal(p.paginas, null);
  assert.ok(p.resumen.includes("restaurante"));
  assert.equal(p.cliente, "Restaurante La Prueba S.L.");
  // La respuesta no lleva importes: esos solo los da /api/confirmar
  assert.ok(!("total" in p));

  // Lo que se envió a OpenAI: clave en la cabecera, catálogo, descripción y salida estructurada
  assert.equal(ultimaPeticion.cabeceras.authorization, "Bearer sk-falsa-solo-para-pruebas");
  assert.equal(ultimaPeticion.cuerpo.model, "modelo-de-prueba");
  assert.equal(ultimaPeticion.cuerpo.text.format.type, "json_schema");
  assert.equal(ultimaPeticion.cuerpo.text.format.strict, true);
  const usuario = ultimaPeticion.cuerpo.input.find((m) => m.role === "user").content;
  assert.ok(usuario.includes('"id": "segundo-idioma"'), "se envía el catálogo");
  assert.ok(usuario.includes(RESTAURANTE), "se envía la descripción");
  assert.ok(!usuario.includes("600"), "al modelo no se le envían precios");
});

// ===== 2. Solicitud ambigua que necesita aclaraciones =====
test("2 · solicitud ambigua: devuelve dudas y exige completar las páginas", async () => {
  siguiente = () =>
    respuestaModelo({
      resumen: "El cliente quiere una web para su negocio, sin concretar contenido ni tamaño.",
      servicios: [{ id: "landing", justificacion: "Una web sencilla parece suficiente de entrada." }],
      paginas: null,
      pendientes: [
        { tipo: "aclaracion", texto: "¿A qué se dedica el negocio y qué secciones necesita?" },
        { tipo: "aclaracion", texto: "¿Necesita que los visitantes puedan contactar mediante un formulario?" }
      ]
    });

  const r = await post("/api/propuesta", { cliente: "Negocio Ficticio", descripcion: "Quiero una web para mi negocio." });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.pendientes.length, 2);
  assert.ok(p.pendientes.every((x) => x.tipo === "aclaracion"));

  // Sin el número de páginas no se puede calcular la partida: el servidor lo pide
  const c = await post("/api/confirmar", {
    cliente: p.cliente,
    resumen: p.resumen,
    servicios: p.servicios.map((s) => s.id),
    paginas: null,
    pendientes: p.pendientes
  });
  assert.equal(c.status, 400);
  const e = await c.json();
  assert.match(e.detalles.join(" "), /número total de páginas/);
});

// ===== 3. Petición de un servicio que no ofrecemos =====
test("3 · servicio fuera de catálogo: se señala como pendiente y se descartan ids inventados", async () => {
  siguiente = () =>
    respuestaModelo({
      resumen: "Tienda online de ropa con pasarela de pago. Precio estimado: 2.000 €.",
      servicios: [
        { id: "tienda-online", justificacion: "Para vender productos." }, // inventado: no existe en el catálogo
        { id: "corporativa", justificacion: "Para mostrar los productos. Costará unos 600 € y estará en 2 semanas." }
      ],
      paginas: 5,
      pendientes: [
        { tipo: "fuera_de_catalogo", texto: "Tienda online con carrito y pasarela de pago: pendiente de valorar." }
      ]
    });

  const r = await post("/api/propuesta", {
    cliente: "Moda Ficticia",
    descripcion: "Quiero una tienda online para vender ropa con pago con tarjeta."
  });
  assert.equal(r.status, 200);
  const p = await r.json();

  assert.deepEqual(p.servicios.map((s) => s.id), ["corporativa"], "solo quedan ids del catálogo");
  assert.ok(p.avisos.some((a) => a.includes("tienda-online")), "se avisa del servicio descartado");
  assert.ok(p.pendientes.some((x) => x.tipo === "fuera_de_catalogo"));
  // Ni precios ni plazos inventados por el modelo
  assert.ok(!/€|semanas/.test(p.resumen + p.servicios[0].justificacion));
  assert.equal(p.paginas, 5);
});

// ===== 4. Descripción vacía =====
test("4 · descripción vacía o demasiado larga: 400 sin llamar a OpenAI", async () => {
  const antes = llamadas;

  let r = await post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: "   " });
  assert.equal(r.status, 400);
  assert.match((await r.json()).detalles.join(" "), /no puede estar vacía/);

  r = await post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: "x".repeat(2001) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).detalles.join(" "), /2000 caracteres/);

  r = await post("/api/propuesta", { cliente: "", descripcion: RESTAURANTE });
  assert.equal(r.status, 400);

  assert.equal(llamadas, antes, "no se ha gastado ninguna llamada a OpenAI");
});

// ===== 5. Fallo en la llamada a OpenAI =====
test("5 · fallos de OpenAI: mensaje claro y opción de reintentar", async (t) => {
  const pedir = () => post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: RESTAURANTE });

  await t.test("error 500 del servicio", async () => {
    siguiente = () => ({ estado: 500, cuerpo: { error: { message: "server error" } } });
    const r = await pedir();
    assert.equal(r.status, 502);
    const e = await r.json();
    assert.equal(e.reintentar, true);
    assert.match(e.error, /no está disponible/);
  });

  await t.test("límite o saldo agotado (429)", async () => {
    siguiente = () => ({ estado: 429, cuerpo: { error: { message: "rate limit" } } });
    const r = await pedir();
    assert.equal(r.status, 429);
    assert.equal((await r.json()).reintentar, true);
  });

  await t.test("respuesta que no es JSON", async () => {
    siguiente = () => ({ estado: 200, crudo: "<html>error</html>" });
    const r = await pedir();
    assert.equal(r.status, 502);
  });

  await t.test("el modelo devuelve JSON mal formado", async () => {
    siguiente = () => ({
      estado: 200,
      cuerpo: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{resumen:" }] }] }
    });
    const r = await pedir();
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /formato inesperado/);
  });

  await t.test("sin conexión con OpenAI", async () => {
    const url = process.env.OPENAI_URL;
    process.env.OPENAI_URL = "http://localhost:1/v1/responses"; // puerto cerrado
    try {
      const r = await pedir();
      assert.equal(r.status, 502);
      const e = await r.json();
      assert.match(e.error, /No se pudo conectar/);
      assert.equal(e.reintentar, true);
    } finally {
      process.env.OPENAI_URL = url;
    }
  });

  await t.test("reintento con éxito tras el fallo", async () => {
    siguiente = () =>
      respuestaModelo({
        resumen: "Web sencilla para un cliente ficticio.",
        servicios: [{ id: "landing", justificacion: "Basta con una página." }],
        paginas: 1,
        pendientes: []
      });
    const r = await pedir();
    assert.equal(r.status, 200);
  });

  await t.test("sin clave configurada", async () => {
    const clave = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const r = await pedir();
      assert.equal(r.status, 503);
      assert.equal((await r.json()).reintentar, false);
    } finally {
      process.env.OPENAI_API_KEY = clave;
    }
  });
});

// ===== 6. Modificar los servicios antes de descargar el PDF =====
test("6 · modificar la selección: el servidor recalcula y el PDF usa la selección final", async () => {
  // Propuesta inicial de la IA: corporativa + formulario + segundo idioma
  const base = { cliente: "Restaurante La Prueba S.L.", resumen: "Web para un restaurante ficticio." };

  let r = await post("/api/confirmar", { ...base, servicios: ["corporativa", "formulario", "segundo-idioma"], paginas: 4, pendientes: [] });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).total, 600 + 3 * 50 + 80 + 150); // 980

  // El usuario quita el segundo idioma, cambia a landing de 2 páginas y añade una aclaración.
  // Además intenta colar un total y un precio: el servidor los ignora.
  const final = {
    ...base,
    servicios: ["landing", "formulario"],
    paginas: 2,
    pendientes: ["Confirmar si la carta se actualiza cada temporada."],
    total: 1,
    lineas: [{ concepto: "Regalo", importe: -500 }]
  };
  r = await post("/api/confirmar", final);
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.total, 300 + 50 + 80); // 430
  assert.deepEqual(p.lineas.map((l) => l.id), ["landing", "paginas-adicionales", "formulario"]);
  assert.equal(p.lineas.reduce((s, l) => s + l.importe, 0), p.total);
  assert.deepEqual(p.pendientes, ["Confirmar si la carta se actualiza cada temporada."]);

  // El PDF se genera a partir de la misma selección final
  r = await post("/api/presupuesto/pdf", final);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(r.headers.get("content-disposition"), /presupuesto-restaurante-la-prueba-s-l-\d{4}-\d{2}-\d{2}\.pdf/);
  const pdf = Buffer.from(await r.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");

  // Y el contenido del documento coincide con lo calculado por el servidor
  const { definicionDocumento } = require("../src/pdf");
  const texto = JSON.stringify(definicionDocumento(p));
  for (const trozo of ["Restaurante La Prueba S.L.", "Landing page", "Páginas adicionales", "Formulario de contacto", "430", "cada temporada"]) {
    assert.ok(texto.includes(trozo), `el PDF incluye «${trozo}»`);
  }
  assert.ok(!texto.includes("Segundo idioma"), "el servicio eliminado no aparece");
  assert.ok(!texto.includes("Regalo"), "las líneas enviadas por el navegador se ignoran");
});

test("6b · selecciones no válidas: servicio inexistente o dos tipos de web", async () => {
  const base = { cliente: "Cliente Ficticio", resumen: "Resumen.", paginas: 2, pendientes: [] };

  let r = await post("/api/confirmar", { ...base, servicios: ["landing", "tienda-online"] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).detalles.join(" "), /no existe en el catálogo/);

  r = await post("/api/confirmar", { ...base, servicios: ["landing", "corporativa"] });
  assert.equal(r.status, 400);

  r = await post("/api/confirmar", { ...base, servicios: ["formulario"] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).detalles.join(" "), /tipo de web/);

  r = await post("/api/presupuesto/pdf", { ...base, servicios: ["tienda-online"] });
  assert.equal(r.status, 400);
});

test("catálogo: GET /api/catalogo devuelve los servicios con su regla de precio", async () => {
  const r = await fetch(BASE + "/api/catalogo");
  const c = await r.json();
  assert.deepEqual(c.servicios.map((s) => s.id), ["landing", "corporativa", "formulario", "segundo-idioma"]);
  assert.ok(c.servicios.every((s) => s.id && s.nombre && s.descripcion && s.regla));
});
