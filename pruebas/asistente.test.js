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

// ===== Mejoras de la IA: tono, preguntas guiadas, ajustes y segunda ronda =====

test("tono: cercano por defecto, formal si se pide y error si no es válido", async () => {
  siguiente = () => respuestaModelo({ resumen: "Web sencilla.", servicios: [], paginas: null, preguntaPrecioOPlazo: false, pendientes: [] });

  await post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: RESTAURANTE });
  let sistema = ultimaPeticion.cuerpo.input.find((m) => m.role === "system").content;
  assert.match(sistema, /tono CERCANO/);
  assert.match(sistema, /de "tú"/);

  await post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: RESTAURANTE, tono: "formal" });
  sistema = ultimaPeticion.cuerpo.input.find((m) => m.role === "system").content;
  assert.match(sistema, /tono FORMAL/);
  assert.match(sistema, /de "usted"/);

  const r = await post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: RESTAURANTE, tono: "pirata" });
  assert.equal(r.status, 400);
});

test("ajustes: temperature 0.2, salvo en modelos de razonamiento que no la admiten", () => {
  const { construirPeticion } = require("../src/asistente");
  const datos = { cliente: "X", descripcion: "Una web sencilla", tono: "cercano", respuestas: [] };
  assert.equal(construirPeticion(datos, "gpt-4.1-mini").temperature, 0.2);
  assert.equal(construirPeticion(datos, "gpt-5-mini").temperature, undefined);
  assert.equal(construirPeticion(datos, "o3").temperature, undefined);
});

test("preguntas guiadas: se validan las opciones y se limitan a 2 preguntas", async () => {
  siguiente = () =>
    respuestaModelo({
      resumen: "Web para un negocio ficticio.",
      servicios: [{ id: "landing", justificacion: "Basta con una página." }],
      paginas: null,
      preguntaPrecioOPlazo: false,
      pendientes: [
        {
          tipo: "aclaracion",
          texto: "¿Una página o varias?",
          motivo: "Define el tipo de web.",
          opciones: [
            { texto: "Una", accion: "elegir:landing", paginas: null },
            { texto: "Varias", accion: "elegir:corporativa", paginas: null },
            { texto: "Tienda", accion: "elegir:tienda", paginas: null } // acción inexistente → fuera
          ]
        },
        {
          tipo: "aclaracion",
          texto: "¿Cuántas páginas?",
          motivo: "Cada página adicional se presupuesta aparte.",
          opciones: [
            { texto: "4 páginas", accion: "paginas", paginas: 4 },
            { texto: "50 páginas", accion: "paginas", paginas: 50 }, // fuera de rango → fuera
            { texto: "Muchas", accion: "paginas", paginas: null } // sin número → fuera
          ]
        },
        { tipo: "aclaracion", texto: "¿Formulario?", motivo: "", opciones: [{ texto: "Sí", accion: "anadir:formulario", paginas: null }] },
        { tipo: "aclaracion", texto: "¿Idiomas?", motivo: "", opciones: [] }, // cuarta pregunta → fuera
        {
          tipo: "fuera_de_catalogo",
          texto: "Blog con gestor de contenidos.",
          motivo: "No está en el catálogo.",
          opciones: [{ texto: "Sí", accion: "ninguna", paginas: null }] // en fuera_de_catalogo no hay opciones
        }
      ]
    });

  const r = await post("/api/propuesta", { cliente: "Negocio Ficticio", descripcion: "Quiero una web para mi negocio." });
  const p = await r.json();
  const aclaraciones = p.pendientes.filter((x) => x.tipo === "aclaracion");

  assert.equal(aclaraciones.length, 2, "como mucho 2 preguntas (las propuestas ya resuelven tipo y páginas)");
  assert.deepEqual(aclaraciones[0].opciones.map((o) => o.accion), ["elegir:landing", "elegir:corporativa"]);
  assert.deepEqual(aclaraciones[1].opciones, [{ texto: "4 páginas", accion: "paginas", paginas: 4 }]);
  assert.equal(aclaraciones[0].motivo, "Define el tipo de web.");
  assert.deepEqual(p.pendientes.find((x) => x.tipo === "fuera_de_catalogo").opciones, []);

  // El esquema que se envía a OpenAI solo permite acciones generadas desde el catálogo
  const esquemaOpcion = ultimaPeticion.cuerpo.text.format.schema.properties.pendientes.items.properties.opciones.items;
  assert.ok(esquemaOpcion.properties.accion.enum.includes("anadir:segundo-idioma"));
  assert.ok(!esquemaOpcion.properties.accion.enum.includes("elegir:tienda"));
});

test("precio o plazo: el servidor añade su propia nota (no la redacta la IA)", async () => {
  const { NOTA_PRECIO_PLAZO } = require("../src/asistente");
  siguiente = () =>
    respuestaModelo({ resumen: "Web para una tienda ficticia.", servicios: [], paginas: null, preguntaPrecioOPlazo: true, pendientes: [] });
  const r = await post("/api/propuesta", { cliente: "Moda Ficticia", descripcion: "¿Cuánto cuesta una web y cuándo estaría?" });
  const p = await r.json();
  assert.deepEqual(p.pendientes, [{ tipo: "nota", texto: NOTA_PRECIO_PLAZO, motivo: "", opciones: [] }]);
});

test("segunda ronda: las respuestas del cliente se envían a la IA y se validan", async () => {
  siguiente = () =>
    respuestaModelo({
      resumen: "Web con varias secciones para un negocio ficticio.",
      servicios: [
        { id: "corporativa", justificacion: "Has pedido varias secciones." },
        { id: "formulario", justificacion: "Quieres que te contacten." }
      ],
      paginas: 4,
      preguntaPrecioOPlazo: false,
      pendientes: []
    });

  const respuestas = [
    { pregunta: "¿Una página o varias?", respuesta: "Varias" },
    { pregunta: "¿Cuántas páginas?", respuesta: "4 páginas" }
  ];
  const r = await post("/api/propuesta", { cliente: "Negocio Ficticio", descripcion: "Quiero una web para mi negocio.", respuestas });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.deepEqual(p.servicios.map((s) => s.id), ["corporativa", "formulario"]);
  assert.equal(p.paginas, 4);

  const usuario = ultimaPeticion.cuerpo.input.find((m) => m.role === "user").content;
  assert.ok(usuario.includes("Respuestas del cliente"));
  assert.ok(usuario.includes("¿Cuántas páginas? → 4 páginas"));

  // Formatos no válidos → 400 sin llamar a OpenAI
  const antes = llamadas;
  let e = await post("/api/propuesta", { cliente: "X", descripcion: "Quiero una web para mi negocio.", respuestas: "varias" });
  assert.equal(e.status, 400);
  e = await post("/api/propuesta", {
    cliente: "X",
    descripcion: "Quiero una web para mi negocio.",
    respuestas: Array.from({ length: 11 }, (_, i) => ({ pregunta: `P${i}`, respuesta: "R" }))
  });
  assert.equal(e.status, 400);
  assert.equal(llamadas, antes);
});

// ===== Solo solicitudes de páginas web =====

test("fuera de tema: si no pide una web (juego, receta…) → 422 sin propuesta", async () => {
  const { MENSAJE_FUERA_DE_TEMA } = require("../src/asistente");
  siguiente = () =>
    respuestaModelo({ enTema: false, resumen: "", servicios: [], paginas: null, preguntaPrecioOPlazo: false, pendientes: [] });

  const r = await post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: "Quiero que me crees un videojuego de plataformas." });
  assert.equal(r.status, 422);
  const e = await r.json();
  assert.equal(e.codigo, "fuera_de_tema");
  assert.equal(e.reintentar, false, "no tiene sentido reintentar lo mismo");
  assert.equal(e.error, MENSAJE_FUERA_DE_TEMA);
  assert.ok(!("servicios" in e), "no se devuelve ninguna propuesta");

  // Las instrucciones explican qué es tema permitido
  const sistema = ultimaPeticion.cuerpo.input.find((m) => m.role === "system").content;
  assert.match(sistema, /Tema permitido/);
  assert.ok(ultimaPeticion.cuerpo.text.format.schema.required.includes("enTema"));
});

test("fuera de tema: aunque la IA cuele servicios, si enTema es false se rechaza", async () => {
  siguiente = () =>
    respuestaModelo({
      enTema: false,
      resumen: "Un juego.",
      servicios: [{ id: "landing", justificacion: "Para el juego." }],
      paginas: 1,
      preguntaPrecioOPlazo: false,
      pendientes: []
    });
  const r = await post("/api/propuesta", { cliente: "Cliente Ficticio", descripcion: "Hazme un juego de cartas online." });
  assert.equal(r.status, 422);
});

test("petición mixta: web + algo ajeno → se presupuesta la web y lo ajeno queda fuera de catálogo", async () => {
  siguiente = () =>
    respuestaModelo({
      enTema: true,
      resumen: "Quieres una web para tu restaurante con un minijuego para niños.",
      servicios: [{ id: "corporativa", justificacion: "Necesitas varias secciones." }],
      paginas: null,
      preguntaPrecioOPlazo: false,
      pendientes: [{ tipo: "fuera_de_catalogo", texto: "Minijuego para niños: se valorará aparte.", motivo: "", opciones: [] }]
    });
  const r = await post("/api/propuesta", { cliente: "Restaurante Ficticio", descripcion: "Web para mi restaurante con un minijuego para niños." });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.deepEqual(p.servicios.map((s) => s.id), ["corporativa"]);
  assert.ok(p.pendientes.some((x) => x.tipo === "fuera_de_catalogo" && x.texto.includes("Minijuego")));
});

// ===== Tres propuestas para elegir =====

const TRES = (extra = {}) => ({
  enTema: true,
  resumen: "Quieres una web para tu restaurante ficticio.",
  preguntaPrecioOPlazo: false,
  pendientes: [],
  propuestas: [
    { titulo: "Esencial", enfoque: "Lo imprescindible.", recomendada: false, paginas: 1, secciones: ["Inicio", "Carta", "Contacto"], estilo: "elegante",
      servicios: [{ id: "landing", justificacion: "Sencilla." }, { id: "formulario", justificacion: "Reservas." }] },
    { titulo: "A tu medida", enfoque: "Lo que pides.", recomendada: true, paginas: 4, secciones: ["Inicio", "Carta", "Reservas", "Contacto"], estilo: "elegante",
      servicios: [{ id: "corporativa", justificacion: "Varias secciones." }, { id: "formulario", justificacion: "Reservas." }, { id: "segundo-idioma", justificacion: "Turistas." }] },
    { titulo: "Completa", enfoque: "Con todo.", recomendada: false, paginas: 6, secciones: ["Inicio", "Carta", "Reservas", "Galería", "Equipo", "Contacto"], estilo: "vibrante",
      servicios: [{ id: "corporativa", justificacion: "Varias secciones." }, { id: "formulario", justificacion: "Reservas." }, { id: "segundo-idioma", justificacion: "Turistas." }] }
  ],
  ...extra
});

test("tres propuestas: se validan y el servidor calcula el importe de cada una", async () => {
  siguiente = () => respuestaModelo(TRES());
  const r = await post("/api/propuesta", { cliente: "Restaurante Ficticio", descripcion: RESTAURANTE });
  assert.equal(r.status, 200);
  const p = await r.json();

  assert.equal(p.propuestas.length, 3);
  assert.deepEqual(p.propuestas.map((x) => x.importe), [300 + 80, 600 + 3 * 50 + 80 + 150, 600 + 5 * 50 + 80 + 150]); // 380, 980, 1080
  assert.deepEqual(p.propuestas.map((x) => x.recomendada), [false, true, false]);
  assert.equal(p.propuestas[0].servicios[0].nombre, "Landing page");
  assert.deepEqual(p.propuestas[1].secciones, ["Inicio", "Carta", "Reservas", "Contacto"]);
  // La raíz (servicios y páginas) es la propuesta recomendada
  assert.deepEqual(p.servicios.map((s) => s.id), ["corporativa", "formulario", "segundo-idioma"]);
  assert.equal(p.paginas, 4);

  // El esquema que se envía a OpenAI pide las propuestas con su estilo
  const esquema = ultimaPeticion.cuerpo.text.format.schema;
  assert.ok(esquema.required.includes("propuestas"));
  assert.ok(esquema.properties.propuestas.items.properties.estilo.enum.includes("elegante"));
});

test("tres propuestas: se corrigen las propuestas defectuosas", async () => {
  const datos = TRES();
  datos.propuestas[0].paginas = 7; // una landing siempre tiene 1 página
  datos.propuestas[0].estilo = "barroco"; // estilo desconocido → moderno
  datos.propuestas[1].recomendada = false; // ninguna recomendada → la del medio
  datos.propuestas[2].servicios = [{ id: "formulario", justificacion: "Solo extra." }]; // sin tipo de web → se descarta
  datos.propuestas.push({ ...datos.propuestas[1], titulo: "Cuarta", paginas: 8 }); // distinta de las demás: ocupa el hueco de la descartada
  siguiente = () => respuestaModelo(datos);

  const p = await (await post("/api/propuesta", { cliente: "Restaurante Ficticio", descripcion: RESTAURANTE })).json();
  assert.deepEqual(p.propuestas.map((x) => x.titulo), ["Esencial", "A tu medida", "Cuarta"]);
  assert.equal(p.propuestas[0].paginas, 1);
  assert.equal(p.propuestas[0].estilo, "moderno");
  assert.deepEqual(p.propuestas.map((x) => x.recomendada), [false, true, false]);
  assert.ok(p.avisos.some((a) => a.includes("Completa") && a.includes("tipo de web")));
});

test("tres propuestas: «otra» envía la descripción detallada del cliente y devuelve propuestas nuevas", async () => {
  siguiente = () => respuestaModelo(TRES());
  const detalle = "Ninguna me convence: quiero solo dos páginas, carta y contacto, sin idiomas.";
  const r = await post("/api/propuesta", {
    cliente: "Restaurante Ficticio",
    descripcion: RESTAURANTE,
    respuestas: [{ pregunta: "El cliente describe con más detalle lo que quiere (ninguna propuesta le convencía)", respuesta: detalle }]
  });
  assert.equal(r.status, 200);
  const usuario = ultimaPeticion.cuerpo.input.find((m) => m.role === "user").content;
  assert.ok(usuario.includes(detalle));
  const sistema = ultimaPeticion.cuerpo.input.find((m) => m.role === "system").content;
  assert.match(sistema, /ninguna propuesta le convencía, crea 3 propuestas nuevas/);
});

test("tres propuestas: el servidor descarta las repetidas", async () => {
  const datos = TRES();
  datos.propuestas[2] = { ...datos.propuestas[1], titulo: "Repetida", recomendada: false }; // mismos servicios y páginas
  siguiente = () => respuestaModelo(datos);
  const p = await (await post("/api/propuesta", { cliente: "Restaurante Ficticio", descripcion: RESTAURANTE })).json();
  assert.deepEqual(p.propuestas.map((x) => x.titulo), ["Esencial", "A tu medida"]);
  const sistema = ultimaPeticion.cuerpo.input.find((m) => m.role === "system").content;
  assert.match(sistema, /NUNCA repitas en dos propuestas/);
});

// ===== Maquetas: textos, sector y fotos de Pexels =====

test("maquetas: sector, titular, botón, destacados, estilos distintos y secciones sin servicios", async () => {
  const datos = TRES({ sector: "restauracion", fotoBusqueda: "restaurant dinner table!!" });
  datos.propuestas.forEach((p, i) => Object.assign(p, { estilo: "elegante", titular: `Titular ${i}`, boton: "Reserva mesa", destacados: ["Carta de temporada", "Terraza", "Menú del día", "Sobra"] }));
  datos.propuestas[1].secciones = ["Inicio", "Carta", "Formulario", "Segundo idioma", "Contacto"];
  datos.propuestas[2].titular = "Desde 20 € por persona"; // con precio → se quita
  siguiente = () => respuestaModelo(datos);

  const p = await (await post("/api/propuesta", { cliente: "Restaurante Ficticio", descripcion: RESTAURANTE })).json();
  assert.equal(p.sector, "restauracion");
  assert.equal(p.fotoBusqueda, "restaurant dinner table");
  assert.deepEqual(p.propuestas.map((x) => x.estilo), ["elegante", "moderno", "natural"], "un estilo distinto en cada propuesta");
  assert.equal(p.propuestas[0].titular, "Titular 0");
  assert.equal(p.propuestas[0].boton, "Reserva mesa");
  assert.deepEqual(p.propuestas[0].destacados, ["Carta de temporada", "Terraza", "Menú del día"]);
  assert.deepEqual(p.propuestas[1].secciones, ["Inicio", "Carta", "Contacto"]);
  assert.equal(p.propuestas[2].titular, "", "el modelo no puede poner precios");
  // Sin clave de Pexels no hay foto, y la propuesta llega igual
  assert.ok(p.propuestas.every((x) => x.foto === null));
});

test("fotos: con clave de Pexels cada propuesta recibe una foto distinta (y si Pexels falla, no pasa nada)", async () => {
  let peticionPexels = null;
  let fallar = false;
  const pexels = http.createServer((req, res) => {
    peticionPexels = { url: req.url, clave: req.headers.authorization };
    if (fallar) { res.writeHead(500); return res.end("error"); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      photos: [1, 2, 3].map((n) => ({
        url: `https://www.pexels.com/photo/${n}/`, photographer: `Autor ${n}`, alt: `Foto ${n}`, avg_color: "#336699",
        src: { landscape: `https://images.pexels.com/photos/${n}/foto.jpg` }
      }))
    }));
  });
  await new Promise((ok) => pexels.listen(0, ok));
  process.env.PEXELS_URL = `http://localhost:${pexels.address().port}/v1/search`;
  process.env.PEXELS_API_KEY = "clave-pexels-de-prueba";
  try {
    siguiente = () => respuestaModelo(TRES({ sector: "moda", fotoBusqueda: "fashion boutique clothes" }));
    let p = await (await post("/api/propuesta", { cliente: "Moda Ficticia", descripcion: "Quiero una web para mi tienda de ropa." })).json();
    assert.deepEqual(p.propuestas.map((x) => x.foto.url), [1, 2, 3].map((n) => `https://images.pexels.com/photos/${n}/foto.jpg`));
    assert.equal(p.propuestas[0].foto.autor, "Autor 1");
    assert.equal(peticionPexels.clave, "clave-pexels-de-prueba", "la clave va en la cabecera, desde el servidor");
    assert.match(peticionPexels.url, /query=fashion\+boutique\+clothes/);
    assert.match(peticionPexels.url, /orientation=landscape/);

    // Pexels caído: la propuesta llega igual, sin fotos
    fallar = true;
    siguiente = () => respuestaModelo(TRES({ sector: "moda", fotoBusqueda: "clothing store rack" }));
    const r = await post("/api/propuesta", { cliente: "Moda Ficticia", descripcion: "Quiero una web para mi tienda de ropa." });
    assert.equal(r.status, 200);
    p = await r.json();
    assert.ok(p.propuestas.every((x) => x.foto === null));
  } finally {
    delete process.env.PEXELS_URL;
    delete process.env.PEXELS_API_KEY;
    pexels.close();
  }
});
