// Calculadora de "Presupuesta mi web" hecha con React.
// React se carga por CDN y usamos "htm" para escribir algo parecido a JSX sin compilar:
//   html`<div className="hola">${valor}</div>`
// Los precios NO están aquí: el total siempre lo devuelve POST /api/presupuesto.

const { useState, useEffect, useRef } = React;
const html = htm.bind(React.createElement);

const MENOS_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const NOMBRES_PAGINAS = [
  "Inicio", "Servicios", "Nosotros", "Proyectos", "Blog", "Contacto", "Equipo", "Clientes", "Precios", "FAQ",
  "Empleo", "Prensa", "Casos", "Recursos", "Eventos", "Partners", "Soporte", "Legal", "Privacidad", "Cookies"
];

const formatear = (n, moneda = "EUR") =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: moneda, maximumFractionDigits: 0, useGrouping: "always" }).format(n);

// ===== Hooks =====

// Pide el presupuesto a la API cada vez que cambian los datos (con una pequeña espera)
function usePresupuesto(datos) {
  const [estado, setEstado] = useState({ resultado: null, error: null, cargando: true });

  useEffect(() => {
    const control = new AbortController();
    setEstado((e) => ({ ...e, cargando: true }));

    const espera = setTimeout(async () => {
      try {
        const r = await fetch("/api/presupuesto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(datos),
          signal: control.signal
        });
        const cuerpo = await r.json();
        if (r.ok) setEstado({ resultado: cuerpo, error: null, cargando: false });
        else setEstado((e) => ({ ...e, error: cuerpo, cargando: false }));
      } catch (err) {
        if (err.name === "AbortError") return; // llegó una petición más nueva
        setEstado((e) => ({ ...e, error: { error: "sin-conexion" }, cargando: false }));
      }
    }, 120);

    // Si los datos cambian antes de responder, se cancela la petición anterior
    return () => {
      clearTimeout(espera);
      control.abort();
    };
  }, [datos.tipo, datos.paginas, datos.formulario, datos.segundoIdioma]);

  return estado;
}

// Hace que un número "cuente" hasta su nuevo valor
function useContador(destino) {
  const [valor, setValor] = useState(destino ?? 0);
  const actual = useRef(valor);

  useEffect(() => {
    if (destino == null) return;
    const inicio = actual.current;
    const duracion = MENOS_MOVIMIENTO ? 0 : 600;
    const t0 = performance.now();
    let frame;
    const paso = (ahora) => {
      const p = duracion ? Math.min((ahora - t0) / duracion, 1) : 1;
      const v = Math.round(inicio + (destino - inicio) * (1 - Math.pow(1 - p, 3)));
      actual.current = v;
      setValor(v);
      if (p < 1) frame = requestAnimationFrame(paso);
    };
    frame = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(frame);
  }, [destino]);

  return valor;
}

// ===== Componentes =====

function Interruptor({ nombre, etiqueta, activo, onCambio }) {
  return html`
    <label className="interruptor">
      <input type="checkbox" name=${nombre} checked=${activo} onChange=${(e) => onCambio(e.target.checked)} />
      <span className="interruptor__pista"><i></i></span>
      <span>${etiqueta}</span>
    </label>`;
}

function Formulario({ datos, cambiar }) {
  const progreso = ((datos.paginas - 1) / 19) * 100;
  return html`
    <form className="formulario cristal" onSubmit=${(e) => e.preventDefault()} noValidate>
      <fieldset>
        <legend>Tipo de web</legend>
        <div className="segmentado" role="radiogroup">
          ${["landing", "corporativa"].map((tipo) => html`
            <label key=${tipo}>
              <input type="radio" name="tipo" value=${tipo} checked=${datos.tipo === tipo} onChange=${() => cambiar({ tipo })} />
              <span>${tipo === "landing" ? "Landing" : "Corporativa"}</span>
            </label>`)}
          <i className="segmentado__pastilla" aria-hidden="true"></i>
        </div>
      </fieldset>

      <fieldset>
        <legend>Páginas <output htmlFor="paginas">${datos.paginas}</output></legend>
        <input
          type="range" id="paginas" name="paginas" min="1" max="20"
          className="deslizador"
          value=${datos.paginas}
          style=${{ "--progreso": `${progreso}%` }}
          onChange=${(e) => cambiar({ paginas: Number(e.target.value) })}
        />
        <div className="deslizador__marcas"><span>1</span><span>10</span><span>20</span></div>
      </fieldset>

      <fieldset className="extras">
        <legend>Extras</legend>
        <${Interruptor} nombre="formulario" etiqueta="Formulario de contacto" activo=${datos.formulario} onCambio=${(v) => cambiar({ formulario: v })} />
        <${Interruptor} nombre="segundoIdioma" etiqueta="Segundo idioma" activo=${datos.segundoIdioma} onCambio=${(v) => cambiar({ segundoIdioma: v })} />
      </fieldset>
    </form>`;
}

function Resultado({ datos, resultado, error, cargando }) {
  const moneda = resultado?.moneda ?? "EUR";
  const total = useContador(resultado?.total);
  const extra = datos.paginas - 1;
  const filas = resultado
    ? [
        [`Base · ${datos.tipo === "landing" ? "Landing" : "Corporativa"}`, resultado.base],
        [`Páginas adicionales${extra ? ` (${extra})` : ""}`, resultado.paginasAdicionales],
        ["Formulario de contacto", resultado.formulario],
        ["Segundo idioma", resultado.segundoIdioma]
      ]
    : [];

  return html`
    <aside className=${"resultado cristal cristal--liquido-suave borde-vivo" + (cargando ? " cargando" : "")} aria-live="polite">
      <span className="resultado__titulo">Total estimado</span>
      <strong className="resultado__total">${resultado ? formatear(total, moneda) : "—"}</strong>

      <ul className="desglose">
        ${filas.map(([texto, valor]) => html`
          <li key=${texto} className=${valor ? "" : "cero"}><span>${texto}</span><b>${formatear(valor, moneda)}</b></li>`)}
      </ul>

      ${error && html`
        <div className="aviso">
          ${error.error === "sin-conexion"
            ? html`No se puede conectar con la API. Arranca el servidor con <code>npm start</code> y abre <code>http://localhost:4000</code>.`
            : html`<b>${error.error}</b><ul>${(error.detalles || []).map((d) => html`<li key=${d}>${d}</li>`)}</ul>`}
        </div>`}

      <details className="peticion">
        <summary>Ver la petición JSON</summary>
        <pre className="codigo codigo--pequeno"><code>${JSON.stringify(datos, null, 2)}</code></pre>
      </details>
    </aside>`;
}

// — Ejemplos de web para la vista previa —

function Idioma({ visible }) {
  return visible ? html`<span className="s-idioma activo" data-extra="segundoIdioma"><b>ES</b> · EN</span>` : null;
}

function SitioLanding({ activo, datos }) {
  return html`
    <div className=${"sitio sitio--landing" + (activo ? " activo" : "")} aria-label="Ejemplo de landing" aria-hidden=${!activo}>
      <div className="s-nav">
        <span className="s-logo"><i></i>Órbita</span>
        <span className="s-nav__der">
          <${Idioma} visible=${datos.segundoIdioma} />
          <span className="s-btn s-btn--peq">Descargar</span>
        </span>
      </div>
      <div className="s-hero">
        <div className="s-hero__texto">
          <span className="s-pastilla">✦ Nuevo · versión 2.0</span>
          <strong className="s-titulo">Construye hábitos que sí duran.</strong>
          <p>La app que convierte tus metas en pequeñas rutinas diarias.</p>
          <div className="s-botones">
            <span className="s-btn">Empieza gratis</span>
            <span className="s-btn s-btn--linea">Ver demo</span>
          </div>
        </div>
        <div className="s-movil">
          <span className="s-movil__anillo"></span>
          <i></i><i></i><i></i>
        </div>
      </div>
      <div className="s-ventajas">
        <div><b>◎</b><span>Recordatorios</span></div>
        <div><b>▲</b><span>Progreso</span></div>
        <div><b>✦</b><span>Rachas</span></div>
      </div>
      ${datos.formulario && html`
        <div className="s-form activo" data-extra="formulario">
          <strong>¿Hablamos?</strong>
          <span className="s-input">Tu email</span>
          <span className="s-btn">Enviar</span>
        </div>`}
      <div className="s-pie">© Órbita · Todo en una sola página</div>
    </div>`;
}

function SitioCorporativa({ activo, datos }) {
  const visibles = Math.min(datos.paginas, 4);
  return html`
    <div className=${"sitio sitio--corporativa" + (activo ? " activo" : "")} aria-label="Ejemplo de web corporativa" aria-hidden=${!activo}>
      <div className="s-nav">
        <span className="s-logo"><i></i>Vértice</span>
        <span className="s-menu">
          ${NOMBRES_PAGINAS.slice(0, visibles).map((n) => html`<span key=${n} className="nuevo">${n}</span>`)}
          ${datos.paginas > visibles && html`<span className="s-menu__mas">+${datos.paginas - visibles}</span>`}
        </span>
        <${Idioma} visible=${datos.segundoIdioma} />
      </div>
      <div className="s-hero">
        <div className="s-hero__texto">
          <span className="s-antetitulo">Consultoría estratégica</span>
          <strong className="s-titulo">Impulsamos empresas que miran al futuro.</strong>
          <p>Más de 20 años ayudando a crecer a compañías de todo el país.</p>
          <span className="s-btn">Conócenos</span>
        </div>
        <div className="s-imagen"><span></span><span></span></div>
      </div>
      <div className="s-logos"><span>Confían en nosotros</span><i></i><i></i><i></i><i></i><i></i></div>
      <div className="s-servicios">
        ${["Estrategia", "Finanzas", "Personas"].map((s, i) => html`
          <div key=${s}><b>0${i + 1}</b><strong>${s}</strong><i></i><i></i></div>`)}
      </div>
      ${datos.formulario && html`
        <div className="s-form activo" data-extra="formulario">
          <strong>Contacta con nosotros</strong>
          <span className="s-input">Nombre</span>
          <span className="s-input">Email</span>
          <span className="s-btn">Enviar</span>
        </div>`}
      <div className="s-pie"><span>Vértice Consultores</span><span>Aviso legal · Privacidad</span></div>
    </div>`;
}

function VistaPrevia({ datos }) {
  // La línea de escaneo solo se anima a partir del primer cambio de tipo (no al cargar).
  // Lleva key=tipo: al cambiar, React crea una línea nueva y la animación vuelve a empezar.
  const tipoInicial = useRef(datos.tipo);
  const yaCambio = useRef(false);
  if (datos.tipo !== tipoInicial.current) yaCambio.current = true;
  const haCambiado = yaCambio.current;

  const dominio = (datos.tipo === "landing" ? "orbita.app" : "vertice.es") + (datos.segundoIdioma ? "/es" : "");
  const paginas = `${datos.paginas} ${datos.paginas === 1 ? "página" : "páginas"}`;

  return html`
    <div className="vista cristal borde-vivo">
      <div className="vista__cabecera">
        <span className="vista__etiqueta"><i></i> Vista previa</span>
        <span className="vista__tipo">${datos.tipo === "landing" ? "Landing" : "Corporativa"} · ${paginas}</span>
      </div>

      <div className="navegador">
        <div className="navegador__barra">
          <span className="navegador__puntos"><i></i><i></i><i></i></span>
          <span className="navegador__url"><b>🔒</b> ${dominio}</span>
        </div>
        <div className=${"navegador__pantalla" + (haCambiado ? " escaneando" : "")}>
          <span key=${datos.tipo} className="escaner" aria-hidden="true"></span>
          <${SitioLanding} activo=${datos.tipo === "landing"} datos=${datos} />
          <${SitioCorporativa} activo=${datos.tipo === "corporativa"} datos=${datos} />
        </div>
      </div>

      <div className="mapa">
        <span className="mapa__titulo">Mapa del sitio</span>
        <div className="mapa__paginas">
          ${NOMBRES_PAGINAS.slice(0, datos.paginas).map((n, i) => html`
            <span key=${n} className="nueva">/${i === 0 ? "" : n.toLowerCase()}</span>`)}
        </div>
      </div>
    </div>`;
}

function Calculadora() {
  const [datos, setDatos] = useState({ tipo: "landing", paginas: 1, formulario: false, segundoIdioma: false });
  const { resultado, error, cargando } = usePresupuesto(datos);
  const cambiar = (cambio) => setDatos((d) => ({ ...d, ...cambio }));

  return html`
    <div className="calculadora">
      <div className="calculadora__controles">
        <${Formulario} datos=${datos} cambiar=${cambiar} />
        <${Resultado} datos=${datos} resultado=${resultado} error=${error} cargando=${cargando} />
      </div>
      <${VistaPrevia} datos=${datos} />
    </div>`;
}

ReactDOM.createRoot(document.getElementById("app-calculadora")).render(html`<${Calculadora} />`);
