# Presupuesta mi web

API REST hecha con **Node.js** y **Express** que calcula presupuestos de proyectos web.

El servidor usa siempre **sus propias tarifas**: nunca acepta precios ni totales enviados por el cliente.

Módulo 0613 · Desarrollo web en entorno servidor.

---

## Requisitos

- **Node.js 18 o superior** (compruébalo con `node --version`)
- **npm** (viene con Node.js)

## Instalación

```bash
git clone https://github.com/aldringcorcho/presupuesta-mi-web.git
cd presupuesta-mi-web
npm install
```

`npm install` lee el archivo `package.json` e instala Express. La carpeta `node_modules` no se incluye en el repositorio.

## Ejecución

```bash
npm start
```

El servidor se abre en el **puerto 4000**:

```
http://localhost:4000
```

Si el puerto 4000 está ocupado, se puede usar otro (en Windows PowerShell):

```powershell
$env:PORT=5000; npm start
```

---

## Rutas

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/estado` | Comprueba que el servicio funciona |
| GET | `/api/tarifas` | Devuelve las tarifas que usa el servidor |
| POST | `/api/presupuesto` | Recibe las características de la web y devuelve el presupuesto |

### GET /api/estado

Respuesta:

```json
{ "status": "ok" }
```

### GET /api/tarifas

Devuelve cada tarifa con su descripción y su precio.

### POST /api/presupuesto

Cabecera obligatoria: `Content-Type: application/json`

Cuerpo de la petición (los 4 campos son obligatorios):

```json
{ "tipo": "corporativa", "paginas": 4, "formulario": true, "segundoIdioma": false }
```

| Campo | Tipo | Valores válidos |
|---|---|---|
| `tipo` | texto | `"landing"` o `"corporativa"` |
| `paginas` | número entero | de 1 a 20 |
| `formulario` | booleano | `true` o `false` |
| `segundoIdioma` | booleano | `true` o `false` |

Las propiedades adicionales se ignoran (por ejemplo, si se envía `"total": 1`, no se tiene en cuenta).

**Respuesta correcta (200):**

```json
{ "base": 600, "paginasAdicionales": 150, "formulario": 80, "segundoIdioma": 0, "total": 830, "moneda": "EUR" }
```

**Respuesta con datos incorrectos (400):**

```json
{ "error": "Solicitud incorrecta", "detalles": ["\"paginas\" debe ser un número entero entre 1 y 20 (recibido: 0)."] }
```

---

## Tarifas

| Concepto | Precio |
|---|---|
| Landing, incluida la primera página | 300 € |
| Web corporativa, incluida la primera página | 600 € |
| Cada página adicional a la primera | 50 € |
| Formulario de contacto | 80 € |
| Segundo idioma | 150 € |

**Total = precio base + (páginas − 1) × 50 € + extras seleccionados.** Sin impuestos ni descuentos.

---

## Estructura del proyecto

```
presupuesta-mi-web/
├── server.js          → servidor Express: rutas y puerto
├── src/
│   ├── tarifas.js     → precios del servidor
│   ├── validar.js     → comprueba los datos antes de calcular
│   └── calcular.js    → función de cálculo (separada de Express)
├── pruebas/
│   └── pruebas.js     → lanza todas las pruebas automáticamente
├── package.json
└── README.md
```

---

## Pruebas

Con el servidor encendido (`npm start`), abre **otra terminal** y ejecuta:

```bash
npm test
```

El script comprueba las tres rutas y todos los casos de la tabla.

### Tabla de pruebas

En los casos incorrectos, el resto de campos son los del caso 2 (correctos), para comprobar cada error por separado.

| Caso | Solicitud enviada | Resultado esperado | Resultado obtenido |
|---|---|---|---|
| — | `GET /api/estado` | 200 · `{"status":"ok"}` | 200 · `{"status":"ok"}` ✅ |
| — | `GET /api/tarifas` | 200 · tarifas | 200 · las 5 tarifas ✅ |
| 1 | `{"tipo":"landing","paginas":1,"formulario":false,"segundoIdioma":false}` | 200 · 300 € | 200 · 300 € ✅ |
| 2 | `{"tipo":"corporativa","paginas":4,"formulario":true,"segundoIdioma":false}` | 200 · 830 € | 200 · 830 € ✅ |
| 3 | `{"tipo":"landing","paginas":2,"formulario":true,"segundoIdioma":true}` | 200 · 580 € | 200 · 580 € ✅ |
| 4 | `{"tipo":"landing","paginas":20,"formulario":false,"segundoIdioma":false}` | 200 · 1.250 € | 200 · 1.250 € ✅ |
| 5 | `{"tipo":"corporativa","paginas":0,"formulario":true,"segundoIdioma":false}` | 400 | 400 · "paginas" debe ser un número entero entre 1 y 20 ✅ |
| 6 | `{"tipo":"corporativa","paginas":21,"formulario":true,"segundoIdioma":false}` | 400 | 400 · "paginas" debe ser un número entero entre 1 y 20 ✅ |
| 7 | `{"tipo":"corporativa","paginas":2.5,"formulario":true,"segundoIdioma":false}` | 400 | 400 · "paginas" debe ser un número entero entre 1 y 20 ✅ |
| 8 | `{"tipo":"tienda","paginas":4,"formulario":true,"segundoIdioma":false}` | 400 | 400 · "tipo" debe ser "landing" o "corporativa" ✅ |
| 9 | `{"tipo":"corporativa","paginas":4,"formulario":"false","segundoIdioma":false}` | 400 | 400 · "formulario" debe ser true o false ✅ |
| 10 | Caso 2 + `"total":1,"base":0` | 200 · 830 € | 200 · 830 € (se ignoran) ✅ |
| 11 | Caso 2 con `"paginas":"4"` (texto) | 400 | 400 · "paginas" debe ser un número entero ✅ |

También se puede probar a mano con **Thunder Client** o **Postman**: método **POST**, dirección `http://localhost:4000/api/presupuesto`, Body en formato **JSON**.