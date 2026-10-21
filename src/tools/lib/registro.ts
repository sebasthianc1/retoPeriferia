import path from "node:path"
import { appendFile } from "node:fs/promises"
import { FIXTURES_ROOT, OUT_ROOT, copyFile, ensureDir, fileExists, readJsonFile, readTextFile, resolveFromRoot, writeTextFile } from "./fs-helpers.js"
import { parseCsv, stringifyCsv } from "./csv.js"
import { COLUMNAS_MAESTRO, type Correo, type FilaMaestro } from "./tipos.js"
import type { ContratoExtraido } from "./tipos.js"
import type { ResultadoClasificacion } from "./clasificacion.js"

function rutaMaestroFixture(directory: string): string {
  return resolveFromRoot(directory, FIXTURES_ROOT, "maestro-contratos.csv")
}
function rutaMaestroOut(directory: string): string {
  return resolveFromRoot(directory, OUT_ROOT, "sharepoint", "maestro-contratos.csv")
}
function rutaHistorial(directory: string): string {
  return resolveFromRoot(directory, OUT_ROOT, "sharepoint", "historial.jsonl")
}
function rutaProcesados(directory: string): string {
  return resolveFromRoot(directory, OUT_ROOT, "procesados.json")
}

export async function cargarMaestro(directory: string): Promise<FilaMaestro[]> {
  const destino = rutaMaestroOut(directory)
  if (!fileExists(destino)) {
    await copyFile(rutaMaestroFixture(directory), destino)
  }
  const contenido = await readTextFile(destino)
  return parseCsv(contenido) as unknown as FilaMaestro[]
}

async function guardarMaestro(directory: string, filas: FilaMaestro[]): Promise<void> {
  const csv = stringifyCsv(filas as unknown as Record<string, string>[], COLUMNAS_MAESTRO)
  await writeTextFile(rutaMaestroOut(directory), csv)
}

export async function mensajesProcesados(directory: string): Promise<Set<string>> {
  const ruta = rutaProcesados(directory)
  if (!fileExists(ruta)) return new Set()
  const lista = await readJsonFile<string[]>(ruta)
  return new Set(lista)
}

async function marcarProcesado(directory: string, mensajeId: string): Promise<void> {
  const ruta = rutaProcesados(directory)
  const actuales = await mensajesProcesados(directory)
  actuales.add(mensajeId)
  await writeTextFile(ruta, JSON.stringify([...actuales].sort(), null, 2) + "\n")
}

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function generarIdAuto(filas: FilaMaestro[], anio: string): string {
  const prefijo = `AUTO-${anio}-`
  const secuencias = filas
    .filter((f) => f.id_contrato.startsWith(prefijo))
    .map((f) => Number(f.id_contrato.slice(prefijo.length)) || 0)
  const siguiente = (secuencias.length ? Math.max(...secuencias) : 0) + 1
  return `${prefijo}${String(siguiente).padStart(3, "0")}`
}

function valorOExistente(nuevo: string | null, existente: string | undefined): string {
  if (nuevo !== null && nuevo !== "") return nuevo
  return existente ?? ""
}

export interface ResultadoRegistro {
  id_contrato: string
  accion: "registrado" | "actualizado" | "duplicado" | "rechazado"
  ruta_archivo: string | null
}

export async function registrarContrato(
  directory: string,
  mensajeId: string,
  correo: Correo,
  contrato: ContratoExtraido,
  clasificacionResultado: ResultadoClasificacion
): Promise<ResultadoRegistro> {
  const { clasificacion, filaExistente, diferencias } = clasificacionResultado

  if (clasificacion === "rechazado") {
    await marcarProcesado(directory, mensajeId)
    return { id_contrato: "", accion: "rechazado", ruta_archivo: null }
  }
  if (clasificacion === "duplicado") {
    await marcarProcesado(directory, mensajeId)
    return { id_contrato: filaExistente!.id_contrato, accion: "duplicado", ruta_archivo: null }
  }

  const filas = await cargarMaestro(directory)
  const anio = (contrato.fecha_inicio.valor ?? filaExistente?.fecha_inicio ?? new Date().toISOString()).slice(0, 4)
  const idContrato = filaExistente?.id_contrato ?? contrato.id_contrato.valor ?? generarIdAuto(filas, anio)
  const clienteFinal = valorOExistente(contrato.cliente.valor, filaExistente?.cliente)
  const clienteSlugValor = slug(clienteFinal || idContrato)

  const adjuntoNombre = correo.adjuntos[0]
  let rutaRelativa = filaExistente?.ruta_sharepoint ?? ""
  if (adjuntoNombre) {
    const ext = path.extname(adjuntoNombre) || ".txt"
    rutaRelativa = `Contratos/${anio}/${clienteSlugValor}/${idContrato}${ext}`
    const origen = resolveFromRoot(directory, FIXTURES_ROOT, "buzon", mensajeId, adjuntoNombre)
    const destino = resolveFromRoot(directory, OUT_ROOT, "sharepoint", rutaRelativa)
    if (fileExists(origen)) await copyFile(origen, destino)
  }

  const requierePolizaFinal =
    contrato.requiere_poliza.valor !== null ? contrato.requiere_poliza.valor : filaExistente?.requiere_poliza === "true"
  const estadoPolizaFinal = filaExistente
    ? filaExistente.estado_poliza
    : requierePolizaFinal
      ? "pendiente"
      : "no_aplica"

  const filaNueva: FilaMaestro = {
    id_contrato: idContrato,
    cliente: clienteFinal,
    nit_cliente: valorOExistente(contrato.nit_cliente.valor, filaExistente?.nit_cliente),
    pais: valorOExistente(contrato.pais.valor, filaExistente?.pais),
    objeto: valorOExistente(contrato.objeto.valor, filaExistente?.objeto),
    valor: contrato.valor.valor !== null ? String(contrato.valor.valor) : (filaExistente?.valor ?? "0"),
    moneda: valorOExistente(contrato.moneda.valor, filaExistente?.moneda),
    fecha_inicio: valorOExistente(contrato.fecha_inicio.valor, filaExistente?.fecha_inicio),
    fecha_fin: valorOExistente(contrato.fecha_fin.valor, filaExistente?.fecha_fin),
    requiere_poliza: String(requierePolizaFinal ?? false),
    tipo_poliza: valorOExistente(contrato.tipo_poliza.valor, filaExistente?.tipo_poliza),
    estado_poliza: estadoPolizaFinal,
    comercial: valorOExistente(contrato.comercial.valor, filaExistente?.comercial) || "Desconocido",
    ruta_sharepoint: rutaRelativa,
    fecha_registro: filaExistente?.fecha_registro ?? new Date().toISOString().slice(0, 10),
    fuente: filaExistente?.fuente ?? "buzon",
  }

  const indiceExistente = filaExistente ? filas.findIndex((f) => f.id_contrato === filaExistente.id_contrato) : -1
  if (indiceExistente >= 0) filas[indiceExistente] = filaNueva
  else filas.push(filaNueva)
  await guardarMaestro(directory, filas)

  const accion = filaExistente ? "actualizado" : "registrado"
  await ensureDir(path.dirname(rutaHistorial(directory)))
  const entradaHistorial = {
    ts: new Date().toISOString(),
    id_contrato: idContrato,
    accion,
    cambios: diferencias ?? null,
    mensaje_id: mensajeId,
  }
  await appendFile(rutaHistorial(directory), JSON.stringify(entradaHistorial) + "\n", "utf8")

  await marcarProcesado(directory, mensajeId)

  return { id_contrato: idContrato, accion, ruta_archivo: rutaRelativa || null }
}
