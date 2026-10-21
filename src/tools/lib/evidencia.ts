import { createHash } from "node:crypto"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { OUT_ROOT, resolveFromRoot, writeBinaryFile, writeTextFile } from "./fs-helpers.js"
import type { Aprobacion } from "./tipos.js"

export interface ResultadoEvidencia {
  ruta: string
  ruta_pdf: string
  sha256: string
}

function contenidoTexto(aprobacion: Aprobacion, asunto: string): string {
  return [`De: ${aprobacion.de}`, `Fecha: ${aprobacion.fecha}`, `Asunto: ${asunto}`, "", aprobacion.texto].join("\n")
}

/** Pura y determinista: el mismo contenido siempre produce el mismo hash, se escriban o no los archivos. */
export function calcularSha256(aprobacion: Aprobacion, asunto: string): string {
  return createHash("sha256").update(contenidoTexto(aprobacion, asunto), "utf8").digest("hex")
}

async function generarPdf(contenido: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fuente = await doc.embedFont(StandardFonts.Helvetica)
  const pagina = doc.addPage([595, 842])
  const tamano = 11
  const margen = 50
  let y = 842 - margen

  for (const lineaOriginal of contenido.split("\n")) {
    const palabras = lineaOriginal.split(" ")
    let linea = ""
    for (const palabra of palabras) {
      const candidata = linea ? `${linea} ${palabra}` : palabra
      if (fuente.widthOfTextAtSize(candidata, tamano) > 595 - margen * 2) {
        pagina.drawText(linea, { x: margen, y, size: tamano, font: fuente })
        y -= tamano + 4
        linea = palabra
      } else {
        linea = candidata
      }
    }
    pagina.drawText(linea, { x: margen, y, size: tamano, font: fuente })
    y -= tamano + 4
  }

  return doc.save()
}

export async function generarEvidencia(directory: string, caso: string, aprobacion: Aprobacion, asunto: string): Promise<ResultadoEvidencia> {
  const contenido = contenidoTexto(aprobacion, asunto)
  const sha256 = calcularSha256(aprobacion, asunto)

  const rutaTxt = resolveFromRoot(directory, OUT_ROOT, caso, "aprobacion.txt")
  await writeTextFile(rutaTxt, contenido)

  const rutaPdf = resolveFromRoot(directory, OUT_ROOT, caso, "aprobacion.pdf")
  const bytesPdf = await generarPdf(contenido)
  await writeBinaryFile(rutaPdf, bytesPdf)

  return { ruta: `${OUT_ROOT}/${caso}/aprobacion.txt`, ruta_pdf: `${OUT_ROOT}/${caso}/aprobacion.pdf`, sha256 }
}
