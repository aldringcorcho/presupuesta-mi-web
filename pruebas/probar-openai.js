// Prueba REAL contra OpenAI (gasta unos céntimos). Uso: npm run probar:openai
// Lee OPENAI_API_KEY (y opcionalmente OPENAI_MODEL) del archivo .env. Nunca imprime la clave.

const { pedirPropuesta, validarRespuestaIA, ErrorIA } = require("../src/asistente");

const CASOS = [
  {
    nombre: "Clara",
    cliente: "Restaurante La Prueba S.L.",
    descripcion:
      "Necesito una web para un restaurante. Quiero mostrar la carta, tener un formulario para solicitar reservas y ofrecer el contenido en dos idiomas."
  },
  { nombre: "Ambigua", cliente: "Negocio Ficticio", descripcion: "Quiero una web para mi negocio, algo moderno." },
  {
    nombre: "Ambigua · segunda ronda",
    cliente: "Negocio Ficticio",
    descripcion: "Quiero una web para mi negocio, algo moderno.",
    respuestas: [
      { pregunta: "¿Una sola página o varias secciones?", respuesta: "Varias secciones" },
      { pregunta: "¿Cuántas páginas en total?", respuesta: "4 páginas" },
      { pregunta: "¿Necesitas formulario de contacto?", respuesta: "Sí" }
    ]
  },
  {
    nombre: "Clara · tono formal",
    tono: "formal",
    cliente: "Asesoría Ficticia S.L.",
    descripcion: "Somos una asesoría fiscal. Queremos una web con inicio, servicios, equipo y contacto, con formulario para solicitar consulta."
  },
  {
    nombre: "Fuera de catálogo",
    cliente: "Moda Ficticia",
    descripcion: "Quiero una tienda online para vender ropa, con pago con tarjeta y área de clientes. ¿Cuánto cuesta y cuándo estaría?"
  }
];

(async () => {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) {
    console.error("Falta OPENAI_API_KEY. Crea el archivo .env en la raíz del proyecto (mira .env.example).");
    process.exit(1);
  }
  const modelo = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  // ¿Existe el modelo para esta clave?
  const r = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(modelo)}`, {
    headers: { Authorization: `Bearer ${clave}` }
  });
  if (r.status === 401) {
    console.error("La clave no es válida (401).");
    process.exit(1);
  }
  if (!r.ok) {
    console.error(`El modelo «${modelo}» no está disponible para esta clave (HTTP ${r.status}).`);
    const lista = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${clave}` } });
    if (lista.ok) {
      const ids = (await lista.json()).data.map((m) => m.id).filter((id) => /^(gpt|o\d)/.test(id)).sort();
      console.error("Modelos disponibles:\n  " + ids.join("\n  "));
      console.error("Pon uno en .env como OPENAI_MODEL=...");
    }
    process.exit(1);
  }
  console.log(`Modelo «${modelo}» disponible.\n`);

  let fallos = 0;
  for (const c of CASOS) {
    console.log(`===== ${c.nombre}: «${c.descripcion}»`);
    try {
      const t0 = Date.now();
      const p = validarRespuestaIA(await pedirPropuesta({ tono: "cercano", respuestas: [], ...c }));
      console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      console.log("Resumen:", p.resumen);
      for (const s of p.servicios) console.log(`  + ${s.id}: ${s.justificacion}`);
      console.log("  Páginas:", p.paginas);
      for (const x of p.pendientes) {
        console.log(`  ? [${x.tipo}] ${x.texto}${x.motivo ? `  (${x.motivo})` : ""}`);
        for (const o of x.opciones) console.log(`      · ${o.texto} → ${o.accion}${o.paginas ? " " + o.paginas : ""}`);
      }
      for (const a of p.avisos) console.log(`  ! ${a}`);
    } catch (err) {
      fallos++;
      console.log("ERROR:", err instanceof ErrorIA ? `${err.message} (${err.causa ?? ""})` : err);
    }
    console.log();
  }
  process.exit(fallos ? 1 : 0);
})();
