// Comprueba que los datos recibidos sean correctos ANTES de calcular.

const TIPOS_VALIDOS = ["landing", "corporativa"];
const CAMPOS = ["tipo", "paginas", "formulario", "segundoIdioma"];

function validarSolicitud(body) {
  // COMPROBACIÓN 1: lo que llega tiene que ser un objeto { ... }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errores: ["El cuerpo de la petición debe ser un objeto JSON."] };
  }

  const errores = [];

  // COMPROBACIÓN 2: tienen que estar los 4 campos
  for (const campo of CAMPOS) {
    if (!(campo in body)) {
      errores.push(`Falta el campo obligatorio "${campo}".`);
    }
  }
  if (errores.length > 0) return { ok: false, errores };

  const { tipo, paginas, formulario, segundoIdioma } = body;

  // COMPROBACIÓN 3: tipo solo puede ser "landing" o "corporativa"
  if (!TIPOS_VALIDOS.includes(tipo)) {
    errores.push(`"tipo" debe ser "landing" o "corporativa" (recibido: ${JSON.stringify(tipo)}).`);
  }

  // COMPROBACIÓN 4: paginas tiene que ser un número entero entre 1 y 20
  if (!Number.isInteger(paginas) || paginas < 1 || paginas > 20) {
    errores.push(`"paginas" debe ser un número entero entre 1 y 20 (recibido: ${JSON.stringify(paginas)}).`);
  }

  // COMPROBACIÓN 5: formulario y segundoIdioma tienen que ser true o false
  if (typeof formulario !== "boolean") {
    errores.push(`"formulario" debe ser true o false (recibido: ${JSON.stringify(formulario)}).`);
  }
  if (typeof segundoIdioma !== "boolean") {
    errores.push(`"segundoIdioma" debe ser true o false (recibido: ${JSON.stringify(segundoIdioma)}).`);
  }

  if (errores.length > 0) return { ok: false, errores };

  // Todo correcto: devolvemos SOLO los 4 campos (lo demás se tira)
  return { ok: true, datos: { tipo, paginas, formulario, segundoIdioma } };
}

module.exports = { validarSolicitud };