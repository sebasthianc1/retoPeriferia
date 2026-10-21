import path from "node:path"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"
import { createWriteStream } from "node:fs"
import { OUT_ROOT, ensureDir, fileExists, readJsonFile, resolveFromRoot, writeTextFile } from "./fs-helpers.js"
import { cargarEtiquetasPlantilla, cargarSolicitud, mapearCamposInterno, valorPorEtiqueta } from "./mapeo.js"
import type { FormatoSalida, MapeoCampos, PlantillaCelda } from "./tipos.js"
import { FIXTURES_ROOT } from "./fs-helpers.js"

export interface ResultadoGeneracion {
  ruta: string
  formato: FormatoSalida
  mensaje?: string
}

function marcador(valores: Map<string, string>, etiqueta: string): string {
  return valores.get(etiqueta) ?? "(pendiente — ver reporte de faltantes)"
}

async function generarXlsx(directory: string, caso: string, valores: Map<string, string>): Promise<string> {
  const archivoPlantilla = resolveFromRoot(directory, FIXTURES_ROOT, "casos", caso, "plantilla-celdas.json")
  const celdas = await readJsonFile<PlantillaCelda[]>(archivoPlantilla)

  const libro = new ExcelJS.Workbook()
  const hojas = new Map<string, ExcelJS.Worksheet>()
  const obtenerHoja = (nombre: string): ExcelJS.Worksheet => {
    let hoja = hojas.get(nombre)
    if (!hoja) {
      hoja = libro.addWorksheet(nombre)
      hojas.set(nombre, hoja)
    }
    return hoja
  }

  for (const celda of celdas) {
    const hoja = obtenerHoja(celda.hoja)
    hoja.getCell(celda.celda_etiqueta).value = celda.etiqueta
    hoja.getCell(celda.celda_valor).value = marcador(valores, celda.etiqueta)
  }

  const rutaSalida = resolveFromRoot(directory, OUT_ROOT, caso, "formulario.xlsx")
  await ensureDir(path.dirname(rutaSalida))
  await libro.xlsx.writeFile(rutaSalida)
  return rutaSalida
}

async function generarPdf(directory: string, caso: string, cliente: string, valores: Map<string, string>): Promise<string> {
  const etiquetas = await cargarEtiquetasPlantilla(directory, caso, "pdf")
  const rutaSalida = resolveFromRoot(directory, OUT_ROOT, caso, "formulario.pdf")
  await ensureDir(path.dirname(rutaSalida))

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 })
    const stream = createWriteStream(rutaSalida)
    doc.pipe(stream)
    stream.on("finish", () => resolve())
    stream.on("error", reject)

    doc.fontSize(16).text("Formulario de registro como proveedor", { align: "center" })
    doc.moveDown()
    doc.fontSize(11).text(`Cliente solicitante: ${cliente}`)
    doc.moveDown(1.5)

    for (const { etiqueta, obligatorio } of etiquetas) {
      const valor = marcador(valores, etiqueta)
      const sufijo = obligatorio ? " *" : ""
      doc.fontSize(11).font("Helvetica-Bold").text(`${etiqueta}${sufijo}: `, { continued: true })
      doc.font("Helvetica").text(valor)
      doc.moveDown(0.4)
    }

    doc.moveDown()
    doc.fontSize(9).fillColor("gray").text("* campo obligatorio según la plantilla del cliente.")
    doc.end()
  })

  return rutaSalida
}

async function generarValoresPortal(directory: string, caso: string, cliente: string, valores: Map<string, string>): Promise<string> {
  const etiquetas = await cargarEtiquetasPlantilla(directory, caso, "portal")
  const lineas = [
    `# Valores para portal — ${cliente}`,
    "",
    "Formato no soportado para llenado automático: el portal requiere credenciales e interacción humana.",
    "Copia cada valor en el campo correspondiente del portal.",
    "",
    "| Campo | Valor | Obligatorio |",
    "|---|---|---|",
  ]
  for (const { etiqueta, obligatorio } of etiquetas) {
    lineas.push(`| ${etiqueta} | ${marcador(valores, etiqueta)} | ${obligatorio ? "Sí" : "No"} |`)
  }

  const rutaSalida = resolveFromRoot(directory, OUT_ROOT, caso, "valores-portal.md")
  await writeTextFile(rutaSalida, lineas.join("\n") + "\n")
  return rutaSalida
}

export async function generarFormularioInterno(
  directory: string,
  caso: string,
  mapeo?: MapeoCampos
): Promise<ResultadoGeneracion> {
  const solicitud = await cargarSolicitud(directory, caso)
  const mapeoFinal = mapeo ?? (await mapearCamposInterno(directory, caso))
  const valores = valorPorEtiqueta(mapeoFinal)

  if (solicitud.formato === "xlsx") {
    const ruta = await generarXlsx(directory, caso, valores)
    return { ruta: path.relative(directory, ruta).replaceAll("\\", "/"), formato: "xlsx" }
  }
  if (solicitud.formato === "pdf") {
    const ruta = await generarPdf(directory, caso, solicitud.cliente, valores)
    return { ruta: path.relative(directory, ruta).replaceAll("\\", "/"), formato: "pdf" }
  }
  const ruta = await generarValoresPortal(directory, caso, solicitud.cliente, valores)
  return {
    ruta: path.relative(directory, ruta).replaceAll("\\", "/"),
    formato: "portal",
    mensaje: "formato no soportado: el portal web requiere credenciales e interacción humana; se generó un archivo con los valores listos para copiar",
  }
}

export function rutaFormularioExistente(directory: string, caso: string, formato: FormatoSalida): string {
  if (formato === "xlsx") return resolveFromRoot(directory, OUT_ROOT, caso, "formulario.xlsx")
  if (formato === "pdf") return resolveFromRoot(directory, OUT_ROOT, caso, "formulario.pdf")
  return resolveFromRoot(directory, OUT_ROOT, caso, "valores-portal.md")
}

export function formularioYaGenerado(directory: string, caso: string, formato: FormatoSalida): boolean {
  return fileExists(rutaFormularioExistente(directory, caso, formato))
}
