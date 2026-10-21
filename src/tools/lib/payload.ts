import { z } from "zod"
import type { Paquete, ResultadoValidacion } from "./tipos.js"

export const PosicionSchema = z.object({
  numero: z.number(),
  descripcion: z.string().max(40),
  cantidad: z.number(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number(),
  centro_costo: z.string(),
  subarea: z.string(),
  indicador_iva: z.string(),
})

export const ExcepcionSchema = z.object({
  codigo: z.string(),
  detalle: z.string(),
  confirmado_por: z.string().nullable(),
})

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z.array(PosicionSchema),
  excepciones: z.array(ExcepcionSchema),
})

export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

function inferirUnidad(descripcion: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(descripcion)) return "H"
  return "UN"
}

export interface ResultadoPayload {
  payload: OrdenCompra
  trazabilidad: Record<string, string>
}

export function construirPayload(paquete: Paquete, validacion: ResultadoValidacion, evidenciaSha256: string): ResultadoPayload {
  const { solicitud, cotizacion, aprobacion, correo } = paquete
  const proveedor = validacion.proveedor

  if (!proveedor) throw new Error("No se puede construir el payload sin un proveedor válido (RC1 bloqueado).")
  if (!aprobacion) throw new Error("No se puede construir el payload sin una aprobación (RC2 bloqueado).")

  const condicionesPago = solicitud.condiciones_pago ?? validacion.derivados.condiciones_pago ?? proveedor.condiciones_pago_default
  const indicadorIva = solicitud.indicador_iva ?? validacion.derivados.indicador_iva ?? proveedor.indicador_iva_default
  const moneda = solicitud.moneda === "USD" ? "USD" : "COP"

  const payload: OrdenCompra = {
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: correo.id,
      cotizacion_ref: cotizacion?.numero ?? null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda,
    condiciones_pago: condicionesPago,
    aprobador: { email: aprobacion.de, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [
      {
        numero: 10,
        descripcion: solicitud.descripcion.slice(0, 40),
        cantidad: solicitud.cantidad,
        unidad: inferirUnidad(solicitud.descripcion),
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: indicadorIva,
      },
    ],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  }

  const trazabilidad: Record<string, string> = {
    "referencia.solicitud_id": "solicitud",
    "referencia.correo_id": "correo",
    "referencia.cotizacion_ref": cotizacion ? "cotizacion" : "sin_cotizacion",
    "proveedor.codigo_sap": "maestro.proveedores",
    "proveedor.nit": "maestro.proveedores",
    "proveedor.nombre": "maestro.proveedores",
    moneda: "solicitud",
    condiciones_pago: solicitud.condiciones_pago ? "solicitud" : "derivado:maestro.proveedores",
    "aprobador.email": "aprobacion",
    "aprobador.fecha_aprobacion": "aprobacion",
    "aprobador.evidencia_sha256": "derivado:oc_generar_evidencia",
    "posiciones[0].descripcion": "solicitud",
    "posiciones[0].cantidad": "solicitud",
    "posiciones[0].unidad": "derivado:descripcion",
    "posiciones[0].precio_unitario": "solicitud",
    "posiciones[0].centro_costo": "solicitud",
    "posiciones[0].subarea": "solicitud",
    "posiciones[0].indicador_iva": solicitud.indicador_iva ? "solicitud" : "derivado:maestro.proveedores",
  }

  return { payload, trazabilidad }
}
