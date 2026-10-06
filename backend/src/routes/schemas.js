/**
 * routes/schemas.js
 * -----------------------------------------------------------------
 * Esquemas Zod de entrada, en un solo archivo para que las reglas de
 * validacion se puedan revisar de un vistazo durante la defensa.
 *
 * Aqui es donde se bloquean los casos que menciona el enunciado:
 * pesos negativos, pesos cero y campos vacios.
 */

import { z } from 'zod';
import {
  DIAS_CONTINGENCIA_MAX,
  PESO_MAXIMO_KG,
} from '../utils/constantes.js';

/** Numero positivo finito, sin notacion cientifica ni valores absurdamente grandes. */
const numeroPositivo = (etiqueta, maximo) =>
  z.coerce
    .number({ message: `${etiqueta} debe ser numerico.` })
    .positive(`${etiqueta} debe ser mayor que cero.`)
    .finite(`${etiqueta} debe ser un numero valido.`)
    .refine((n) => n <= maximo, `${etiqueta} no puede superar ${maximo}.`);

/** IDs de base de datos: enteros positivos. */
const idPositivo = z.coerce
  .number({ message: 'Identificador invalido.' })
  .int('El identificador debe ser un numero entero.')
  .positive('El identificador debe ser mayor que cero.');

// ------------------------------------------------------------------
// POST /api/v1/auth/login
// ------------------------------------------------------------------
export const esquemaLogin = z
  .object({
    email: z
      .string({ message: 'El correo es obligatorio.' })
      .trim()
      .min(1, 'El correo es obligatorio.')
      .email('El formato del correo no es valido.')
      .max(160, 'El correo es demasiado largo.'),
    password: z
      .string({ message: 'La contrasena es obligatoria.' })
      .min(1, 'La contrasena es obligatoria.')
      .max(128, 'La contrasena es demasiado larga.'),
  })
  .strict('Campos no esperados en la solicitud.');

// ------------------------------------------------------------------
// POST /api/v1/cotizaciones/calcular
// ------------------------------------------------------------------
export const esquemaCalculo = z
  .object({
    peso_kg: numeroPositivo('El peso', PESO_MAXIMO_KG),

    valor_mercaderia_usd: numeroPositivo('El valor de la mercaderia', 500_000_000),

    puerto_origen_id: idPositivo,
    puerto_destino_id: idPositivo,

    dias_contingencia: z.coerce
      .number({ message: 'Los dias de contingencia deben ser numericos.' })
      .int('Los dias de contingencia deben ser un numero entero.')
      .min(0, 'Los dias de contingencia no pueden ser negativos.')
      .max(DIAS_CONTINGENCIA_MAX, `Los dias de contingencia no pueden superar ${DIAS_CONTINGENCIA_MAX}.`)
      .default(0),

    tipo_contenedor: z
      .enum(['20', '40', '40HC', '40RF'], {
        message: 'Tipo de contenedor no valido.',
      })
      .default('40HC'),

    /** Si es false, el calculo se devuelve sin persistir (modo simulacion). */
    guardar: z.coerce.boolean().default(true),
  })
  .strict('Campos no esperados en la solicitud.');

// ------------------------------------------------------------------
// GET /api/v1/cotizaciones/historial  (query params)
// ------------------------------------------------------------------
export const esquemaHistorial = z.object({
  puerto_origen_id: idPositivo.optional(),
  puerto_destino_id: idPositivo.optional(),
  busqueda: z.string().trim().max(120).optional(),
  desde: z.iso.date('La fecha de inicio debe tener formato YYYY-MM-DD.').optional(),
  hasta: z.iso.date('La fecha de termino debe tener formato YYYY-MM-DD.').optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(10),
});

// ------------------------------------------------------------------
// GET /api/v1/cotizaciones/:id
// ------------------------------------------------------------------
export const esquemaIdCotizacion = z.object({ id: idPositivo });

// ------------------------------------------------------------------
// GET /api/v1/puertos
// ------------------------------------------------------------------
export const esquemaConsultaPuertos = z.object({
  region: z.enum(['CHINA', 'EUROPA', 'AMERICA', 'CHILE']).optional(),
});

// ------------------------------------------------------------------
// POST /api/v1/auth/registro
// ------------------------------------------------------------------
// Aqui esta la diferencia entre el login y el registro: el login acepta
// cualquier contrasena porque la Definio el administrador, pero una clave
// que elige el usuario en el momento debe medirse con un estandar minimo.
//
// Las cinco reglas salen de una sola expresion regular, para que la lista
// no pueda quedar medio actualizada. Los mensajes van campo a campo porque
// el formulario los pinta debajo del input que fallo.
export const esquemaRegistro = z
  .object({
    nombre: z
      .string({ message: 'El nombre es obligatorio.' })
      .trim()
      .min(1, 'El nombre es obligatorio.')
      .max(160, 'El nombre es demasiado largo.'),
    email: z
      .string({ message: 'El correo es obligatorio.' })
      .trim()
      .min(1, 'El correo es obligatorio.')
      .email('El formato del correo no es valido.')
      .max(160, 'El correo es demasiado largo.'),
    codigoInvitacion: z
      .string({ message: 'El codigo de invitacion es obligatorio.' })
      .trim()
      .min(1, 'El codigo de invitacion es obligatorio.')
      .max(120, 'El codigo de invitacion es demasiado largo.'),
    password: z
      .string({ message: 'La contrasena es obligatoria.' })
      .min(8, 'La contrasena debe tener al menos 8 caracteres.')
      .max(128, 'La contrasena es demasiado larga.')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S+$/,
        'Debe incluir al menos una minuscula, una mayuscula, un numero y un caracter especial.',
      ),
    passwordRepeticion: z
      .string({ message: 'Debe repetir la contrasena.' })
      .min(1, 'Debe repetir la contrasena.'),
  })
  .strict('Campos no esperados en la solicitud.')
  // La repeticion se compara como SCHEMA y no en el servicio: es una regla de
  // forma del dato, no una regla de negocio, asi que su error debe llegar
  // como 400 de validacion y no como una excepcion de servicio.
  .refine((datos) => datos.password === datos.passwordRepeticion, {
    message: 'Las contrasenas no coinciden.',
    path: ['passwordRepeticion'],
  });

// ------------------------------------------------------------------
// PATCH /api/v1/usuarios/:id/rol
// ------------------------------------------------------------------
export const esquemaCambioRol = z
  .object({
    rol: z.enum(['ADMIN_COMEX', 'ANALISTA'], {
      message: 'Rol no valido.',
      errorMap: () => ({ message: 'Rol no valido.' }),
    }),
  })
  .strict('Campos no esperados en la solicitud.');

// ------------------------------------------------------------------
// PATCH /api/v1/usuarios/:id/activo
// ------------------------------------------------------------------
// Se acepta el wrapper `{ activo: true }` y no un booleano suelto en el
// cuerpo para que la peticion sea explicita y extensible.
export const esquemaCambioActivo = z
  .object({
    activo: z.boolean({ message: 'Debe indicar true para activar o false para desactivar.' }),
  })
  .strict('Campos no esperados en la solicitud.');

// ------------------------------------------------------------------
// Parametros :id de las rutas de usuarios
// ------------------------------------------------------------------
export const esquemaIdUsuario = z.object({ id: idPositivo });