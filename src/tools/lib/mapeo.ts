import path from "node:path"
import { FIXTURES_ROOT, fileExists, readJsonFile, resolveFromRoot } from "./fs-helpers.js"
import type {
  CampoDetalle,
  CampoFaltante,
  CampoLleno,
  CampoRequiereConfirmacion,
  MapeoCampos,
  PlantillaCampo,
  PlantillaCelda,
  Solicitud,
  SolicitudLeida,
  SoporteIndexado,
} from "./tipos.js"

/** Etiquetas genéricas de identificación tributaria que no especifican el país del equivalente. */
const ETIQUETAS_AMBIGUAS = new Set(["identificación tributaria", "identificacion tributaria", "número de identificación fiscal", "numero de identificacion fiscal"])

const EQUIVALENTE_POR_PAIS: Record<string, string> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
}

export function equivalenteIdentificacion(pais: string): string {
  return EQUIVALENTE_POR_PAIS[pais] ?? "identificador tributario local"
}

function normalizar(etiqueta: string): string {
  return etiqueta.trim().toLowerCase().replace(/\s+/g, " ")
}

export class CasoNoEncontradoError extends Error {
  constructor(caso: string) {
    super(`No se encontró el caso "${caso}" en ${FIXTURES_ROOT}/casos/`)
    this.name = "CasoNoEncontradoError"
  }
}

export class PlantillaCorruptaError extends Error {
  constructor(caso: string, detalle: string) {
    super(`La plantilla del caso "${caso}" no se pudo leer: ${detalle}`)
    this.name = "PlantillaCorruptaError"
  }
}

function rutaCaso(directory: string, caso: string): string {
  return resolveFromRoot(directory, FIXTURES_ROOT, "casos", caso)
}

export async function cargarSolicitud(directory: string, caso: string): Promise<Solicitud> {
  const archivo = path.join(rutaCaso(directory, caso), "solicitud.json")
  if (!fileExists(archivo)) throw new CasoNoEncontradoError(caso)
  return readJsonFile<Solicitud>(archivo)
}

async function cargarSoportesExigidos(directory: string, caso: string): Promise<string[]> {
  const archivo = path.join(rutaCaso(directory, caso), "soportes-exigidos.json")
  if (!fileExists(archivo)) return []
  return readJsonFile<string[]>(archivo)
}

async function cargarGlosario(directory: string): Promise<Record<string, string>> {
  const archivo = resolveFromRoot(directory, FIXTURES_ROOT, "glosario-campos.json")
  return readJsonFile<Record<string, string>>(archivo)
}

export async function cargarMaestro(directory: string): Promise<Record<string, unknown>> {
  const archivo = resolveFromRoot(directory, FIXTURES_ROOT, "repositorio", "maestro.json")
  return readJsonFile<Record<string, unknown>>(archivo)
}

export async function cargarIndiceSoportes(directory: string): Promise<SoporteIndexado[]> {
  const archivo = resolveFromRoot(directory, FIXTURES_ROOT, "repositorio", "soportes", "index.json")
  return readJsonFile<SoporteIndexado[]>(archivo)
}

/** Devuelve las etiquetas en el orden de la plantilla, junto con si cada una es obligatoria (cuando se conoce). */
export async function cargarEtiquetasPlantilla(
  directory: string,
  caso: string,
  formato: string
): Promise<{ etiqueta: string; obligatorio: boolean | null }[]> {
  const base = rutaCaso(directory, caso)
  try {
    if (formato === "xlsx") {
      const archivo = path.join(base, "plantilla-celdas.json")
      if (!fileExists(archivo)) throw new Error("falta plantilla-celdas.json")
      const celdas = await readJsonFile<PlantillaCelda[]>(archivo)
      const vistos = new Set<string>()
      const etiquetas: { etiqueta: string; obligatorio: boolean | null }[] = []
      for (const celda of celdas) {
        if (vistos.has(celda.etiqueta)) continue
        vistos.add(celda.etiqueta)
        etiquetas.push({ etiqueta: celda.etiqueta, obligatorio: null })
      }
      return etiquetas
    }
    // pdf y portal comparten el mismo formato de plantilla
    const archivo = path.join(base, "plantilla-campos.json")
    if (!fileExists(archivo)) throw new Error("falta plantilla-campos.json")
    const campos = await readJsonFile<PlantillaCampo[]>(archivo)
    return campos.map((c) => ({ etiqueta: c.etiqueta, obligatorio: c.obligatorio }))
  } catch (err) {
    throw new PlantillaCorruptaError(caso, err instanceof Error ? err.message : String(err))
  }
}

function resolverRuta(objeto: Record<string, unknown>, rutaPuntos: string): unknown {
  const partes = rutaPuntos.split(".")
  let actual: unknown = objeto
  for (const parte of partes) {
    if (actual === null || typeof actual !== "object") return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

function formatearValor(claveRuta: string, valor: unknown, maestro: Record<string, unknown>): string | null {
  if (valor === null || valor === undefined) return null
  if (claveRuta === "ingresos_ultimo_ano.valor") {
    const ingresos = maestro["ingresos_ultimo_ano"] as { valor?: number; moneda?: string } | undefined
    const moneda = ingresos?.moneda ?? ""
    return `${Number(valor).toLocaleString("es-CO")} ${moneda}`.trim()
  }
  if (typeof valor === "boolean") return valor ? "Sí" : "No"
  return String(valor)
}

/** Lee la solicitud y su plantilla; es la lógica detrás de `proveedor_leer_solicitud`. */
export async function leerSolicitudInterno(directory: string, caso: string): Promise<SolicitudLeida> {
  const solicitud = await cargarSolicitud(directory, caso)
  const soportes = await cargarSoportesExigidos(directory, caso)
  const etiquetasPlantilla = await cargarEtiquetasPlantilla(directory, caso, solicitud.formato)

  const campos_detalle: CampoDetalle[] = etiquetasPlantilla.map(({ etiqueta, obligatorio }) => {
    const ambiguo = ETIQUETAS_AMBIGUAS.has(normalizar(etiqueta))
    return {
      etiqueta,
      obligatorio,
      ambiguo,
      ...(ambiguo ? { equivalente_pais: equivalenteIdentificacion(solicitud.pais) } : {}),
    }
  })

  return {
    pais: solicitud.pais,
    cliente: solicitud.cliente,
    formato: solicitud.formato,
    campos: etiquetasPlantilla.map((c) => c.etiqueta),
    campos_detalle,
    soportes,
  }
}

/** Cruza cada etiqueta con el glosario y el maestro; es la lógica detrás de `proveedor_mapear_campos`. */
export async function mapearCamposInterno(directory: string, caso: string, campos?: string[]): Promise<MapeoCampos> {
  const solicitud = await cargarSolicitud(directory, caso)
  const glosario = await cargarGlosario(directory)
  const maestro = await cargarMaestro(directory)
  const etiquetas = campos ?? (await leerSolicitudInterno(directory, caso)).campos

  const glosarioNormalizado = new Map<string, string>()
  for (const [etiqueta, clave] of Object.entries(glosario)) {
    glosarioNormalizado.set(normalizar(etiqueta), clave)
  }

  const llenos: CampoLleno[] = []
  const faltantes: CampoFaltante[] = []
  const requiere_confirmacion: CampoRequiereConfirmacion[] = []

  for (const etiqueta of etiquetas) {
    const normalizada = normalizar(etiqueta)
    const claveRuta = glosario[etiqueta] ?? glosarioNormalizado.get(normalizada)

    if (!claveRuta) {
      faltantes.push({ etiqueta, nota: "sin equivalencia en el glosario de campos" })
      continue
    }

    const valorCrudo = resolverRuta(maestro, claveRuta)
    const valor = formatearValor(claveRuta, valorCrudo, maestro)

    if (valor === null) {
      faltantes.push({ etiqueta, nota: `clave "${claveRuta}" no tiene valor en el maestro` })
      continue
    }

    const esIdentificadorExtranjero = claveRuta === "nit" && solicitud.pais !== "CO"
    const esAmbigua = ETIQUETAS_AMBIGUAS.has(normalizada)

    if (esIdentificadorExtranjero) {
      requiere_confirmacion.push({
        etiqueta,
        clave_maestro: claveRuta,
        valor_propuesto: valor,
        razon: `identificador extranjero: Periferia solo tiene NIT colombiano; se propone como ${equivalenteIdentificacion(solicitud.pais)} tentativo`,
      })
    } else if (esAmbigua) {
      requiere_confirmacion.push({
        etiqueta,
        clave_maestro: claveRuta,
        valor_propuesto: valor,
        razon: `campo ambiguo en la plantilla; equivalente sugerido para ${solicitud.pais}: ${equivalenteIdentificacion(solicitud.pais)}`,
      })
    } else {
      llenos.push({ etiqueta, clave_maestro: claveRuta, valor })
    }
  }

  return { llenos, faltantes, requiere_confirmacion }
}

export function valorPorEtiqueta(mapeo: MapeoCampos): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const campo of mapeo.llenos) mapa.set(campo.etiqueta, campo.valor)
  for (const campo of mapeo.requiere_confirmacion) mapa.set(campo.etiqueta, campo.valor_propuesto)
  return mapa
}
