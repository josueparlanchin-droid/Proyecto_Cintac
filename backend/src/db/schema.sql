/**
 * db/schema.sql
 * -----------------------------------------------------------------
 * Esquema de la base de datos (PostgreSQL).
 *
 * Convencion de nombres: snake_case en tablas y columnas, FKs explicitas.
 *
 * El motor es PostgreSQL desde la migracion a Neon: se eliminaron los
 * `PRAGMA`, el `AUTOINCREMENT` y las fechas como TEXT.
 *
 * Diferencias de tipo frente a la version SQLite que usaba el MVP:
 *   SERIAL     en vez de INTEGER PRIMARY KEY AUTOINCREMENT
 *   TIMESTAMPTZ en vez de TEXT con datetime('now')
 *   BOOLEAN    en vez de INTEGER 0/1
 *   NUMERIC    en vez de REAL (dinero: evita errores de coma flotante)
 *
 * Sobre NUMERIC: Postgres devuelve los numeric como texto para no perder
 * precision. El driver los convierte a Number en config/db.js, porque el
 * motor de calculo necesita operar aritmeticamente con ellos.
 */

-- ------------------------------------------------------------------
-- usuarios: credenciales de acceso y rol del analista
--   rol = 'ADMIN_COMEX' -> Jefatura Comex (acceso total)
--   rol = 'ANALISTA'    -> Analista Comex (opera, no elimina)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(160) NOT NULL,
  email       VARCHAR(160) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,       -- hash bcrypt, NUNCA en texto plano
  rol         VARCHAR(20)  NOT NULL DEFAULT 'ANALISTA'
             CHECK (rol IN ('ADMIN_COMEX', 'ANALISTA')),
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- UNIQUE ya crea indice sobre email; este indice propio es redundante.
-- Se conserva como indice explicito unicamente si mas adelante se busca
-- por una expresion, por ejemplo LOWER(email). Ver README (PostgreSQL).

-- ------------------------------------------------------------------
-- puertos: catalogo unico de origen internacional y destino en Chile.
--   region CHINA | EUROPA | AMERICA -> solo origen
--   region CHILE                    -> solo destino
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puertos (
  id           SERIAL PRIMARY KEY,
  nombre       VARCHAR(160) NOT NULL,
  pais_origen  VARCHAR(80)  NOT NULL,
  region       VARCHAR(20)  NOT NULL
               CHECK (region IN ('CHINA', 'EUROPA', 'AMERICA', 'CHILE')),
  codigo       VARCHAR(12)  NOT NULL UNIQUE   -- ejemplo: CNSHA
);

CREATE INDEX IF NOT EXISTS idx_puertos_region ON puertos (region);

-- ------------------------------------------------------------------
-- tarifas_flete: precio por ruta y tipo de contenedor.
--   capacidad_max_tn proviene de la DATA, no de un numero magico en el
--   codigo: por eso el limite de 25 tn es auditable y configurable.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tarifas_flete (
  id                  SERIAL PRIMARY KEY,
  puerto_origen_id    INTEGER      NOT NULL REFERENCES puertos (id) ON DELETE CASCADE,
  puerto_destino_id   INTEGER      NOT NULL REFERENCES puertos (id) ON DELETE CASCADE,
  tipo_contenedor     VARCHAR(8)   NOT NULL DEFAULT '40HC'
                      CHECK (tipo_contenedor IN ('20', '40', '40HC', '40RF')),
  precio_usd          NUMERIC(12,2) NOT NULL CHECK (precio_usd > 0),
  dias_viaje_base     INTEGER      NOT NULL CHECK (dias_viaje_base > 0),
  capacidad_max_tn    NUMERIC(6,2)  NOT NULL DEFAULT 25 CHECK (capacidad_max_tn > 0),
  actualizado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (puerto_origen_id, puerto_destino_id, tipo_contenedor)
);

CREATE INDEX IF NOT EXISTS idx_tarifas_ruta
  ON tarifas_flete (puerto_origen_id, puerto_destino_id);

-- ------------------------------------------------------------------
-- cotizaciones_log: bitacora inmutable de cada simulacion realizada.
-- Se guardan los factores del calculo (no solo el resultado) para que
-- el informe pueda reconstruirse y auditarse meses despues.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizaciones_log (
  id                       SERIAL PRIMARY KEY,
  usuario_id               INTEGER      NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,

  -- Datos de la carga
  peso_kg                  NUMERIC(14,3) NOT NULL CHECK (peso_kg > 0),
  toneladas                NUMERIC(14,3) NOT NULL CHECK (toneladas > 0),
  cantidad_contenedores    INTEGER      NOT NULL CHECK (cantidad_contenedores > 0),

  -- Ruta
  puerto_origen_id         INTEGER      NOT NULL REFERENCES puertos (id) ON DELETE RESTRICT,
  puerto_destino_id        INTEGER      NOT NULL REFERENCES puertos (id) ON DELETE RESTRICT,
  tipo_contenedor          VARCHAR(8)   NOT NULL DEFAULT '40HC',
  dias_viaje_base          INTEGER      NOT NULL,

  -- Factores del calculo
  valor_mercaderia_usd     NUMERIC(14,2) NOT NULL CHECK (valor_mercaderia_usd > 0),
  capacidad_max_tn         NUMERIC(6,2)  NOT NULL,
  precio_contenedor_usd    NUMERIC(12,2) NOT NULL,
  dias_contingencia        INTEGER      NOT NULL DEFAULT 0 CHECK (dias_contingencia >= 0),

  -- Resultados
  costo_flete_usd          NUMERIC(14,2) NOT NULL,
  seguro_usd               NUMERIC(14,2) NOT NULL,
  valor_cif_usd            NUMERIC(14,2) NOT NULL,
  impuesto_19_cif_usd      NUMERIC(14,2) NOT NULL,
  costo_total_usd          NUMERIC(14,2) NOT NULL,
  dias_transito            INTEGER      NOT NULL,

  fecha_creacion           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_usuario  ON cotizaciones_log (usuario_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha    ON cotizaciones_log (fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_origen   ON cotizaciones_log (puerto_origen_id);

-- ------------------------------------------------------------------
-- usuarios_auditoria: bitacora de las acciones de administracion.
--   Sin esta tabla, un cambio de rol o una baja son indistinguibles de
--   una carga directa de base de datos. Es lo que permite reconstruir
--   "quien dejo a este analista sin acceso y cuando".
--
--   Se guarda `administrador_email` ADEMAS del id: si esa cuenta se
--   elimina o se degrada, el registro historico sigue siendo legible.
--
--   ON DELETE CASCADE sobre el objetivo porque el usuario puede ser
--   borrado en el futuro y no queremos huerfanos. ON DELETE SET NULL
--   sobre el responsable para no perder trazabilidad cuando el propio
--   administrador desaparece.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios_auditoria (
  id                  SERIAL PRIMARY KEY,
  usuario_objetivo_id INTEGER      NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  administrador_id    INTEGER      REFERENCES usuarios (id) ON DELETE SET NULL,
  administrador_email VARCHAR(160),
  accion              VARCHAR(30)  NOT NULL
                      CHECK (accion IN ('REGISTRO', 'ACTIVAR', 'DESACTIVAR', 'CAMBIAR_ROL')),
  rol_anterior        VARCHAR(20)  CHECK (rol_anterior IS NULL OR rol_anterior IN ('ADMIN_COMEX', 'ANALISTA')),
  rol_nuevo           VARCHAR(20)  CHECK (rol_nuevo    IS NULL OR rol_nuevo    IN ('ADMIN_COMEX', 'ANALISTA')),
  detalle             TEXT,
  creado_en           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_objetivo ON usuarios_auditoria (usuario_objetivo_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha    ON usuarios_auditoria (creado_en DESC);
