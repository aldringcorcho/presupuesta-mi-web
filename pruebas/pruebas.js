// Lanza todas las pruebas contra el servidor encendido.
// Uso: enciende el servidor (npm run dev) y en OTRA terminal: npm test
const BASE = "http://localhost:4000";

// Un caso correcto que usamos como plantilla
const valido = { tipo: "corporativa", paginas: 4, formulario: true, segundoIdioma: false };

const casos = [
  { n: 1, desc: "Landing, 1 página, sin extras", body: { tipo: "landing", paginas: 1, formulario: false, segundoIdioma: false }, status: 200, total: 300 },
  { n: 2, desc: "Corporativa, 4 páginas, formulario", body: valido, status: 200, total: 830 },
  { n: 3, desc: "Landing, 2 páginas, ambos extras", body: { tipo: "landing", paginas: 2, formulario: true, segundoIdioma: true }, status: 200, total: 580 },
  { n: 4, desc: "Landing, 20 páginas, sin extras", body: { tipo: "landing", paginas: 20, formulario: false, segundoIdioma: false }, status: 200, total: 1250 },
  { n: 5, desc: "paginas: 0", body: { ...valido, paginas: 0 }, status: 400 },
  { n: 6, desc: "paginas: 21", body: { ...valido, paginas: 21 }, status: 400 },
  { n: 7, desc: "paginas: 2.5", body: { ...valido, paginas: 2.5 }, status: 400 },
  { n: 8, desc: "tipo: \"tienda\"", body: { ...valido, tipo: "tienda" }, status: 400 },
  { n: 9, desc: "formulario: \"false\"", body: { ...valido, formulario: "false" }, status: 400 },
  // Pruebas extra de seguridad
  { n: 10, desc: "Intenta imponer total: 1", body: { ...valido, total: 1, base: 0 }, status: 200, total: 830 },
  { n: 11, desc: "paginas: \"4\" (texto)", body: { ...valido, paginas: "4" }, status: 400 }
];

(async () => {
  let fallos = 0;

  // Probar las dos rutas GET
  for (const ruta of ["/api/estado", "/api/tarifas"]) {
    const r = await fetch(BASE + ruta);
    console.log(`GET ${ruta} → ${r.status}`, JSON.stringify(await r.json()));
  }
  console.log();

  // Probar cada caso del POST
  for (const c of casos) {
    const r = await fetch(BASE + "/api/presupuesto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c.body)
    });
    const json = await r.json();
    const ok = r.status === c.status && (c.total === undefined || json.total === c.total);
    if (!ok) fallos++;
    const obtenido = r.status === 200 ? `200 · Total: ${json.total} €` : `${r.status} · ${json.detalles?.join(" ")}`;
    console.log(`${ok ? "OK " : "MAL"} Caso ${c.n} (${c.desc}) → ${obtenido}`);
  }

  console.log(`\n${casos.length - fallos}/${casos.length} pruebas correctas`);
  process.exit(fallos ? 1 : 0);
})();