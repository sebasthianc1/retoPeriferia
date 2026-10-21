import path from "node:path"
import { FIXTURES_ROOT, fileExists, readJsonFile, readTextFile, resolveFromRoot } from "./fs-helpers.js"
import { limpiarNit, parseMonto } from "./montos.js"
import type { Aprobacion, Correo, Cotizacion, Factura, Paquete, Solicitud } from "./tipos.js"

export class CasoNoEncontradoError extends Error {
  constructor(caso: string) {
    super(`No se encontró el caso "${caso}" en ${FIXTURES_ROOT}/solicitudes/`)
    this.name = "CasoNoEncontradoError"
  }
}

function rutaCaso(directory: string, caso: string): string {
  return resolveFromRoot(directory, FIXTURES_ROOT, "solicitudes", caso)
}

function sumarDias(fechaIso: string, dias: number): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha.toISOString().slice(0, 10)
}

function parseCotizacion(texto: string): Cotizacion | null {
  if (!texto.trim()) return null
  const numero = texto.match(/^COTIZACI[ÓO]N\s+(\S+)/im)?.[1] ?? null
  const proveedor = texto.match(/Proveedor:\s*(.+)/i)?.[1]?.trim() ?? ""
  const nitCrudo = texto.match(/NIT:\s*([\d.\-]+)/i)?.[1]
  const nit = nitCrudo ? limpiarNit(nitCrudo) : null
  const totalMatch = texto.match(/TOTAL[^\n:]*:\s*([A-Z]{3})\s*([\d.,]+)/i)
  const total = totalMatch ? parseMonto(totalMatch[2]!) : 0
  const moneda = totalMatch ? totalMatch[1]!.toUpperCase() : "COP"
  const fechaEmision = texto.match(/^Fecha:\s*(\d{4}-\d{2}-\d{2})/im)?.[1] ?? null
  const validezDias = texto.match(/Validez de la oferta:\s*(\d+)\s*d[ií]as/i)?.[1]
  const validez_hasta = fechaEmision && validezDias ? sumarDias(fechaEmision, Number(validezDias)) : null

  return { proveedor, nit, numero, total, moneda, validez_hasta, texto }
}

function parseFactura(texto: string): Factura | null {
  if (!texto.trim()) return null
  const numero = texto.match(/No\.\s*(\S+)/i)?.[1] ?? ""
  const fecha = texto.match(/Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? ""
  const totalMatch = texto.match(/^TOTAL:\s*([A-Z]{3})\s*([\d.,]+)/im)
  const total = totalMatch ? parseMonto(totalMatch[2]!) : 0
  return { numero, fecha, total }
}

function aprobacionDesde(correo: { de: string; fecha: string; cuerpo: string }): Aprobacion {
  return {
    de: correo.de,
    fecha: correo.fecha,
    aprobado: /\baprobado\b/i.test(correo.cuerpo),
    texto: correo.cuerpo,
  }
}

export async function leerPaquete(directory: string, caso: string): Promise<Paquete> {
  const base = rutaCaso(directory, caso)
  if (!fileExists(base)) throw new CasoNoEncontradoError(caso)

  const faltantes: string[] = []

  const correoRaw = await readJsonFile<{ id: string; de: string; asunto: string; fecha: string }>(path.join(base, "correo.json"))
  const correo: Correo = { id: correoRaw.id, de: correoRaw.de, asunto: correoRaw.asunto, fecha: correoRaw.fecha }

  const rutaSolicitud = path.join(base, "solicitud.json")
  if (!fileExists(rutaSolicitud)) throw new Error(`Falta solicitud.json en el caso "${caso}".`)
  const solicitud = await readJsonFile<Solicitud>(rutaSolicitud)

  let cotizacion: Cotizacion | null = null
  const rutaCotizacion = path.join(base, "cotizacion.txt")
  if (fileExists(rutaCotizacion)) cotizacion = parseCotizacion(await readTextFile(rutaCotizacion))
  else faltantes.push("cotizacion.txt")

  let aprobacion: Aprobacion | null = null
  const rutaAprobacion = path.join(base, "aprobacion.json")
  if (fileExists(rutaAprobacion)) {
    const aprobacionRaw = await readJsonFile<{ de: string; fecha: string; cuerpo: string }>(rutaAprobacion)
    aprobacion = aprobacionDesde(aprobacionRaw)
  } else {
    faltantes.push("aprobacion.json")
  }

  let factura: Factura | null = null
  const rutaFactura = path.join(base, "factura.txt")
  if (fileExists(rutaFactura)) factura = parseFactura(await readTextFile(rutaFactura))

  return { correo, solicitud, cotizacion, aprobacion, factura, faltantes }
}
