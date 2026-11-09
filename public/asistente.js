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

const TONOS = [
  { id: "cercano", nombre: "Cercano" },
  { id: "formal", nombre: "Formal" }
];

/** Aplica la acción de una opción de respuesta a la selección (servicios y páginas). */
function aplicarAccion(seleccion, opcion, catalogo) {
  const tipos = catalogo.servicios.filter((s) => s.categoria === "tipo").map((s) => s.id);
  let servicios = [...seleccion.servicios];
  let paginas = seleccion.paginas;
  const [accion, id] = opcion.accion.split(":");
  if (accion === "elegir") servicios = [...servicios.filter((s) => !tipos.includes(s)), id];
  if (accion === "anadir" && !servicios.includes(id)) servicios.push(id);
  if (accion === "quitar") servicios = servicios.filter((s) => s !== id);
  if (accion === "paginas") paginas = opcion.paginas;
  return { servicios, paginas };
}

/** Texto con el que cada pendiente llega al PDF. */
function textoPendiente(p) {
  if (p.tipo === "aclaracion") return p.respuesta ? `${p.texto} Respuesta: ${p.respuesta}` : `${p.texto} (pendiente de respuesta)`;
  return p.texto;
}

/** Desplazamiento suave (Lenis, definido en fondo.js) con alternativa nativa. */
const desplazar = (el) =>
  window.desplazarA ? window.desplazarA(el, -90) : el?.scrollIntoView({ behavior: "smooth", block: "start" });

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
  const nombres = ["Describe", "Elige", "Revisa", "Presupuesto"];
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
        <span>Probar con:</span>
        ${EJEMPLOS.map((ej) => html`
          <button key=${ej.etiqueta} type="button" className="asis-chip" onClick=${() => setSolicitud({ ...solicitud, cliente: ej.cliente, descripcion: ej.descripcion })}>
            ${ej.etiqueta}
          </button>`)}
      </div>

      <div className="asis-campo">
        <span id="etiqueta-tono">Tono de la propuesta</span>
        <div className="asis-tonos" role="radiogroup" aria-labelledby="etiqueta-tono">
          ${TONOS.map((t) => html`
            <button key=${t.id} type="button" role="radio" aria-checked=${solicitud.tono === t.id}
              className=${"asis-tono" + (solicitud.tono === t.id ? " activo" : "")}
              onClick=${() => setSolicitud({ ...solicitud, tono: t.id })}>
              <strong>${t.nombre}</strong>
            </button>`)}
        </div>
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
      <p className="asis-nota">Los precios los calcula nuestro servidor.</p>
    </form>`;
}

// ===== Paso 2: elegir una de las 3 propuestas =====

// Colores de la maqueta según el estilo que la IA eligió para el negocio
const PALETAS_MAQUETA = {
  moderno: { fondo: "#0f1424", superficie: "#1c2440", texto: "#eef1ff", acento: "#6d7cff", serif: false },
  elegante: { fondo: "#f4efe6", superficie: "#e6dccb", texto: "#2b2420", acento: "#9b7a45", serif: true },
  natural: { fondo: "#eef3ea", superficie: "#d9e6d1", texto: "#1f2d22", acento: "#4f7a4a", serif: false },
  vibrante: { fondo: "#fff3ea", superficie: "#ffdcc6", texto: "#2a1a12", acento: "#ff5a36", serif: false },
  minimalista: { fondo: "#fafafa", superficie: "#e9e9e9", texto: "#111111", acento: "#111111", serif: false },
  tecnologico: { fondo: "#0a0f1c", superficie: "#13203a", texto: "#e6faff", acento: "#22d3ee", serif: false }
};

const PREGUNTA_OTRA = "El cliente describe con más detalle lo que quiere (ninguna propuesta le convencía)";

const dominioDe = (cliente) =>
  (cliente || "tu-negocio").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 18) + ".com";

// Iconos de los bloques destacados según el sector del negocio
const ICONOS_SECTOR = {
  restauracion: ["🍽️", "🍷", "📅"], moda: ["👗", "👜", "🚚"], salud: ["🩺", "💙", "📅"], belleza: ["💇", "💅", "✨"],
  inmobiliaria: ["🏠", "🔑", "📍"], educacion: ["📚", "🎓", "✏️"], tecnologia: ["💻", "⚙️", "🚀"], deporte: ["🏋️", "⏱️", "🏆"],
  turismo: ["✈️", "🏨", "🗺️"], profesional: ["💼", "📊", "🤝"], comercio: ["🛍️", "🏷️", "📦"], arte: ["🎨", "📷", "🎭"],
  otro: ["⭐", "💬", "📍"]
};

/**
 * «Imagen» de la propuesta: una maqueta de la web con lo que incluye. Usa los textos que
 * propone la IA (titular, botón, destacados), los iconos del sector, la foto de Pexels si
 * la hay y una composición distinta según el tipo de web y la posición de la tarjeta.
 */
function MaquetaWeb({ opcion, cliente, sector, indice }) {
  const c = PALETAS_MAQUETA[opcion.estilo] || PALETAS_MAQUETA.moderno;
  const ids = opcion.servicios.map((x) => x.id);
  const esLanding = ids.includes("landing");
  const formulario = ids.includes("formulario");
  const idioma = ids.includes("segundo-idioma");
  const secciones = opcion.secciones.length ? opcion.secciones : ["Inicio", "Servicios", "Nosotros", "Contacto"];
  const menu = secciones.slice(0, 4);
  const resto = Math.max(0, (esLanding ? 0 : opcion.paginas || secciones.length) - menu.length);
  const nombre = cliente || "Tu negocio";
  const titular = opcion.titular || nombre;
  const boton = opcion.boton || (formulario ? "Escríbenos" : "Descubre más");
  const destacados = (opcion.destacados?.length ? opcion.destacados : secciones.slice(1, 4)).slice(0, 3);
  const iconos = ICONOS_SECTOR[sector] || ICONOS_SECTOR.otro;
  const foto = opcion.foto?.url;
  // Composición: la landing lleva foto a toda la anchura; las corporativas alternan dividida y banner
  const variante = esLanding ? "portada" : indice % 2 === 1 ? "dividida" : "banner";
  const estilo = {
    "--m-fondo": c.fondo, "--m-superficie": c.superficie, "--m-texto": c.texto, "--m-acento": c.acento,
    "--m-titulo": c.serif ? "var(--serif)" : "var(--fuente)",
    "--m-foto": foto ? `url("${foto.replace(/"/g, "%22")}")` : "none"
  };
  const claseFoto = "maqueta__foto" + (foto ? " con-foto" : "");
  const textos = html`
    <strong className="maqueta__titular">${titular}</strong>
    <span className="maqueta__sub">${nombre}</span>
    <span className="maqueta__boton">${boton}</span>`;

  return html`
    <div className=${`maqueta maqueta--${variante}`} style=${estilo} role="img"
      aria-label=${`Vista previa de la propuesta ${opcion.titulo}: ${titular}. ${esLanding ? "Una página" : `${opcion.paginas} páginas`}${formulario ? ", con formulario" : ""}${idioma ? ", en dos idiomas" : ""}.`}>
      <div className="maqueta__barra">
        <i></i><i></i><i></i><span>${dominioDe(cliente)}</span>
        <em className="maqueta__paginas">${esLanding ? "1 página" : `${opcion.paginas ?? "?"} páginas`}</em>
      </div>
      <div className="maqueta__pagina">
        <div className="maqueta__nav">
          <b className="maqueta__logo">${nombre.trim().charAt(0).toUpperCase()}</b>
          <span className="maqueta__menu">
            ${menu.map((m) => html`<span key=${m}>${m}</span>`)}
            ${resto > 0 && html`<span>+${resto}</span>`}
          </span>
          ${idioma && html`<span className="maqueta__idioma">ES · EN</span>`}
        </div>

        ${variante === "portada" && html`
          <div className=${"maqueta__hero maqueta__hero--portada " + claseFoto} data-icono=${iconos[0]}>
            <div className="maqueta__velo"></div>
            <div className="maqueta__texto">${textos}</div>
          </div>`}
        ${variante === "dividida" && html`
          <div className="maqueta__hero maqueta__hero--dividida">
            <div className="maqueta__texto">${textos}</div>
            <div className=${claseFoto} data-icono=${iconos[0]}></div>
          </div>`}
        ${variante === "banner" && html`
          <div className=${"maqueta__banner " + claseFoto} data-icono=${iconos[0]}></div>
          <div className="maqueta__hero maqueta__hero--centro"><div className="maqueta__texto">${textos}</div></div>`}

        <div className="maqueta__destacados">
          ${destacados.map((d, n) => html`<div key=${d + n}><span aria-hidden="true">${iconos[n] || iconos[0]}</span><b>${d}</b></div>`)}
        </div>
        ${formulario && html`<div className="maqueta__form"><b>Escríbenos</b><i></i><i></i><span></span></div>`}
      </div>
    </div>`;
}

function TarjetaPropuesta({ opcion, cliente, sector, indice, onElegir, cargando }) {
  const extras = opcion.servicios.filter((x) => x.categoria === "extra");
  const tipo = opcion.servicios.find((x) => x.categoria === "tipo");
  return html`
    <article className=${"asis-propuesta cristal" + (opcion.recomendada ? " recomendada" : "")}>
      ${opcion.recomendada && html`<span className="asis-propuesta__sello">Recomendada</span>`}
      <div className="maqueta-envoltorio">
        <${MaquetaWeb} opcion=${opcion} cliente=${cliente} sector=${sector} indice=${indice} />
        ${opcion.foto && html`
          <a className="maqueta__credito" href=${opcion.foto.enlace} target="_blank" rel="noopener">Foto: ${opcion.foto.autor} · Pexels</a>`}
      </div>
      <div className="asis-propuesta__cuerpo">
        <div className="asis-propuesta__cabecera">
          <h3>${opcion.titulo}</h3>
          <strong className="asis-propuesta__precio">${opcion.importe != null ? formatear(opcion.importe) : "A calcular"}</strong>
        </div>
        <p className="asis-propuesta__enfoque">${opcion.enfoque}</p>
        <ul className="asis-propuesta__incluye">
          <li>${tipo?.nombre}${tipo?.id === "corporativa" && opcion.paginas ? ` · ${opcion.paginas} páginas` : ""}</li>
          ${extras.map((x) => html`<li key=${x.id}>${x.nombre}</li>`)}
        </ul>
        <button type="button" className=${"boton" + (opcion.recomendada ? "" : " boton--borde")} disabled=${cargando} onClick=${onElegir}>Elegir esta →</button>
      </div>
    </article>`;
}

function PasoEleccion({ propuesta, cliente, ronda, onElegir, onOtra, onVolver, cargando, error }) {
  const [detalle, setDetalle] = useState("");
  const fuera = propuesta.pendientes.filter((x) => x.tipo === "fuera_de_catalogo");
  const notas = propuesta.pendientes.filter((x) => x.tipo === "nota");
  const pedirOtra = () => detalle.trim() && onOtra(detalle.trim());
  return html`
    <div className="asis-eleccion">
      <div className="asis-eleccion__intro">
        <p className="asis-eleccion__resumen">${propuesta.resumen}</p>
        <p className="asis-nota">${ronda > 1 ? "Propuestas nuevas con lo que nos has contado. " : ""}Elige una y después podrás ajustarla. Precios sin impuestos.</p>
        ${fuera.map((x) => html`<p key=${x.texto} className="asis-eleccion__fuera"><b>Fuera de catálogo:</b> ${x.texto}</p>`)}
        ${notas.map((x) => html`<p key=${x.texto} className="asis-nota">${x.texto}</p>`)}
        ${propuesta.avisos.length > 0 && html`<ul className="asis-avisos">${propuesta.avisos.map((a) => html`<li key=${a}>${a}</li>`)}</ul>`}
      </div>

      <div className="asis-propuestas">
        ${propuesta.propuestas.map((o, i) => html`
          <${TarjetaPropuesta} key=${o.titulo + i} opcion=${o} cliente=${cliente} sector=${propuesta.sector} indice=${i} cargando=${cargando} onElegir=${() => onElegir(i)} />`)}
      </div>

      <section className="asis-otra-propuesta cristal" aria-labelledby="titulo-otra">
        <div>
          <h3 id="titulo-otra">¿Ninguna encaja? <em>Otra</em></h3>
          <p className="asis-nota">Cuéntanos cómo la imaginas y te damos tres nuevas.</p>
        </div>
        <textarea rows="4" maxLength="300" value=${detalle} onChange=${(e) => setDetalle(e.target.value)}
          aria-label="Describe con detalle la web que quieres"
          placeholder="Ej.: dos páginas, fotos grandes y un formulario para pedir mesa…"></textarea>
        <button type="button" className="boton" disabled=${!detalle.trim() || cargando} onClick=${pedirOtra}>
          ${cargando ? html`<span className="asis-girando" aria-hidden="true"></span> Preparando propuestas…` : "Nuevas propuestas →"}
        </button>
      </section>

      <${MensajeError} error=${error} onReintentar=${error?.reintentar ? pedirOtra : null} />

      <div className="asis-acciones">
        <button type="button" className="boton boton--fantasma" onClick=${onVolver}>← Cambiar la descripción</button>
      </div>
    </div>`;
}

// ===== Paso 3: revisión =====

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
        <span className="asis-servicio__regla">${servicio.regla}</span>
        ${justificacion && html`<span className="asis-servicio__ia"><b>IA</b> ${justificacion}</span>`}
      </span>
    </label>`;
}

function PasoRevision({ catalogo, propuesta, seleccion, setSeleccion, onVolver, textoVolver = "← Cambiar la descripción", onCalcular, onRepreguntar, ronda, cargando, error }) {
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
  const cambiarPendiente = (i, cambio) => cambiar({ pendientes: seleccion.pendientes.map((p, j) => (j === i ? { ...p, ...cambio } : p)) });
  const quitarPendiente = (i) => cambiar({ pendientes: seleccion.pendientes.filter((_, j) => j !== i) });
  const anadirPendiente = () =>
    cambiar({ pendientes: [...seleccion.pendientes, { tipo: "nota", texto: "", motivo: "", opciones: [], editable: true }] });

  // Pulsar una opción: se guarda la respuesta y se aplica su efecto (servicios o páginas) a la vez.
  const responder = (i, opcion) => {
    const efecto = aplicarAccion(seleccion, opcion, catalogo);
    setSeleccion({
      ...seleccion,
      ...efecto,
      pendientes: seleccion.pendientes.map((p, j) => (j === i ? { ...p, respuesta: opcion.texto } : p))
    });
  };

  const respondidas = seleccion.pendientes.filter((p) => p.tipo === "aclaracion" && p.respuesta?.trim()).length;
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
          <legend>Tipo de web</legend>
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
              : "Incluye la primera página."}</span>
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
              <li key=${i} className=${"asis-pendiente asis-pendiente--" + p.tipo + (p.respuesta ? " respondida" : "")}>
                <span className="asis-pendiente__tipo">
                  ${p.tipo === "fuera_de_catalogo" ? "Fuera de catálogo" : p.tipo === "aclaracion" ? (p.respuesta ? "✓ Respondida" : "Pregunta") : "Nota"}
                </span>
                <div className="asis-pendiente__cuerpo">
                  ${p.editable
                    ? html`<textarea rows="2" maxLength="400" value=${p.texto} placeholder="Escribe la aclaración…" onChange=${(e) => cambiarPendiente(i, { texto: e.target.value })}></textarea>`
                    : html`<p className="asis-pendiente__texto">${p.texto}</p>`}
                  ${p.motivo && html`<p className="asis-pendiente__motivo">${p.motivo}</p>`}
                  ${p.tipo === "aclaracion" && html`
                    <div className="asis-opciones">
                      ${p.opciones.map((o) => html`
                        <button key=${o.texto} type="button" aria-pressed=${p.respuesta === o.texto}
                          className=${"asis-chip asis-opcion" + (p.respuesta === o.texto ? " activo" : "")}
                          onClick=${() => responder(i, o)}>${o.texto}</button>`)}
                      <input type="text" className="asis-otra" maxLength="200" placeholder=${p.opciones.length ? "Otra respuesta…" : "Tu respuesta…"}
                        aria-label=${"Respuesta a: " + p.texto}
                        value=${p.opciones.some((o) => o.texto === p.respuesta) ? "" : p.respuesta ?? ""}
                        onChange=${(e) => cambiarPendiente(i, { respuesta: e.target.value })} />
                    </div>`}
                </div>
                <button type="button" className="asis-quitar" aria-label="Quitar" onClick=${() => quitarPendiente(i)}>×</button>
              </li>`)}
          </ul>
          <div className="asis-acciones asis-acciones--izq">
            <button type="button" className="asis-chip" onClick=${anadirPendiente}>+ Añadir nota</button>
            ${respondidas > 0 && html`
              <button type="button" className="asis-chip asis-chip--ia" disabled=${cargando} onClick=${onRepreguntar}>
                ${cargando ? "Consultando a la IA…" : `↻ Volver a proponer con mis ${respondidas} ${respondidas === 1 ? "respuesta" : "respuestas"}`}
              </button>`}
          </div>

        </fieldset>

        <${MensajeError} error=${error} onReintentar=${error?.reintentar ? onRepreguntar : null} />

        <div className="asis-acciones">
          <button type="button" className="boton boton--fantasma" onClick=${onVolver}>${textoVolver}</button>
          <button type="button" className="boton cristal cristal--liquido borde-vivo" disabled=${!listo || cargando} onClick=${onCalcular}>
            ${cargando ? html`<span className="asis-girando" aria-hidden="true"></span> Calculando…` : "Calcular presupuesto →"}
          </button>
        </div>
        ${!tipoElegido && html`<p className="asis-nota">Elige un tipo de web para poder calcular el presupuesto.</p>`}
      </section>
    </div>`;
}

// ===== Paso 4: presupuesto + vista previa del PDF =====

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
      <aside className="resultado cristal">
        <span className="resultado__titulo">Total · calculado por el servidor</span>
        <strong className="resultado__total">${formatear(presupuesto.total, presupuesto.moneda)}</strong>
        <ul className="desglose">
          ${presupuesto.lineas.map((l) => html`
            <li key=${l.id}><span>${l.concepto} <small>· ${l.detalle}</small></span><b>${formatear(l.importe, presupuesto.moneda)}</b></li>`)}
        </ul>
        <p className="asis-nota">Precio sin impuestos.</p>
        <div className="asis-acciones asis-acciones--columna">
          ${urlPdf
            ? html`<a className="boton cristal cristal--liquido borde-vivo" href=${urlPdf} download=${archivo}>⬇ Aceptar y descargar PDF</a>`
            : html`<button type="button" className="boton cristal" disabled>Generando PDF…</button>`}
          <button type="button" className="boton boton--fantasma" onClick=${onEditar}>← Modificar servicios</button>
        </div>
        <${MensajeError} error=${errorPdf} onReintentar=${onReintentarPdf} />
      </aside>

      <div className="vista cristal asis-vista">
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

function Asistente({ desdeChat }) {
  const [paso, setPaso] = useState(0);
  const [catalogo, setCatalogo] = useState(null);
  const [solicitud, setSolicitud] = useState({ cliente: "", descripcion: "", tono: "cercano" });
  const [respuestas, setRespuestas] = useState([]); // respuestas acumuladas de todas las rondas
  const [ronda, setRonda] = useState(1);
  const [propuesta, setPropuesta] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [elegida, setElegida] = useState(null); // índice de la propuesta elegida
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
    requestAnimationFrame(() => desplazar(raiz.current));
  };

  // La barra de la portada envía la descripción: se carga en el paso 1 y se pide el nombre.
  useEffect(() => {
    const alRecibir = (e) => {
      const descripcion = String(e.detail?.descripcion ?? "").slice(0, MAX_DESCRIPCION);
      setSolicitud((s) => ({ ...s, descripcion }));
      setPaso(0);
      setError(null);
      requestAnimationFrame(() => {
        desplazar(raiz.current);
        setTimeout(() => {
          const campo = raiz.current?.querySelector('input[name="cliente"]');
          if (campo && !campo.value) campo.focus({ preventScroll: true });
        }, 500);
      });
    };
    window.addEventListener("asistente:descripcion", alRecibir);
    return () => window.removeEventListener("asistente:descripcion", alRecibir);
  }, []);

  // La conversación del chat flotante llega aquí para revisarla y calcular el presupuesto.
  useEffect(() => {
    if (!desdeChat) return;
    const { solicitud: s, respuestas: resp, ronda: n, propuesta: p } = desdeChat;
    setSolicitud(s);
    setRespuestas(resp);
    setRonda(n);
    setPresupuesto(null);
    setPdf(null);
    cargarPropuesta(p, resp);
  }, [desdeChat]);

  const respondidas = (resp) =>
    resp.filter((a) => a.pregunta !== PREGUNTA_OTRA).map((a) => ({ tipo: "aclaracion", texto: a.pregunta, respuesta: a.respuesta, motivo: "", opciones: [] }));

  /** Selección inicial a partir de unos servicios y páginas (de una propuesta o de la raíz). */
  const seleccionDesde = (datos, servicios, paginas, resp) => ({
    cliente: datos.cliente,
    resumen: datos.resumen,
    servicios: servicios.map((x) => x.id),
    paginas,
    pendientes: [...respondidas(resp), ...datos.pendientes, ...(seleccion?.pendientes || []).filter((x) => x.editable)]
  });

  /** Muestra las 3 propuestas para elegir (o, si no las hay, va directo a la revisión). */
  function cargarPropuesta(datos, resp) {
    setPropuesta(datos);
    setElegida(null);
    if (datos.propuestas?.length) return irA(1);
    setSeleccion(seleccionDesde(datos, datos.servicios, datos.paginas, resp));
    irA(2);
  }

  function elegir(i) {
    const o = propuesta.propuestas[i];
    setElegida(i);
    setSeleccion(seleccionDesde(propuesta, o.servicios, o.paginas, respuestas));
    irA(2);
  }

  // «Otra»: el cliente describe con detalle lo que quiere y la IA prepara 3 propuestas nuevas
  async function otraPropuesta(detalle) {
    setError(null);
    const todas = [...respuestas.filter((a) => a.pregunta !== PREGUNTA_OTRA), { pregunta: PREGUNTA_OTRA, respuesta: detalle }].slice(-10);
    setCargando(true);
    const r = await enviar("/api/propuesta", { ...solicitud, respuestas: todas });
    setCargando(false);
    if (!r.ok) return setError(r.datos);
    setRespuestas(todas);
    setRonda((n) => n + 1);
    cargarPropuesta(r.datos, todas);
  }

  async function pedirPropuesta() {
    setError(null);
    // Comprobación rápida en el navegador; el servidor vuelve a validar.
    if (!solicitud.cliente.trim() || !solicitud.descripcion.trim()) {
      return setError({ error: "Faltan datos", detalles: [!solicitud.cliente.trim() && "Escribe el nombre del cliente o de la empresa.", !solicitud.descripcion.trim() && "Describe el proyecto: la descripción no puede estar vacía."].filter(Boolean) });
    }
    setCargando(true);
    const r = await enviar("/api/propuesta", { ...solicitud, respuestas: [] });
    setCargando(false);
    if (!r.ok) return setError(r.datos);

    setRespuestas([]);
    setRonda(1);
    setSeleccion(null);
    cargarPropuesta(r.datos, []);
  }

  // Segunda ronda: se envían a la IA la descripción original y las respuestas a las aclaraciones.
  async function repreguntar() {
    setError(null);
    const nuevas = seleccion.pendientes
      .filter((p) => p.tipo === "aclaracion" && p.respuesta?.trim())
      .map((p) => ({ pregunta: p.texto, respuesta: p.respuesta.trim() }));
    const todas = [...respuestas.filter((a) => !nuevas.some((n) => n.pregunta === a.pregunta)), ...nuevas].slice(-10);

    setCargando(true);
    const r = await enviar("/api/propuesta", { ...solicitud, respuestas: todas });
    setCargando(false);
    if (!r.ok) return setError(r.datos);

    setRespuestas(todas);
    setRonda((n) => n + 1);
    cargarPropuesta(r.datos, todas);
  }

  const cuerpoSeleccion = () => ({
    ...seleccion,
    pendientes: seleccion.pendientes.filter((p) => p.texto.trim()).map(textoPendiente)
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
    irA(3);
    generarPdf();
  }

  return html`
    <div className="asistente" ref=${raiz}>
      <${Pasos} paso=${paso} />
      ${paso === 0 && html`<${PasoSolicitud} solicitud=${solicitud} setSolicitud=${setSolicitud} onEnviar=${pedirPropuesta} cargando=${cargando} error=${error} />`}
      ${paso === 1 && propuesta?.propuestas?.length > 0 && html`
        <${PasoEleccion} propuesta=${propuesta} cliente=${solicitud.cliente} ronda=${ronda}
          onElegir=${elegir} onOtra=${otraPropuesta} onVolver=${() => irA(0)} cargando=${cargando} error=${error} />`}
      ${paso === 2 && catalogo && seleccion && html`
        <${PasoRevision} catalogo=${catalogo} seleccion=${seleccion} setSeleccion=${setSeleccion}
          propuesta=${elegida != null ? { ...propuesta, servicios: propuesta.propuestas[elegida].servicios } : propuesta}
          onVolver=${() => irA(propuesta?.propuestas?.length ? 1 : 0)}
          textoVolver=${propuesta?.propuestas?.length ? "← Ver las otras propuestas" : "← Cambiar la descripción"}
          onCalcular=${calcular} onRepreguntar=${repreguntar} ronda=${ronda} cargando=${cargando} error=${error} />`}
      ${paso === 3 && html`
        <${PasoPresupuesto} presupuesto=${presupuesto} pdf=${pdf} errorPdf=${errorPdf}
          onReintentarPdf=${generarPdf} onEditar=${() => { setPdf(null); irA(2); }} />`}
    </div>`;
}

// ===== Chat flotante: conversación con la IA =====
// Usa las mismas rutas del servidor. Pregunta el nombre, recoge la descripción, muestra
// la propuesta y hace las aclaraciones una a una (con botones). Con las respuestas vuelve
// a pedir la propuesta a la IA. Al terminar, la pasa a la sección para revisar y calcular.

const MAX_RONDAS = 4;
let idMensaje = 0;
const mensaje = (de, datos) => ({ id: ++idMensaje, de, ...datos });

const SALUDO = [
  mensaje("ia", { texto: "¡Hola! Soy el asistente de Presupuesta mi web. Te ayudo a saber qué web necesitas y cuánto costaría." }),
  mensaje("ia", { texto: "Para empezar, ¿cómo se llama tu negocio o empresa?" })
];

function BurbujaPropuesta({ p }) {
  const fuera = p.pendientes.filter((x) => x.tipo === "fuera_de_catalogo");
  const notas = p.pendientes.filter((x) => x.tipo === "nota");
  return html`
    <div className="chat-propuesta">
      <p>${p.resumen}</p>
      ${p.propuestas?.length > 0
        ? html`<ul className="chat-servicios">
            ${p.propuestas.map((o) => html`
              <li key=${o.titulo}>
                <b>${o.recomendada ? "★ " : ""}${o.titulo} · ${o.importe != null ? formatear(o.importe) : "a calcular"}</b>
                <span>${o.servicios.map((x) => x.nombre).join(" + ")}${o.servicios.some((x) => x.id === "corporativa") && o.paginas ? ` · ${o.paginas} páginas` : ""}</span>
              </li>`)}
          </ul>`
        : p.servicios.length > 0
          ? html`<ul className="chat-servicios">
              ${p.servicios.map((s) => html`<li key=${s.id}><b>${s.nombre}</b><span>${s.justificacion}</span></li>`)}
            </ul>`
          : html`<p className="chat-tenue">Todavía no hay ningún servicio de nuestro catálogo que encaje.</p>`}
      ${fuera.map((x) => html`<p key=${x.texto} className="chat-fuera"><b>Fuera de catálogo:</b> ${x.texto}</p>`)}
      ${notas.map((x) => html`<p key=${x.texto} className="chat-tenue">${x.texto}</p>`)}
      ${p.avisos.map((a) => html`<p key=${a} className="chat-aviso">${a}</p>`)}
    </div>`;
}

function ChatFlotante({ onRevisar }) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState(SALUDO);
  const [fase, setFase] = useState("nombre"); // nombre → descripcion → preguntas → listo
  const [texto, setTexto] = useState("");
  const [tono, setTono] = useState("cercano");
  const [cliente, setCliente] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [respuestas, setRespuestas] = useState([]);
  const [cola, setCola] = useState([]); // preguntas que faltan por responder
  const [propuesta, setPropuesta] = useState(null);
  const [ronda, setRonda] = useState(0);
  const [pensando, setPensando] = useState(false);
  const [reintento, setReintento] = useState(null);
  const lista = useRef(null);
  const entrada = useRef(null);
  const boton = useRef(null);

  const pregunta = fase === "preguntas" ? cola[0] : null;
  const decir = (...nuevos) => setMensajes((m) => [...m, ...nuevos]);

  // Siempre al final de la conversación; foco en el campo al abrir; Esc cierra
  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: "smooth" });
  }, [mensajes, pensando]);
  useEffect(() => {
    if (!abierto) return;
    entrada.current?.focus();
    const alPulsar = (e) => {
      if (e.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [abierto]);

  async function proponer(datos) {
    setReintento(null);
    setPensando(true);
    const r = await enviar("/api/propuesta", { cliente: datos.cliente, descripcion: datos.descripcion, tono, respuestas: datos.respuestas });
    setPensando(false);
    if (!r.ok) {
      decir(mensaje("ia", { error: true, texto: [r.datos.error, ...(r.datos.detalles || [])].join(" ") }));
      if (r.datos.codigo === "fuera_de_tema") {
        if (datos.rondaPrevia === 0) {
          // La descripción no es de una web: se pide otra
          setFase("descripcion");
        } else {
          // Lo último que escribió no es de la web: se descarta y se conserva la propuesta anterior
          setRespuestas(datos.respuestas.slice(0, -1));
          setCola([]);
          setFase("listo");
          decir(mensaje("ia", { listo: true, texto: "Mantengo la propuesta anterior. Puedes revisarla o contarme algo más sobre tu web." }));
        }
      } else if (r.estado === 400) {
        // Datos no válidos (por ejemplo, descripción muy corta): se pide de nuevo
        setFase("descripcion");
      } else if (r.datos.reintentar !== false) {
        setReintento(() => () => proponer(datos));
      }
      return;
    }

    const n = datos.rondaPrevia + 1;
    setRonda(n);
    setPropuesta(r.datos);
    const preguntas = n < MAX_RONDAS ? r.datos.pendientes.filter((x) => x.tipo === "aclaracion") : [];
    decir(mensaje("ia", { texto: n === 1 ? "Te propongo tres opciones:" : "He actualizado las propuestas con tus respuestas:" }), mensaje("ia", { propuesta: r.datos }));

    if (preguntas.length) {
      setCola(preguntas);
      setFase("preguntas");
      decir(mensaje("ia", { texto: `Tengo ${preguntas.length === 1 ? "una pregunta" : `${preguntas.length} preguntas`} para afinar el presupuesto.` }), mensaje("ia", { pregunta: preguntas[0] }));
    } else {
      setCola([]);
      setFase("listo");
      decir(mensaje("ia", { listo: true, texto: "¡Listo! Mira las tres propuestas con su vista previa y elige la que más te guste. Si quieres añadir algo, escríbemelo." }));
    }
  }

  function responder(respuesta, actual = pregunta) {
    const todas = [...respuestas.filter((a) => a.pregunta !== actual.texto), { pregunta: actual.texto, respuesta }].slice(-10);
    setRespuestas(todas);
    decir(mensaje("yo", { texto: respuesta }));
    const resto = cola.slice(1);
    setCola(resto);
    if (resto.length) {
      decir(mensaje("ia", { pregunta: resto[0] }));
    } else {
      proponer({ cliente, descripcion, respuestas: todas, rondaPrevia: ronda });
    }
  }

  function enviarTexto(e) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || pensando) return;
    setTexto("");

    if (fase === "nombre") {
      if (t.length > MAX_CLIENTE) return decir(mensaje("yo", { texto: t }), mensaje("ia", { error: true, texto: `El nombre es demasiado largo (máximo ${MAX_CLIENTE} caracteres).` }));
      setCliente(t);
      setFase("descripcion");
      return decir(
        mensaje("yo", { texto: t }),
        mensaje("ia", { texto: `Encantado, ${t}. Cuéntame qué web necesitas: a qué te dedicas, qué secciones quieres, si necesitas formulario, idiomas…`, ejemplos: true })
      );
    }
    if (fase === "descripcion") {
      decir(mensaje("yo", { texto: t }));
      setDescripcion(t);
      setRespuestas([]);
      setRonda(0);
      return proponer({ cliente, descripcion: t, respuestas: [], rondaPrevia: 0 });
    }
    if (fase === "preguntas") return responder(t);
    // fase "listo": lo que escriba se añade como información extra y se vuelve a proponer
    const todas = [...respuestas, { pregunta: "Información adicional del cliente", respuesta: t }].slice(-10);
    setRespuestas(todas);
    decir(mensaje("yo", { texto: t }));
    proponer({ cliente, descripcion, respuestas: todas, rondaPrevia: ronda });
  }

  function usarEjemplo(ej) {
    setDescripcion(ej.descripcion);
    decir(mensaje("yo", { texto: ej.descripcion }));
    setRespuestas([]);
    setRonda(0);
    proponer({ cliente, descripcion: ej.descripcion, respuestas: [], rondaPrevia: 0 });
  }

  function saltarPreguntas() {
    setCola([]);
    setFase("listo");
    decir(mensaje("ia", { listo: true, texto: "De acuerdo. Las dudas quedarán como pendientes y podrás completarlas en la revisión." }));
  }

  function revisar() {
    onRevisar({ solicitud: { cliente, descripcion, tono }, respuestas, ronda, propuesta });
    setAbierto(false); // se cierra para dejar ver la revisión; la conversación se conserva
  }

  function reiniciar() {
    setMensajes(SALUDO);
    setFase("nombre");
    setCliente("");
    setDescripcion("");
    setRespuestas([]);
    setCola([]);
    setPropuesta(null);
    setRonda(0);
    setReintento(null);
    setTexto("");
  }

  const placeholder = {
    nombre: "Nombre de tu negocio…",
    descripcion: "Describe tu proyecto…",
    preguntas: "Escribe otra respuesta…",
    listo: "¿Algo más que añadir?"
  }[fase];

  return html`
    <div className=${"chat" + (abierto ? " chat--abierto" : "")}>
      <section className="chat__panel cristal" role="dialog" aria-modal="false" aria-label="Chat con el asistente de presupuestos" hidden=${!abierto}>
        <header className="chat__cabecera">
          <span className="chat__avatar" aria-hidden="true">✦</span>
          <div className="chat__titulo">
            <strong>Asistente IA</strong>
            <small>${pensando ? "Escribiendo…" : "Propone servicios de nuestro catálogo"}</small>
          </div>
          <div className="chat__tono" role="radiogroup" aria-label="Tono">
            ${TONOS.map((t) => html`
              <button key=${t.id} type="button" role="radio" aria-checked=${tono === t.id} className=${tono === t.id ? "activo" : ""} onClick=${() => setTono(t.id)}>${t.nombre}</button>`)}
          </div>
          <button type="button" className="chat__icono" title="Empezar de nuevo" aria-label="Empezar de nuevo" onClick=${reiniciar}>↺</button>
          <button type="button" className="chat__icono" title="Cerrar" aria-label="Cerrar el chat" onClick=${() => setAbierto(false)}>×</button>
        </header>

        <div className="chat__mensajes" ref=${lista} aria-live="polite" data-lenis-prevent>
          ${mensajes.map((m) => html`
            <div key=${m.id} className=${`chat__msg chat__msg--${m.de}` + (m.error ? " chat__msg--error" : "")}>
              ${m.texto && html`<p>${m.texto}</p>`}
              ${m.propuesta && html`<${BurbujaPropuesta} p=${m.propuesta} />`}
              ${m.pregunta && html`
                <div className="chat-pregunta">
                  <p><b>${m.pregunta.texto}</b></p>
                  ${m.pregunta.motivo && html`<p className="chat-tenue">${m.pregunta.motivo}</p>`}
                  ${pregunta === m.pregunta && !pensando && html`
                    <div className="chat-opciones">
                      ${m.pregunta.opciones.map((o) => html`<button key=${o.texto} type="button" className="asis-chip" onClick=${() => responder(o.texto)}>${o.texto}</button>`)}
                      <button type="button" className="asis-chip chat-saltar" onClick=${saltarPreguntas}>Saltar preguntas</button>
                    </div>`}
                </div>`}
              ${m.ejemplos && fase === "descripcion" && !pensando && html`
                <div className="chat-opciones">
                  ${EJEMPLOS.map((ej) => html`<button key=${ej.etiqueta} type="button" className="asis-chip" onClick=${() => usarEjemplo(ej)}>Ejemplo: ${ej.etiqueta}</button>`)}
                </div>`}
              ${m.listo && fase === "listo" && m.id === mensajes[mensajes.length - 1].id && html`
                <button type="button" className="boton boton--pequeno chat-revisar" onClick=${revisar}>Ver las 3 propuestas →</button>`}
            </div>`)}
          ${pensando && html`<div className="chat__msg chat__msg--ia chat__escribiendo" aria-label="El asistente está escribiendo"><i></i><i></i><i></i></div>`}
          ${reintento && !pensando && html`
            <button type="button" className="boton boton--pequeno chat-revisar" onClick=${reintento}>↻ Volver a intentarlo</button>`}
        </div>

        <form className="chat__entrada" onSubmit=${enviarTexto}>
          <textarea
            ref=${entrada} data-lenis-prevent rows="1" value=${texto} placeholder=${placeholder} aria-label="Escribe tu mensaje"
            maxLength=${fase === "nombre" ? MAX_CLIENTE : MAX_DESCRIPCION}
            onChange=${(e) => setTexto(e.target.value)}
            onKeyDown=${(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form.requestSubmit();
              }
            }}
          ></textarea>
          <button type="submit" className="chat__enviar" aria-label="Enviar" disabled=${!texto.trim() || pensando}>➤</button>
        </form>
      </section>

      <button type="button" ref=${boton} className="chat__burbuja cristal borde-vivo" aria-expanded=${abierto} aria-label=${abierto ? "Cerrar el chat" : "Habla con el asistente IA"} onClick=${() => setAbierto(!abierto)}>
        <span className="chat__burbuja-icono" aria-hidden="true">${abierto ? "×" : "✦"}</span>
        <span className="chat__burbuja-texto">${abierto ? "Cerrar" : "Habla con la IA"}</span>
      </button>
    </div>`;
}

// ===== Raíz: la sección del asistente y el chat flotante comparten estado =====

function App() {
  const [desdeChat, setDesdeChat] = useState(null);
  return html`
    <${React.Fragment}>
      ${ReactDOM.createPortal(html`<${Asistente} desdeChat=${desdeChat} />`, document.getElementById("app-asistente"))}
      <${ChatFlotante} onRevisar=${(datos) => setDesdeChat({ ...datos, momento: Date.now() })} />
    </${React.Fragment}>`;
}

const contenedorChat = document.createElement("div");
contenedorChat.id = "app-chat";
document.body.appendChild(contenedorChat);
ReactDOM.createRoot(contenedorChat).render(html`<${App} />`);
