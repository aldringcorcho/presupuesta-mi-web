// Tarifas del servidor. Es el ÚNICO sitio donde están los precios.
const TARIFAS = Object.freeze({
  landing: 300,          // incluye la primera página
  corporativa: 600,      // incluye la primera página
  paginaAdicional: 50,   // cada página a partir de la segunda
  formulario: 80,        // formulario de contacto
  segundoIdioma: 150,
  moneda: "EUR"
});

module.exports = TARIFAS;