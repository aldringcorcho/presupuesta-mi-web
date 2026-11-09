// Asistente de presupuestos con IA (React + htm, igual que la calculadora).
// Flujo: 1) el cliente describe su proyecto → la IA (en el servidor) propone servicios
//        2) el usuario revisa: acepta, quita o añade servicios y completa los datos
//        3) el servidor calcula los importes y genera el PDF → vista previa → descarga
// En el navegador NO hay precios: todos los importes vienen de /api/confirmar y del PDF.

const { useState, useEffect, useRef } = React;
const html = htm.bind(React.createElement);

const MAX_DESCRIPCION = 2000;
const MAX_CLIENTE = 120;

const EJEMPLOS = [
  {
    etiqueta: "Restaurante",
    cliente: "Restaurante La Prueba S.L.",
    descripcion:
      "Necesito una web para un restaurante. Quiero mostrar la carta, tener un formulario para solicitar reservas y ofrecer el contenido en dos idiomas."
  },
  { etiqueta: "Ambigua", cliente: "Negocio Ficticio", descripcion: "Quiero una web para mi negocio, algo moderno." },
  {
    etiqueta: "Fuera de catálogo",
    cliente: "Moda Ficticia",
    descripcion: "Quiero una tienda online para vender ropa, con pago con tarjeta y un área privada para clientes."
  }
];

const formatear = (n, moneda = "EUR") =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: moneda, maximumFractionDigits: 0, useGrouping: "always" }).format(n);

/** POST JSON. Devuelve { ok, estado, datos } y nunca lanza: los fallos de red vuelven como error. */
async function enviar(ruta, cuerpo, { comoBlob = false } = {}) {
  try {
    const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    if (r.ok && comoBlob) return { ok: true, estado: r.status, datos: await r.blob() };
    let datos = null;
    try {
      datos = await r.json();
    } catch {
      datos = { error: `El servidor respondió con un error (${r.status}).`, reintentar: true };
    }
    return { ok: r.ok, estado: r.status, datos };
  } catch {
    return { ok: false, estado: 0, datos: { error: "No se puede conectar con el servidor. Comprueba la conexión.", reintentar: true } };
  }
}

// ===== Componentes pequeños =====

function Pasos({ paso }) {
  const nombres = ["Describe", "Revisa", "Presupuesto"];
  return html`
    <ol className="asis-pasos" aria-label="Progreso">
      ${nombres.map((n, i) => html`
        <li key=${n} className=${i === paso ? "activo" : i < paso ? "hecho" : ""} aria-current=${i === paso ? "step" : undefined}>
          <span>${i < paso ? "✓" : i + 1}</span>${n}
        </li>`)}
    </ol>`;
}

function MensajeError({ error, onReintentar }) {
  if (!error) return null;
  return html`
    <div className="aviso asis-error" role="alert">
      <b>${error.error}</b>
      ${error.detalles?.length > 0 && html`<ul>${error.detalles.map((d) => html`<li key=${d}>${d}</li>`)}</ul>`}
      ${onReintentar && error.reintentar !== false && html`
        <button type="button" className="boton boton--pequeno asis-reintentar" onClick=${onReintentar}>↻ Volver a intentarlo</button>`}
    </div>`;
}

// ===== Paso 1: solicitud =====

function PasoSolicitud({ solicitud, setSolicitud, onEnviar, cargando, error }) {
  const largo = solicitud.descripcion.length;
  const enviarFormulario = (e) => {
    e.preventDefault();
    onEnviar();
  };
  return html`
    <form className="formulario cristal asis-solicitud" onSubmit=${enviarFormulario} noValidate>
      <div className="asis-ejemplos">
        <span>Datos de prueba:</span>
        ${EJEMPLOS.map((ej) => html`
          <button key=${ej.etiqueta} type="button" className="asis-chip" onClick=${() => setSolicitud({ cliente: ej.cliente, descripcion: ej.descripcion })}>
            ${ej.etiqueta}
          </button>`)}
      </div>

      <label className="asis-campo">
        <span>Cliente o empresa</span>
        <input
          type="text" name="cliente" maxLength=${MAX_CLIENTE} autoComplete="organization"
          placeholder="Ej.: Restaurante La Prueba S.L."
          value=${solicitud.cliente}
          onChange=${(e) => setSolicitud({ ...solicitud, cliente: e.target.value })}
        />
      </label>

      <label className="asis-campo">
        <span>¿Qué necesitas? <small className=${largo > MAX_DESCRIPCION ? "excedido" : ""}>${largo} / ${MAX_DESCRIPCION}</small></span>
        <textarea
          name="descripcion" rows="6" maxLength=${MAX_DESCRIPCION}
          placeholder="Cuéntanos tu proyecto: a qué se dedica tu negocio, qué secciones quieres, si necesitas formulario, idiomas…"
          value=${solicitud.descripcion}
          onChange=${(e) => setSolicitud({ ...solicitud, descripcion: e.target.value })}
        ></textarea>
      </label>

      <${MensajeError} error=${error} onReintentar=${error?.reintentar ? onEnviar : null} />

      <button type="submit" className="boton cristal cristal--liquido borde-vivo asis-principal" disabled=${cargando}>
        ${cargando ? html`<span className="asis-girando" aria-hidden="true"></span> Analizando la solicitud…` : "Proponer servicios →"}
      </button>
      <p className="asis-nota">La IA solo elige servicios de nuestro catálogo y redacta las explicaciones. Los importes los calcula el servidor.</p>
    </form>`;
}

// ===== Paso 2: revisión =====

function TarjetaServicio({ servicio, seleccionado, justificacion, onCambio }) {
  const esTipo = servicio.categoria === "tipo";
  return html`
    <label className=${"asis-servicio cristal" + (seleccionado ? " activo" : "")}>
      <input
        type=${esTipo ? "radio" : "checkbox"} name=${esTipo ? "tipo-web" : servicio.id}
        checked=${seleccionado}
        onChange=${(e) => onCambio(e.target.checked)}
        onClick=${esTipo && seleccionado ? () => onCambio(false) : undefined}
      />
      <span className="asis-servicio__marca" aria-hidden="true"></span>
      <span className="asis-servicio__texto">
        <strong>${servicio.nombre}</strong>
        <span className="asis-servicio__desc">${servicio.descripcion}</span>
        <span className="asis-servicio__regla">${servicio.regla}</span>
        ${justificacion && html`<span className="asis-servicio__ia"><b>IA</b> ${justificacion}</span>`}
      </span>
    </label>`;
}

function PasoRevision({ catalogo, propuesta, seleccion, setSeleccion, onVolver, onCalcular, cargando, error }) {
  const justif = Object.fromEntries(propuesta.servicios.map((s) => [s.id, s.justificacion]));
  const tipos = catalogo.servicios.filter((s) => s.categoria === "tipo");
  const extras = catalogo.servicios.filter((s) => s.categoria === "extra");
  const tipoElegido = seleccion.servicios.find((id) => tipos.some((t) => t.id === id));
  const faltanPaginas = tipoElegido && !(Number.isInteger(seleccion.paginas) && seleccion.paginas >= catalogo.paginas.min && seleccion.paginas <= catalogo.paginas.max);

  const cambiar = (cambio) => setSeleccion({ ...seleccion, ...cambio });
  const cambiarServicio = (servicio, activo) => {
    let ids = seleccion.servicios.filter((id) => id !== servicio.id);
    if (activo) {
      // Solo un tipo de web: al elegir uno se quita el otro
      if (servicio.categoria === "tipo") ids = ids.filter((id) => !tipos.some((t) => t.id === id));
      ids.push(servicio.id);
    }
    cambiar({ servicios: ids });
  };
  const cambiarPendiente = (i, texto) => cambiar({ pendientes: seleccion.pendientes.map((p, j) => (j === i ? { ...p, texto } : p)) });
  const quitarPendiente = (i) => cambiar({ pendientes: seleccion.pendientes.filter((_, j) => j !== i) });
  const anadirPendiente = () => cambiar({ pendientes: [...seleccion.pendientes, { tipo: "nota", texto: "" }] });

  const listo = tipoElegido && !faltanPaginas && seleccion.resumen.trim();

  return html`
    <div className="asis-revision">
      <section className="formulario cristal">
        <fieldset>
          <legend>Resumen del proyecto · ${seleccion.cliente}</legend>
          <textarea className="asis-area" rows="3" maxLength="800" value=${seleccion.resumen} onChange=${(e) => cambiar({ resumen: e.target.value })}></textarea>
        </fieldset>

        ${propuesta.avisos.length > 0 && html`
          <ul className="asis-avisos">${propuesta.avisos.map((a) => html`<li key=${a}>${a}</li>`)}</ul>`}

        <fieldset>
          <legend>Tipo de web <small>elige uno</small></legend>
          <div className="asis-servicios">
            ${tipos.map((s) => html`
              <${TarjetaServicio} key=${s.id} servicio=${s} seleccionado=${seleccion.servicios.includes(s.id)} justificacion=${justif[s.id]} onCambio=${(v) => cambiarServicio(s, v)} />`)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Número total de páginas</legend>
          <div className=${"asis-paginas" + (faltanPaginas ? " falta" : "")}>
            <button type="button" aria-label="Una página menos" onClick=${() => cambiar({ paginas: Math.max(catalogo.paginas.min, (seleccion.paginas || 2) - 1) })}>−</button>
            <input
              type="number" inputMode="numeric" min=${catalogo.paginas.min} max=${catalogo.paginas.max} placeholder="?"
              aria-label="Número total de páginas"
              value=${seleccion.paginas ?? ""}
              onChange=${(e) => cambiar({ paginas: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <button type="button" aria-label="Una página más" onClick=${() => cambiar({ paginas: Math.min(catalogo.paginas.max, (seleccion.paginas || 0) + 1) })}>+</button>
            <span>${faltanPaginas
              ? `Dato necesario para calcular: indica un número entre ${catalogo.paginas.min} y ${catalogo.paginas.max}.`
              : "La primera página va incluida en el tipo de web."}</span>
          </div>
        </fieldset>

        <fieldset>
          <legend>Extras</legend>
          <div className="asis-servicios">
            ${extras.map((s) => html`
              <${TarjetaServicio} key=${s.id} servicio=${s} seleccionado=${seleccion.servicios.includes(s.id)} justificacion=${justif[s.id]} onCambio=${(v) => cambiarServicio(s, v)} />`)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Aclaraciones y aspectos pendientes</legend>
          <ul className="asis-pendientes">
            ${seleccion.pendientes.map((p, i) => html`
              <li key=${i} className=${"asis-pendiente asis-pendiente--" + p.tipo}>
                <span className="asis-pendiente__tipo">${p.tipo === "fuera_de_catalogo" ? "Fuera de catálogo" : p.tipo === "aclaracion" ? "Duda" : "Nota"}</span>
                <textarea rows="2" maxLength="400" value=${p.texto} placeholder="Escribe la aclaración…" onChange=${(e) => cambiarPendiente(i, e.target.value)}></textarea>
                <button type="button" className="asis-quitar" aria-label="Quitar" onClick=${() => quitarPendiente(i)}>×</button>
              </li>`)}
          </ul>
          <button type="button" className="asis-chip" onClick=${anadirPendiente}>+ Añadir aclaración</button>
        </fieldset>

        <${MensajeError} error=${error} />

        <div className="asis-acciones">
          <button type="button" className="boton boton--fantasma" onClick=${onVolver}>← Cambiar la descripción</button>
          <button type="button" className="boton cristal cristal--liquido borde-vivo" disabled=${!listo || cargando} onClick=${onCalcular}>
            ${cargando ? html`<span className="asis-girando" aria-hidden="true"></span> Calculando…` : "Calcular presupuesto →"}
          </button>
        </div>
        ${!tipoElegido && html`<p className="asis-nota">Elige un tipo de web para poder calcular el presupuesto.</p>`}
      </section>
    </div>`;
}

// ===== Paso 3: presupuesto + vista previa del PDF =====

function PasoPresupuesto({ presupuesto, pdf, onEditar, onReintentarPdf, errorPdf }) {
  const [urlPdf, setUrlPdf] = useState(null);
  useEffect(() => {
    if (!pdf) return setUrlPdf(null);
    const url = URL.createObjectURL(pdf);
    setUrlPdf(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);

  const archivo = `presupuesto-${presupuesto.cliente.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${presupuesto.fecha}.pdf`;

  return html`
    <div className="asis-final">
      <aside className="resultado cristal cristal--liquido-suave borde-vivo">
        <span className="resultado__titulo">Total · calculado por el servidor</span>
        <strong className="resultado__total">${formatear(presupuesto.total, presupuesto.moneda)}</strong>
        <ul className="desglose">
          ${presupuesto.lineas.map((l) => html`
            <li key=${l.id}><span>${l.concepto} <small>· ${l.detalle}</small></span><b>${formatear(l.importe, presupuesto.moneda)}</b></li>`)}
        </ul>
        <p className="asis-nota">Impuestos no incluidos. Revisa el documento antes de descargarlo.</p>
        <div className="asis-acciones asis-acciones--columna">
          ${urlPdf
            ? html`<a className="boton cristal cristal--liquido borde-vivo" href=${urlPdf} download=${archivo}>⬇ Aceptar y descargar PDF</a>`
            : html`<button type="button" className="boton cristal" disabled>Generando PDF…</button>`}
          <button type="button" className="boton boton--fantasma" onClick=${onEditar}>← Modificar servicios</button>
        </div>
        <${MensajeError} error=${errorPdf} onReintentar=${onReintentarPdf} />
      </aside>

      <div className="vista cristal borde-vivo asis-vista">
        <div className="vista__cabecera">
          <span className="vista__etiqueta"><i></i> Vista previa del PDF</span>
          ${urlPdf && html`<a className="vista__tipo" href=${urlPdf} target="_blank" rel="noopener">Abrir en otra pestaña ↗</a>`}
        </div>
        ${urlPdf
          ? html`<iframe className="asis-pdf" src=${urlPdf + "#view=FitH"} title="Vista previa del presupuesto en PDF"></iframe>`
          : html`<div className="asis-pdf asis-pdf--cargando"><span className="asis-girando"></span></div>`}
      </div>
    </div>`;
}

// ===== App =====

function Asistente() {
  const [paso, setPaso] = useState(0);
  const [catalogo, setCatalogo] = useState(null);
  const [solicitud, setSolicitud] = useState({ cliente: "", descripcion: "" });
  const [propuesta, setPropuesta] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [presupuesto, setPresupuesto] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [errorPdf, setErrorPdf] = useState(null);
  const raiz = useRef(null);

  useEffect(() => {
    fetch("/api/catalogo").then((r) => r.json()).then(setCatalogo).catch(() =>
      setError({ error: "No se pudo cargar el catálogo de servicios. Arranca el servidor con npm start." })
    );
  }, []);

  const irA = (n) => {
    setPaso(n);
    setError(null);
    requestAnimationFrame(() => raiz.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  async function pedirPropuesta() {
    setError(null);
    // Comprobación rápida en el navegador; el servidor vuelve a validar.
    if (!solicitud.cliente.trim() || !solicitud.descripcion.trim()) {
      return setError({ error: "Faltan datos", detalles: [!solicitud.cliente.trim() && "Escribe el nombre del cliente o de la empresa.", !solicitud.descripcion.trim() && "Describe el proyecto: la descripción no puede estar vacía."].filter(Boolean) });
    }
    setCargando(true);
    const r = await enviar("/api/propuesta", solicitud);
    setCargando(false);
    if (!r.ok) return setError(r.datos);

    setPropuesta(r.datos);
    setSeleccion({
      cliente: r.datos.cliente,
      resumen: r.datos.resumen,
      servicios: r.datos.servicios.map((s) => s.id),
      paginas: r.datos.paginas, // si la IA no lo sabe queda vacío y el usuario debe completarlo
      pendientes: r.datos.pendientes
    });
    irA(1);
  }

  const cuerpoSeleccion = () => ({
    ...seleccion,
    pendientes: seleccion.pendientes.map((p) => p.texto).filter((t) => t.trim())
  });

  async function generarPdf() {
    setErrorPdf(null);
    setPdf(null);
    const r = await enviar("/api/presupuesto/pdf", cuerpoSeleccion(), { comoBlob: true });
    if (!r.ok) return setErrorPdf(r.datos);
    setPdf(r.datos);
  }

  async function calcular() {
    setError(null);
    setCargando(true);
    const r = await enviar("/api/confirmar", cuerpoSeleccion());
    setCargando(false);
    if (!r.ok) return setError(r.datos);
    setPresupuesto(r.datos);
    irA(2);
    generarPdf();
  }

  return html`
    <div className="asistente" ref=${raiz}>
      <${Pasos} paso=${paso} />
      ${paso === 0 && html`<${PasoSolicitud} solicitud=${solicitud} setSolicitud=${setSolicitud} onEnviar=${pedirPropuesta} cargando=${cargando} error=${error} />`}
      ${paso === 1 && catalogo && html`
        <${PasoRevision} catalogo=${catalogo} propuesta=${propuesta} seleccion=${seleccion} setSeleccion=${setSeleccion}
          onVolver=${() => irA(0)} onCalcular=${calcular} cargando=${cargando} error=${error} />`}
      ${paso === 2 && html`
        <${PasoPresupuesto} presupuesto=${presupuesto} pdf=${pdf} errorPdf=${errorPdf}
          onReintentarPdf=${generarPdf} onEditar=${() => { setPdf(null); irA(1); }} />`}
    </div>`;
}

ReactDOM.createRoot(document.getElementById("app-asistente")).render(html`<${Asistente} />`);
