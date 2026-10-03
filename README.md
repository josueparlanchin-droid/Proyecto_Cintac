# Cotizador Logístico de Importaciones Comex — Cintac S.A.

MVP académico (INACAP) de un cotizador de fletes marítimos de importación.
Calcula costo landed ( merchandise + flete + seguro + IVA) a partir de
tarifas por ruta, guarda historial con aislamiento por rol y exporta el
informe a PDF.

- **Frontend:** React 19 + Vite 8 + CSS puro (sin framework de estilos)
- **Backend:** Node.js + Express 5
- **Base de datos:** PostgreSQL en Neon, con el driver oficial `pg`
- **Autenticación:** JWT + bcrypt
- **Extras:** carga de tarifas `.xlsx`/`.xls`/`.csv`, PDF con jsPDF

> **Por qué PostgreSQL y ya no SQLite.** El MVP usaba `node:sqlite` para no
> depender de instalar un motor de datos. Al desplegar en Render, el disco es
> efímero: cada redeploy borraba la base y con ella el historial. PostgreSQL
> alojado en Neon resuelve eso y además es el motor que se evalúa en la
> carrera. La migración está completa: el modelo de datos (4 tablas), la lógica
> de cálculo y los endpoints no cambiaron.

---

## Requisitos

- **Node.js >= 22.5.0** (usa `WebSocket` nativo en la suite de verificación)
- **Una base PostgreSQL accesible.** Para desarrollo local basta con Neon
  (plan gratuito); también sirve PostgreSQL local o el de Render.

Verifica tu versión:

```bash
node -v
```

## Instalación

Desde la raíz del proyecto:

```bash
npm run install:all
```

Esto instala las dependencias de la raíz, del backend y del frontend.

## Puesta en marcha

```bash
npm run seed
npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:4010/api/v1/health>

`npm run dev` levanta ambos servidores a la vez. El frontend hace proxy de
`/api` hacia el backend, así que en el navegador solo necesitas el puerto 5173.

### Credenciales de demostración

| Rol | Correo | Contraseña | Permisos |
| --- | --- | --- | --- |
| Jefatura Comex | `jefe@cintac.cl` | `Jefatura2026` | Ve todas las cotizaciones, elimina y carga tarifas |
| Analista Comex | `analista@cintac.cl` | `Analista2026` | Ve solo sus propias cotizaciones |

Ambas cuentas se pueden elegir con los botones de rol en la pantalla de login.

## Variables de entorno

El backend funciona sin configuración: todos los valores tienen un valor por
defecto para desarrollo local y avisa por consola cuando usa un valor inseguro.

Para personalizarlo, copia el archivo de ejemplo:

```bash
cp backend/.env.example backend/.env      # macOS / Linux
copy backend\.env.example backend\.env   # Windows
```

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `4010` | Puerto de la API |
| `DATABASE_URL` | *(local)* | **Obligatoria en producción.** Cadena de conexión a PostgreSQL |
| `JWT_SECRET` | *(desarrollo)* | **Obligatoria en producción.** Proceso se detiene si falta |
| `JWT_EXPIRES_IN` | `8h` | Duración de la sesión |
| `CORS_ORIGIN` | `http://localhost:5173` | Orígenes permitidos, separados por coma |
| `RATE_LIMIT_MAX` | `300` | Peticiones por ventana de 15 min |
| `AUTH_RATE_LIMIT_MAX` | `20` | Intentos de login fallidos por 15 min |
| `UPLOAD_MAX_MB` | `5` | Tamaño máximo de la planilla |

### Conectar la base de datos

1. Crea una base en [Neon](https://neon.tech) (plan gratuito) y copia la
   cadena de conexión. Usa la que termina en **`-pooler`**: enruta por PgBouncer
   y aguanta las conexiones concurrentes de la aplicación.
2. Pégala en `backend/.env`:

   ```
   DATABASE_URL=postgresql://usuario:clave@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=verify-full
   ```

   `sslmode=verify-full` es deliberado: `pg` trata `require` como alias de
   `verify-full` y avisa por consola, y el certificado de Neon lo emite una CA
   pública, así que se puede validar la cadena completa sin relajar nada.
3. Comprueba la conexión **antes** de sembrar:

   ```bash
   cd backend
   npm run db:check      # versión, tablas y cantidad de registros
   npm run seed          # crea el esquema y carga los datos iniciales
   ```

> **Importante:** si el puerto 4000 está ocupado en tu equipo, el proyecto ya
> usa el 4010 por defecto. Si cambias `PORT`, actualiza también el proxy en
> `frontend/vite.config.js`.

## Fórmulas de cálculo

El motor está en `backend/src/services/calculoService.js` y es la única fuente
de verdad: la UI y la prueba de API usan el mismo servicio.

1. **Toneladas:** `tn = peso_kg / 1000`
2. **Contenedores:** `ceil(tn / capacidad_max_tn)` con mínimo 1
3. **Flete:** `contenedores × precio_usd` de la tarifa de la ruta
4. **Seguro:** `valor_mercaderia_usd × 0.01`
5. **CIF:** `mercancía + flete + seguro`
6. **Impuesto (IVA 19%):** `CIF × 0.19`
7. **Total:** `flete + impuesto`
8. **Tránsito:** `días base de la tarifa + días de contingencia`

Un contenedor de 40 pies equivale a **25 tn** en el cálculo; el de 20 pies, a
**20 tn**. La interfaz muestra la cantidad de tn y los contenedores necesarios
en vivo, mientras el usuario escribe.

## Estructura del proyecto

```
.
├── backend/
│   ├── src/
│   │   ├── config/          variables de entorno y pool de PostgreSQL
│   │   ├── db/              esquema PostgreSQL y seed
│   │   ├── middleware/      autenticación, RBAC, errores, validación, rate limit
│   │   ├── models/          acceso a datos con SQL parametrizado
│   │   ├── routes/          definición de endpoints
│   │   ├── services/        motor de cálculo e importación de tarifas
│   │   ├── app.js           ensamblado de Express
│   │   └── server.js        arranque y cierre ordenado
│   └── scripts/             verificación de API, conexión y reset de la base
├── frontend/
│   ├── public/              plantilla de tarifas de ejemplo
│   ├── scripts/             verificación en navegador real (Chrome headless)
│   └── src/
│       ├── api/             cliente HTTP y manejo de sesión
│       ├── components/      componentes de UI reutilizables
│       ├── context/         contexto de autenticación
│       ├── pages/           login, cotizador, historial, tarifas
│       ├── styles/          tokens de diseño y componentes
│       └── utils/           PDF y formateo
└── package.json             scripts de la raíz
```

## Endpoints de la API

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | Público | Inicia sesión |
| `GET` | `/auth/me` | Autenticado | Perfil y permisos |
| `GET` | `/puertos` | Autenticado | Puertos disponibles |
| `POST` | `/cotizaciones/calcular` | Autenticado | Simula una cotización |
| `GET` | `/cotizaciones/historial` | Autenticado | Historial con filtros y paginación |
| `GET` | `/cotizaciones/resumen` | Autenticado | Métricas agregadas |
| `GET` | `/cotizaciones/:id` | Autenticado | Detalle |
| `DELETE` | `/cotizaciones/:id` | Jefatura | Elimina |
| `GET` | `/tarifas` | Autenticado | Listado de tarifas |
| `GET` | `/tarifas/plantilla` | Jefatura | Descarga plantilla CSV |
| `POST` | `/tarifas/upload` | Jefatura | Carga `.xlsx`/`.xls`/`.csv` |
| `GET` | `/health` | Público | Estado del servicio |

## Seguridad implementada

- Contraseñas con hash bcrypt, nunca en texto plano.
- JWT verificado en cada ruta protegida, con expiración de 8 h.
- Control de acceso por rol en el **backend** (ocultar un botón no es
  seguridad: el Analysta recibe 403 aunque llame a la API directamente).
- Aislamiento del historial: un Analista solo recupera sus propias cotizaciones.
- Todas las consultas SQL usan parámetros, sin concatenar entrada del usuario.
- Validación de entrada con Zod en los endpoints que reciben datos.
- Rate limiting con límites distintos para login y para el resto de la API.
- Límite de tamaño y de filas en la carga de tarifas.

## Carga de tarifas

La pantalla **Tarifas** (solo Jefatura) acepta `.xlsx`, `.xls` y `.csv` con
estas columnas:

| Columna | Obligatoria | Ejemplo |
| --- | --- | --- |
| `puerto_origen` | Sí | `CNSHA` |
| `puerto_destino` | Sí | `CLSAI` |
| `precio_usd` | Sí | `2450` |
| `tipo_contenedor` | No | `40HC` |
| `dias_viaje_base` | No | `28` |
| `capacidad_max_tn` | No | `25` |

La importación es **idempotente**: volver a subir la misma ruta actualiza el
precio en vez de duplicar. Las filas inválidas se omiten y se informan al
usuario en lugar de abortar toda la carga. Hay una plantilla descargable en
`frontend/public/plantilla-tarifas.csv`.

## Verificación

Con la aplicación corriendo en otra terminal:

```bash
npm run verificar        # navegador + API, en ese orden
npm run verificar:web    # solo el navegador
npm run verificar:api    # solo la API
```

- `frontend/scripts/verificar-frontend.js` maneja Chrome Headless por el
  protocolo DevTools y comprueba 31 casos reales de interfaz: montaje, login,
  conversión kg→tn en vivo, cálculo, PDF, historial, permisos del Analista,
  persistencia de sesión y ausencia de errores en consola.
- `backend/scripts/verificar-api.js` recorre los endpoints de extremo a extremo y
  comprueba 72 casos, incluidos los límites de 25 tn, el aislamiento por rol y
  el rate limiting.

> El orden importa: la prueba de la API es la última a propósito, porque agota
> el cupo de 20 intentos de login para comprobar el bloqueo. Si la ejecutas por
> separado, **reinicia el backend** antes de volver a iniciar sesión desde el
> navegador: los contadores viven en memoria.

`npm run build` genera el bundle de producción en `frontend/dist`.

### Restablecer los datos de demostración

Las pruebas modifican datos reales: acumulan cotizaciones y cambian precios. Para
volver al estado inicial, detén el backend y ejecuta:

```bash
npm run reset
```

Esto **borra todas las tablas** de la base a la que apunte `DATABASE_URL` y
vuelve a cargar usuarios, puertos, tarifas y las 13 cotizaciones de ejemplo.

- A diferencia de SQLite, aquí no hace falta detener el backend para borrar:
  PostgreSQL opera con la base en línea. Aun así se recomienda, para no tener
  peticiones a medio camino.
- Por seguridad, el script **se niega a correr** si el nombre de la base no está
  en su lista de conocidos. Para forzar el borrado: `node scripts/reset-db.js --si`.

## Solución de problemas

**`Puerto 4000/4010 ya en uso`**
Ya existe otra aplicación en tu equipo. Cambia `PORT` en `backend/.env` y
actualiza el proxy de destino en `frontend/vite.config.js`.

**`ECONNREFUSED` o `FATAL: database ... does not exist`**
La cadena de `DATABASE_URL` no apunta a ninguna base. Comprueba la conexión con
`npm run db:check` desde `backend/`, que informa versión, tablas y registros
sin modificar nada.

**`no pg_hba.conf entry ... SSL off`**
Falta el parámetro SSL. En Neon y Render hay que usar `?sslmode=verify-full`.

**`El login responde 429`**
Se alcanzaron 20 intentos **fallidos** en 15 minutos. El bloqueo es por cuenta, no
por IP: un login correcto nunca lo agota, y los correos inexistentes se cuentan
por IP para frenar los ataques que prueban miles de cuentas. Si te bloquea a ti,
reinicia el backend para vaciar los contadores en memoria, o espera la ventana.

**`El frontend carga pero no hay datos`**
Comprueba que el backend esté arriba en `/api/v1/health` (ahora consulta la base
de verdad y devuelve 503 si no responde) y que `CORS_ORIGIN` incluya el origen
del frontend.

## Despliegue

La aplicación se publica en dos servicios, porque el frontend es estático y el
backend necesita un proceso Node y la base.

### 1. Base de datos (Neon)

Crea el proyecto en [neon.tech](https://neon.tech) y copia la cadena de conexión
**`-pooler`**. Es la base real: no lo.created Render, que además es redundante.

### 2. Backend en Render

- **Runtime:** Node
- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Health Check Path:** `/api/v1/health`

Variables de entorno:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | La cadena `-pooler` de Neon, con `?sslmode=verify-full` |
| `JWT_SECRET` | Una propia, generada con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | Los dominios de Vercel separados por coma, por ejemplo `https://cintac.vercel.app,https://cintac-abc123-usuario.vercel.app` |
| `PORT` | Lo asigna Render; no lo fijes |

El proceso se detiene al arrancar si falta `DATABASE_URL` o si `JWT_SECRET` sigue
siendo el de desarrollo, para que el fallo sea visible en el log del despliegue
y no un `500` en cada petición.

La primera vez, carga los datos desde tu máquina (el seed corre contra la misma
base, no necesitas una segunda base):

```bash
cd backend && npm run seed
```

### 3. Frontend en Vercel

- **Framework Preset:** Vite
- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

Variable de entorno:

| Variable | Valor |
| --- | --- |
| `VITE_API_URL` | `https://tu-backend.onrender.com/api/v1` |

La variable es obligatoria, no opcional: `frontend/src/api/client.js` resuelve la
URL base desde `VITE_API_URL` y cae en `/api/v1` solo si no está definida.

```js
const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');
```

En desarrollo esa ruta relativa la resuelve el proxy de Vite contra
`localhost:4010`. En producción **no hay proxy**, así que `/api/v1` consultaría al
propio dominio de Vercel, que solo sirve archivos estáticos: respondería con el
`index.html` de la SPA y el login fallaría al leer ese HTML como JSON. Vite
incrusta el valor en el bundle al compilar, por eso hay que definirlo en el
panel de Vercel para **Production y Preview** antes de cada despliegue.

Dos síntomas sirven para diagnosticar:

| Síntoma | Causa |
| --- | --- |
| Login responde `404` | `VITE_API_URL` sin definir, o mal definida |
| Login responde `200` con `text/html` | La petición cayó en Vercel, no en la API |

Para comprobar el valor real que quedó incrustado, tras compilar:

```bash
cd frontend
VITE_API_URL=https://tu-backend.onrender.com/api/v1 npm run build
grep -ro "onrender.com" dist/assets | head
```

### Rutas internas de la SPA

La app usa rutas del navegador (`/login`, `/cotizaciones`, ...), pero un build de
Vite genera archivos estáticos y no existe un archivo llamado `login`. Por eso
`frontend/vercel.json` declara una reescritura de respaldo:

```json
{ "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }] }
```

Vercel la aplica **solo cuando ninguna ruta coincide con un archivo del build**,
de modo que los assets siguen serviéndose normalmente. La exclusión de `api/` es
deliberada: deja que `/api/*` siga devolviendo `404` en lugar de un `200` con
HTML, que es mucho más difícil de interpretar al diagnosticar.

Sin este archivo, entrar directo a `/login` o refrescar en una ruta interna
devuelve la página `404` de Vercel.

Cuando cambies la URL de Vercel, vuelve a guardarla en `CORS_ORIGIN` del backend:
CORS usa `credentials: true`, por lo que no admite `*`.

## Base de datos

PostgreSQL, alojado en Neon. El esquema vive en un solo archivo,
`backend/src/db/schema.sql`: no hay variantes que mantener sincronizadas, que
era justo el riesgo del enfoque SQLite + PostgreSQL en paralelo.

El esquema se crea solo en el primer arranque (`CREATE TABLE IF NOT EXISTS`) y
se puebla con `npm run seed`, que es idempotente.

Cuatro tablas:

| Tabla | Contenido |
| --- | --- |
| `usuarios` | Cuentas con rol (`ADMIN_COMEX` o `ANALISTA`) y hash bcrypt |
| `puertos` | Puertos disponibles |
| `tarifas_flete` | Precio, tránsito y contingencia por puerto de origen/destino |
| `cotizaciones_log` | Historial de cotizaciones con su desglose completo |

Decisiones de diseño relevantes para PostgreSQL:

- **`NUMERIC` e `int8` se convierten a `Number`** al leer. PostgreSQL los entrega
  como texto para no perder precisión; la app necesita aritmética normal, y los
  valores son magnitudes que caben holgadamente en un `Number` de JavaScript. La
  precisión exacta se conserva en la base.
- **Las búsquedas usan `ILIKE`.** En PostgreSQL `LIKE` distingue mayúsculas, a
  diferencia de SQLite, así que un filtro por "shanghai" habría dejado de
  encontrar "Shanghai" sin avisar.
- **Las escrituras usan `RETURNING`.** Evita el `SELECT` de verificación que
  hacía falta antes para obtener el id insertado.
- **La importación de tarifas es una transacción.** Si una fila de la planilla
  falla, no queda ni la mitad de la carga ni las tarifas anteriores modificadas.
- **El pool es de 10 conexiones** (`max: 10`), acorde al plan gratuito de Neon y
  al único proceso Node que levanta Render.

Para construir el esquema manualmente o crear una base vacía:

```bash
psql "$DATABASE_URL" -f backend/src/db/schema.sql
```

## Licencia

Proyecto académico. Datos de demostración ficticios, solo para fines
educativos.
