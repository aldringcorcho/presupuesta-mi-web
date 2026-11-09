// Fotos de stock para la vista previa de las propuestas (API de Pexels, desde el servidor).
// La clave va en la variable de entorno PEXELS_API_KEY. Sin clave, o si Pexels falla,
// se devuelve una lista vacía y la web dibuja la maqueta sin foto: nunca rompe la propuesta.

const URL_PEXELS = "https://api.pexels.com/v1/search";
const ESPERA_MS = 4000;
const MAX_CACHE = 200;

// Caché en memoria: la misma búsqueda no vuelve a gastar peticiones (Pexels limita por hora)
const cache = new Map();

/** Solo letras, números y espacios; máximo 60 caracteres. */
function limpiarConsulta(texto) {
  if (typeof texto !== "string") return "";
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 60);
}

/**
 * Busca fotos horizontales para una consulta. Devuelve [{ url, autor, enlace, alt, color }].
 * `opciones` permite inyectar fetch, clave y URL (útil en las pruebas).
 */
async function buscarFotos(consulta, opciones = {}) {
  const clave = opciones.apiKey ?? process.env.PEXELS_API_KEY;
  const q = limpiarConsulta(consulta);
  const cantidad = Math.min(Math.max(opciones.cantidad ?? 3, 1), 6);
  if (!clave || !q) return [];

  const id = `${q}|${cantidad}`;
  if (cache.has(id)) return cache.get(id);

  const url = new URL(opciones.url ?? process.env.PEXELS_URL ?? URL_PEXELS);
  url.searchParams.set("query", q);
  url.searchParams.set("per_page", String(cantidad));
  url.searchParams.set("orientation", "landscape");

  try {
    const r = await (opciones.fetch ?? fetch)(url, {
      headers: { Authorization: clave },
      signal: AbortSignal.timeout(opciones.esperaMs ?? ESPERA_MS)
    });
    if (!r.ok) {
      console.error("[Pexels]", `HTTP ${r.status}`);
      return [];
    }
    const datos = await r.json();
    const fotos = (Array.isArray(datos?.photos) ? datos.photos : [])
      .filter((p) => typeof p?.src?.landscape === "string" && p.src.landscape.startsWith("https://"))
      .map((p) => ({
        url: p.src.landscape,
        autor: String(p.photographer || "Pexels").slice(0, 60),
        enlace: typeof p.url === "string" && p.url.startsWith("https://www.pexels.com/") ? p.url : "https://www.pexels.com/",
        alt: String(p.alt || q).slice(0, 120),
        color: /^#[0-9a-f]{6}$/i.test(p.avg_color) ? p.avg_color : null
      }));
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(id, fotos);
    return fotos;
  } catch (err) {
    console.error("[Pexels]", err?.name === "TimeoutError" ? "tiempo agotado" : err?.message);
    return [];
  }
}

module.exports = { buscarFotos, limpiarConsulta, _cache: cache };
