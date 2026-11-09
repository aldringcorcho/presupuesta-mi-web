// Genera el PDF del presupuesto con pdfmake (en el servidor).
// Recibe el presupuesto YA calculado por construirPresupuesto(): el PDF nunca
// recalcula ni acepta importes del navegador.

const pdfmake = require("pdfmake");
const fuentesVfs = require("pdfmake/build/vfs_fonts");
const { euros } = require("./confirmar");

// Las fuentes se cargan desde un módulo JS (vfs_fonts) a un sistema de archivos
// virtual: así no dependemos de leer .ttf del disco (importante en Vercel).
for (const [nombre, base64] of Object.entries(fuentesVfs)) {
  pdfmake.virtualfs.writeFileSync(nombre, Buffer.from(base64, "base64"));
}
pdfmake.addFonts({
  Roboto: {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf"
  }
});
// El documento no carga nada de fuera: ni URLs ni archivos del disco.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => false);

const COLOR = { acento: "#3d6bff", oscuro: "#0b0d1f", tenue: "#5b6178", linea: "#d9ddeb", fondo: "#f3f5fc" };

function fechaLarga(iso) {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`)
  );
}

/** Definición del documento (separada para poder probarla sin generar el PDF). */
function definicionDocumento(p) {
  const filasServicios = p.lineas.map((l) => [
    { text: l.concepto, bold: true },
    { text: l.descripcion, color: COLOR.tenue, fontSize: 9 }
  ]);
  const filasImportes = p.lineas.map((l) => [l.concepto, { text: l.detalle, color: COLOR.tenue }, { text: euros(l.importe), alignment: "right" }]);

  return {
    pageSize: "A4",
    pageMargins: [48, 64, 48, 64],
    info: { title: `Presupuesto · ${p.cliente}`, author: "Presupuesta mi web", subject: "Presupuesto de proyecto web" },
    defaultStyle: { font: "Roboto", fontSize: 10, color: COLOR.oscuro, lineHeight: 1.25 },
    styles: {
      h1: { fontSize: 22, bold: true, color: COLOR.oscuro },
      h2: { fontSize: 12, bold: true, color: COLOR.acento, margin: [0, 18, 0, 8] },
      cabecera: { bold: true, color: COLOR.tenue, fontSize: 9 }
    },
    header: {
      margin: [48, 24, 48, 0],
      columns: [
        { text: "Presupuesta mi web", bold: true, color: COLOR.acento },
        { text: `Presupuesto · ${fechaLarga(p.fecha)}`, alignment: "right", color: COLOR.tenue, fontSize: 9 }
      ]
    },
    footer: (pagina, total) => ({
      margin: [48, 16, 48, 0],
      columns: [
        { text: "Importes calculados por el servidor con las tarifas vigentes. Propuesta orientativa, sin compromiso de plazos de entrega.", fontSize: 8, color: COLOR.tenue },
        { text: `${pagina} / ${total}`, alignment: "right", fontSize: 8, color: COLOR.tenue, width: 40 }
      ]
    }),
    content: [
      { text: "Presupuesto", style: "h1" },
      {
        margin: [0, 10, 0, 0],
        table: {
          widths: [90, "*"],
          body: [
            [{ text: "Cliente", style: "cabecera" }, { text: p.cliente, bold: true }],
            [{ text: "Fecha", style: "cabecera" }, fechaLarga(p.fecha)]
          ]
        },
        layout: "noBorders"
      },

      { text: "Resumen del proyecto", style: "h2" },
      { text: p.resumen },

      { text: "Servicios confirmados", style: "h2" },
      {
        table: { headerRows: 1, widths: [130, "*"], body: [[{ text: "Servicio", style: "cabecera" }, { text: "Qué incluye", style: "cabecera" }], ...filasServicios] },
        layout: tablaSuave()
      },

      { text: "Desglose de importes", style: "h2" },
      {
        table: {
          headerRows: 1,
          widths: ["*", 140, 80],
          body: [
            [{ text: "Concepto", style: "cabecera" }, { text: "Detalle", style: "cabecera" }, { text: "Importe", style: "cabecera", alignment: "right" }],
            ...filasImportes,
            [
              { text: "Total", bold: true, fontSize: 12 },
              { text: p.moneda === "EUR" ? "Impuestos no incluidos" : "", color: COLOR.tenue, fontSize: 8 },
              { text: euros(p.total), bold: true, fontSize: 12, alignment: "right", color: COLOR.acento }
            ]
          ]
        },
        layout: tablaSuave(true)
      },

      { text: "Aclaraciones y aspectos pendientes de concretar", style: "h2" },
      p.pendientes.length
        ? { ul: p.pendientes, color: COLOR.oscuro }
        : { text: "No hay aspectos pendientes.", color: COLOR.tenue }
    ]
  };
}

function tablaSuave(conTotal = false) {
  return {
    hLineWidth: (i, nodo) => (i === 0 ? 0 : conTotal && i === nodo.table.body.length - 1 ? 1.2 : 0.6),
    vLineWidth: () => 0,
    hLineColor: (i, nodo) => (conTotal && i === nodo.table.body.length - 1 ? COLOR.acento : COLOR.linea),
    fillColor: (fila) => (fila === 0 ? COLOR.fondo : null),
    paddingTop: () => 6,
    paddingBottom: () => 6,
    paddingLeft: () => 6,
    paddingRight: () => 6
  };
}

/** Devuelve el PDF como Buffer. */
async function generarPdf(presupuesto) {
  return pdfmake.createPdf(definicionDocumento(presupuesto)).getBuffer();
}

module.exports = { generarPdf, definicionDocumento };
