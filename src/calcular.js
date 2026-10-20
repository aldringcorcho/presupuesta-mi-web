const TARIFAS = require("./tarifas");

// Calcula el presupuesto. Recibe datos YA validados.
// Total = precio base + páginas adicionales + extras
function calcularPresupuesto({ tipo, paginas, formulario, segundoIdioma }) {
  const base = TARIFAS[tipo];
  const paginasAdicionales = (paginas - 1) * TARIFAS.paginaAdicional;
  const costeFormulario = formulario ? TARIFAS.formulario : 0;
  const costeIdioma = segundoIdioma ? TARIFAS.segundoIdioma : 0;

  const total = base + paginasAdicionales + costeFormulario + costeIdioma;

  return {
    base,
    paginasAdicionales,
    formulario: costeFormulario,
    segundoIdioma: costeIdioma,
    total,
    moneda: TARIFAS.moneda
  };
}

module.exports = { calcularPresupuesto };
